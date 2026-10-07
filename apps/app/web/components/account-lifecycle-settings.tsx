import { useEffect, useState } from "react";
type Service = {
  service: string;
  state: "active" | "deleted" | "purged";
  recoverUntil: string | null;
};
type Settings = { enabled: boolean; canDelete: boolean; services: Service[] };
const labels: Record<string, string> = {
  prismtone: "Prismtone",
  scenote: "Scenote",
  facetia: "Facetia",
};
const errors: Record<string, string> = {
  confirm_must_match_handle: "確認用 ID が一致しません。現在の ID を入力してください。",
  service_not_recoverable: "このサービスは復旧できる期間を過ぎています。",
  account_lifecycle_disabled: "退会の受付を一時停止しています。",
  administrator_cannot_delete: "管理者アカウントは退会できません。",
};
const button = "rounded border border-line px-3 py-2 text-sm disabled:opacity-50";
async function request<T>(path: string, method = "GET", body?: object): Promise<T> {
  const res = await fetch(`/api/me/${path}`, {
    method,
    ...(body
      ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
      : {}),
  });
  const data = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok)
    throw new Error(
      errors[data.error?.message ?? ""] ??
        "処理できませんでした。時間をおいてもう一度お試しください。",
    );
  return data;
}
export function AccountLifecycleSettings({ handle }: { handle: string }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const load = async () => setSettings(await request<Settings>("lifecycle"));
  useEffect(() => {
    void load().catch(() =>
      setMessage({
        ok: false,
        text: "退会の設定を読み込めませんでした。ページを再読み込みしてください。",
      }),
    );
  }, []);
  const choose = (value: string) => {
    setTarget(value);
    setConfirmation("");
    setMessage(null);
  };
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await request(target === "account" ? "deletion" : `services/${target}/deletion`, "POST", {
        confirm: confirmation,
      });
      if (target === "account") {
        window.location.assign("/login?deleted=1");
        return;
      }
      await load();
      setTarget(null);
      setMessage({
        ok: true,
        text: "このサービスの退会を受け付けました。サービス側へ通知しています。",
      });
    } catch (error) {
      setMessage({
        ok: false,
        text: error instanceof Error ? error.message : "退会できませんでした",
      });
    } finally {
      setBusy(false);
    }
  }
  async function restore(service: string) {
    setBusy(true);
    setMessage(null);
    try {
      await request(`services/${service}/restore`, "POST");
      await load();
      setMessage({ ok: true, text: "このサービスの復旧を受け付けました。画像は戻りません。" });
    } catch (error) {
      setMessage({
        ok: false,
        text: error instanceof Error ? error.message : "復旧できませんでした",
      });
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-4" aria-labelledby="deletion-heading">
      <h2 id="deletion-heading" className="text-xl font-semibold">
        退会と復旧
      </h2>
      {!settings && !message && <p>読み込み中</p>}
      {settings && !settings.enabled && <p className="text-sm">退会機能は準備中です。</p>}
      {settings && (
        <>
          <h3 className="font-medium">サービスごとに退会</h3>
          <p className="text-sm text-ink-muted">
            このサービスのデータとセッションを削除します。Lumorphia
            のアカウントとキャラクター、ほかのサービスは残ります。30
            日以内なら、この画面かサービスへのログイン時に「復旧する」を選ぶと戻せます。画像は復旧しても戻りません。
          </p>
          {settings.services.length === 0 && (
            <p className="text-sm">利用中のサービスはありません。</p>
          )}
          <ul className="space-y-3">
            {settings.services.map((service) => (
              <li
                className="rounded border border-line p-3 text-sm"
                key={service.service}
                data-testid="service-membership"
              >
                <p className="font-medium">{labels[service.service] ?? service.service}</p>
                {service.state === "active" ? (
                  <button
                    type="button"
                    className={button}
                    disabled={busy || !settings.enabled}
                    onClick={() => choose(service.service)}
                  >
                    このサービスを退会
                  </button>
                ) : service.state === "deleted" ? (
                  <>
                    <p>
                      退会済み。復旧期限:{" "}
                      {service.recoverUntil
                        ? new Date(service.recoverUntil).toLocaleString("ja-JP")
                        : "期限切れ"}
                    </p>
                    <button
                      type="button"
                      className={button}
                      disabled={
                        busy ||
                        !service.recoverUntil ||
                        new Date(service.recoverUntil).getTime() <= Date.now()
                      }
                      onClick={() => void restore(service.service)}
                    >
                      このサービスを復旧
                    </button>
                  </>
                ) : (
                  <p>データ削除済みです。次のログインから新しく利用できます。</p>
                )}
              </li>
            ))}
          </ul>
          <h3 className="font-medium">Lumorphia から退会</h3>
          <p className="text-sm text-ink-muted">
            すべてのサービスと Lumorphia のセッションが終了し、画像の削除を始めます。30
            日以内なら、同じ連携アカウントでログインして「復旧する」を選ぶと戻せます。30
            日後にアカウント、連携、キャラクターと各サービスのデータを削除します。
          </p>
          {!settings.canDelete && <p className="text-sm">管理者アカウントは退会できません。</p>}
          <button
            type="button"
            className={button}
            disabled={busy || !settings.enabled || !settings.canDelete}
            onClick={() => choose("account")}
          >
            Lumorphia から退会
          </button>
        </>
      )}
      {target && (
        <form
          className="space-y-3 rounded border border-line p-4"
          onSubmit={(event) => void submit(event)}
          data-testid={
            target === "account" ? "global-deletion-confirmation" : "service-deletion-confirmation"
          }
        >
          <p>
            {target === "account"
              ? "Lumorphia とすべてのサービスから"
              : `${labels[target] ?? target} から`}
            退会します。画像は復旧しても戻りません。
          </p>
          <label className="block text-sm">
            退会の確認用 ID
            <input
              required
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              maxLength={20}
              autoComplete="off"
              spellCheck={false}
              className="mt-1 block w-full rounded border border-line bg-surface-raised p-2"
            />
          </label>
          <p className="text-sm">確認のため現在の ID「{handle}」を入力してください。</p>
          <button type="submit" className={button} disabled={busy || confirmation !== handle}>
            退会を確定
          </button>{" "}
          <button type="button" className={button} disabled={busy} onClick={() => setTarget(null)}>
            キャンセル
          </button>
        </form>
      )}
      {message && (
        <p
          role={message.ok ? "status" : "alert"}
          data-testid="deletion-message"
          className="text-sm"
        >
          {message.text}
        </p>
      )}
    </section>
  );
}
