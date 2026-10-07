import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execute = promisify(execFile);
const script = new URL("../../../docker/backup/backup.sh", import.meta.url).pathname;
let directory: string | undefined;
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function run(dumpFails: boolean, uploadFails: boolean) {
  directory = await mkdtemp(join(tmpdir(), "accounts-backup-test-"));
  await writeFile(
    join(directory, "pg_dump"),
    dumpFails
      ? '#!/bin/bash\necho "test-secret" >&2\nexit 1\n'
      : '#!/bin/bash\nfor arg in "$@"; do case "$arg" in --file=*) printf "test-dump" > "${arg#--file=}" ;; esac; done\n',
    { mode: 0o700 },
  );
  await writeFile(
    join(directory, "rclone"),
    `#!/bin/bash\nprintf 'upload-attempt\\n'\nexit ${uploadFails ? 1 : 0}\n`,
    { mode: 0o700 },
  );
  return execute("bash", [script, "once"], {
    env: {
      ...process.env,
      PATH: `${directory}:${process.env.PATH}`,
      DATABASE_URL: "postgres://test:test-secret@localhost/test",
      R2_BACKUP_ENDPOINT: "https://test.invalid",
      R2_BACKUP_BUCKET: "test-backups",
      R2_BACKUP_ACCESS_KEY_ID: "test-key",
      R2_BACKUP_SECRET_ACCESS_KEY: "test-secret",
    },
  });
}
describe("database backup", () => {
  it("uploads a completed dump", async () => {
    expect((await run(false, false)).stdout).toContain("backup ok");
  });
  it("stops before uploading when the dump fails and hides raw errors", async () => {
    await expect(run(true, false)).rejects.toMatchObject({
      stdout: "",
      stderr: "backup failed: dump\n",
    });
  });
  it("reports an upload failure as a failed backup", async () => {
    await expect(run(false, true)).rejects.toMatchObject({ stderr: "backup failed: upload\n" });
  });
});
