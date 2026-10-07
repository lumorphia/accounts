import { useEffect, useState } from "react";
import { isServiceLogin } from "../auth/login-next.ts";

/**
 * 退会中の利用者に、復旧するかを本人に選ばせる (ADR-0011)。
 * ログインしただけでは戻さない。サービスからの認可の途中なら、選んだあと next に戻る。
 */

const labels: Record<string, string> = {
  prismtone: "Prismtone",
  scenote: "Scenote",
  facetia: "Facetia",
};
const errors: Record<string, string> = {
  recovery_expired: "復旧できる期間を過ぎています。",
  service_not_recoverable: "このサービスは復旧できる期間を過ぎています。",
};
const panel = "mt-6 space-y-3 rounded border border-line bg-surface-raised p-4";
const primary = "rounded bg-accent px-4 py-2 text-accent-ink disabled:opacity-50";
const secondary = "rounded border border-line px-4 py-2 disabled:opacity-50";

/** サービスのログインの途中で寄り道しているときだけ出す。待たせすぎるとサービス側の状態が切れる */
function ServiceLoginNotice({ next }: { next: string }) {
  if (!isServiceLogin(next)) return null;
  return (
    <p data-testid="service-login-notice" className="text-sm text-ink-muted">
      サービスへのログインの途中です。この画面で時間が経つと、サービスのログインからやり直しになることがあります。
    </p>
  );
}

const formatDeadline = (iso: string) =>
  new Date(iso).toLocaleString("ja-JP", { dateStyle: "long", timeStyle: "short" });

async function post(path: string): Promise<void> {
  const res = await fetch(path, { method: "POST", credentials: "same-origin" });
  if (res.ok) return;
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  throw new Error(
    errors[body.error?.message ?? ""] ??
      "復旧できませんでした。時間をおいてもう一度お試しください。",
  );
}

export function AccountRecovery({
  recoverUntil,
  next,
  onRestored,
}: {
  recoverUntil: string;
  next: string;
  onRestored: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function restore() {
    setBusy(true);
    setError(null);
    try {
      await post("/api/me/restore");
      onRestored();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "復旧できませんでした。");
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    await fetch("/api/auth/sign-out", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: "{}",
    }).catch(() => undefined);
    window.location.assign("/login");
  }

  return (
    <section data-testid="account-recovery" className={panel}>
      <h2 className="font-semibold">このアカウントは退会の手続き中です</h2>
      <p className="text-sm">
        {formatDeadline(recoverUntil)}{" "}
        までなら、ID・プロフィール・連携・キャラクターを復旧できます。画像は戻りません。復旧しないまま期限を過ぎると、すべて削除します。
      </p>
      <ServiceLoginNotice next={next} />
      <div className="flex gap-3">
        <button type="button" className={primary} disabled={busy} onClick={() => void restore()}>
          復旧する
        </button>
        <button type="button" className={secondary} disabled={busy} onClick={() => void logout()}>
          復旧せずにログアウト
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </section>
  );
}

type ServiceState = {
  service: string;
  state: "active" | "deleted" | "purged";
  recoverUntil: string | null;
};

export function ServiceRecovery({ service, next }: { service: string; next: string }) {
  const [row, setRow] = useState<ServiceState | null | "loading">("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = labels[service] ?? service;

  useEffect(() => {
    void fetch("/api/me/lifecycle")
      .then((res) => (res.ok ? res.json() : { services: [] }))
      .then((data: { services: ServiceState[] }) =>
        setRow(data.services.find((s) => s.service === service) ?? null),
      )
      .catch(() => setRow(null));
  }, [service]);

  async function restore() {
    setBusy(true);
    setError(null);
    try {
      await post(`/api/me/services/${encodeURIComponent(service)}/restore`);
      window.location.assign(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "復旧できませんでした。");
      setBusy(false);
    }
  }

  if (row === "loading") return null;
  if (row?.state !== "deleted" || !row.recoverUntil)
    return (
      <p className="mt-6">
        <a href={next} className="text-accent underline">
          {label} に進む
        </a>
      </p>
    );
  return (
    <section data-testid="service-recovery" className={panel}>
      <h2 className="font-semibold">{label} は退会の手続き中です</h2>
      <p className="text-sm">
        {formatDeadline(row.recoverUntil)} までなら、{label}{" "}
        のデータを復旧して使い続けられます。画像は戻りません。Lumorphia
        アカウントとほかのサービスには影響しません。
      </p>
      <ServiceLoginNotice next={next} />
      <div className="flex gap-3">
        <button type="button" className={primary} disabled={busy} onClick={() => void restore()}>
          {label} を復旧する
        </button>
        <a href="/" className={secondary}>
          復旧しない
        </a>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </section>
  );
}
