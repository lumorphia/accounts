import { useEffect, useState } from "react";
type LegacyAccount = { service: "prismtone"; handle: string; migrationUrl: string };
export function LegacyMigrationGuide({
  onChooseHandle,
}: {
  onChooseHandle?: (handle: string) => void;
}) {
  const [accounts, setAccounts] = useState<LegacyAccount[]>([]);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    void fetch("/api/me/legacy")
      .then(async (response) => {
        if (response.status === 401 || response.status === 403) return;
        if (!response.ok) throw new Error("migration notice unavailable");
        const body = (await response.json()) as { accounts: LegacyAccount[] };
        setAccounts(body.accounts);
      })
      .catch(() => setFailed(true));
  }, []);
  if (failed)
    return (
      <p role="alert" className="text-sm">
        引き継ぎの案内を読み込めませんでした。ページを再読み込みしてください。
      </p>
    );
  if (!accounts.length) return null;
  return (
    <section
      data-testid="legacy-migration-guide"
      aria-labelledby="legacy-heading"
      className="space-y-3 rounded border border-line p-4"
    >
      <h2 id="legacy-heading" className="font-semibold">
        Prismtone のアカウントが見つかりました
      </h2>
      <p className="text-sm">
        引き継ぐと、投稿、お気に入り、キャラクターをそのまま使えます。移行期限はありません。
      </p>
      <p className="text-sm">
        引き継ぎは Prismtone
        の画面で内容を確認して行います。ほかに連携していたログイン方法は、Lumorphia
        の設定から連携し直してください。
      </p>
      {accounts.map((account) => (
        <div key={account.handle} className="space-y-2 text-sm">
          <p>Prismtone の ID: {account.handle}</p>
          {onChooseHandle ? (
            <button
              type="button"
              className="rounded border border-line px-3 py-2"
              onClick={() => onChooseHandle(account.handle)}
            >
              Prismtone の ID を使う
            </button>
          ) : (
            <a className="text-accent underline" href={account.migrationUrl}>
              Prismtone で引き継ぐ
            </a>
          )}
        </div>
      ))}
      {onChooseHandle && (
        <p className="text-sm">
          この ID は本人用に予約されています。別の ID
          でも設定でき、設定後に引き継ぐ画面でどちらを使うか選べます。
        </p>
      )}
    </section>
  );
}
