import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { LegacyMigrationGuide } from "../components/legacy-migration-guide.tsx";
import { loginNext } from "../auth/login-next.ts";
import type { Route } from "./+types/welcome";

export function meta() {
  return [{ title: "アカウントの設定 - Lumorphia" }, { name: "robots", content: "noindex" }];
}

export default function Welcome(_: Route.ComponentProps) {
  const [params] = useSearchParams();
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [consent, setConsent] = useState<{ termsVersion: string; privacyVersion: string } | null>(
    null,
  );
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [legalConfirmed, setLegalConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const next = loginNext(params);

  useEffect(() => {
    void fetch("/api/legal")
      .then((res) => {
        if (!res.ok) throw new Error("legal unavailable");
        return res.json();
      })
      .then(setConsent)
      .catch(() => setError("規約を読み込めませんでした。再読み込みしてください。"));
    void fetch("/api/me")
      .then((res) => res.json())
      .then((data: { user: { name: string; status: string } | null }) => {
        if (!data.user) {
          window.location.assign(`/login?next=${encodeURIComponent(next)}`);
          return;
        }
        if (data.user.status !== "pending") {
          window.location.assign(next);
          return;
        }
        setName(data.user.name);
        setHandle(
          data.user.name
            .normalize("NFKD")
            .toLowerCase()
            .replace(/[^a-z0-9_]+/g, "_")
            .replace(/^_+|_+$/g, "")
            .slice(0, 20),
        );
        setLoading(false);
      })
      .catch(() => {
        setError("アカウントを読み込めませんでした");
        setLoading(false);
      });
  }, [next]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!consent || !ageConfirmed || !legalConfirmed) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/me/onboarding", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle, name, consent: { ...consent, ageConfirmed } }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: { message?: string } };
        throw new Error(body.error?.message ?? "アカウントを設定できませんでした");
      }
      window.location.assign(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "アカウントを設定できませんでした");
      setBusy(false);
    }
  }

  return (
    <main id="main" className="welcome-stage">
      <div className="welcome-intro">
        <p className="eyebrow">WELCOME TO LUMORPHIA</p>
        <h1>アカウントを設定</h1>
        <p className="sub">Lumorphia のサービスで使う表示名とユーザーIDを決めてください。</p>
      </div>
      <section className="panel section">
        {!loading && <LegacyMigrationGuide onChooseHandle={setHandle} />}
        {loading && <p role="status">読み込み中</p>}
        {!loading && (
          <form onSubmit={(event) => void submit(event)}>
            <div className="field">
              <label htmlFor="welcome-name">表示名</label>
              <input
                id="welcome-name"
                data-testid="welcome-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={50}
                required
                aria-describedby="welcome-name-help"
              />
              <p className="helper" id="welcome-name-help">
                サービス内で表示される名前です。
              </p>
            </div>
            <div className="field">
              <label htmlFor="welcome-handle">ユーザーID</label>
              <div className="handle-input">
                <span aria-hidden="true">@</span>
                <input
                  id="welcome-handle"
                  data-testid="welcome-handle"
                  value={handle}
                  onChange={(event) => setHandle(event.target.value.toLowerCase())}
                  pattern="[a-z0-9_]{3,20}"
                  minLength={3}
                  maxLength={20}
                  required
                  aria-describedby="welcome-handle-help welcome-handle-format"
                  autoCapitalize="none"
                  spellCheck={false}
                />
              </div>
              <p className="helper" id="welcome-handle-help">
                表示名が同じ人を区別するためのIDです。@mizuki
                のように表示され、他の人と同じIDは使えません。
              </p>
              <p className="helper" id="welcome-handle-format">
                半角英小文字・数字・アンダースコアで3〜20文字。
              </p>
            </div>
            <div className="notice">
              ここで設定した表示名とユーザーIDは、PrismtoneやScenoteでも使います。
            </div>
            <p className="helper" id="age-policy">
              <a
                className="text-link"
                href="https://support.jp.square-enix.com/rule.php?id=5381&tag=users"
                target="_blank"
                rel="noopener noreferrer"
              >
                FFXIVの利用規約
              </a>
              の年齢条件に合わせ、Lumorphiaも15歳以上の方を対象としています。未成年の方は、保護者の同意を得て登録してください。
            </p>
            <div className="consent">
              <label>
                <input
                  type="checkbox"
                  required
                  aria-describedby="age-policy"
                  checked={ageConfirmed}
                  onChange={(event) => setAgeConfirmed(event.target.checked)}
                />
                私は15歳以上です
              </label>
              <label>
                <input
                  type="checkbox"
                  required
                  checked={legalConfirmed}
                  onChange={(event) => setLegalConfirmed(event.target.checked)}
                />
                <span>
                  <a href="/terms" target="_blank" rel="noopener" className="text-link">
                    利用規約
                  </a>
                  と
                  <a href="/privacy" target="_blank" rel="noopener" className="text-link">
                    プライバシーポリシー
                  </a>
                  を読み、同意します
                </span>
              </label>
            </div>
            <button
              type="submit"
              disabled={busy || !consent || !ageConfirmed || !legalConfirmed}
              className="primary welcome-submit"
            >
              {busy ? "設定を保存しています…" : "設定を完了"}
            </button>
          </form>
        )}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
      </section>
    </main>
  );
}
