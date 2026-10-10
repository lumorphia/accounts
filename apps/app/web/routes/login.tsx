import { ProviderIcon } from "../components/provider-icon.tsx";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { loginNext } from "../auth/login-next.ts";
import type { Route } from "./+types/login";

const providers = [
  { id: "discord", label: "Discord" },
  { id: "google", label: "Google" },
  { id: "twitter", label: "X" },
] as const;

export function meta() {
  return [{ title: "ログイン - Lumorphia" }, { name: "robots", content: "noindex" }];
}

export function loader() {
  return {
    providers: providers.filter(({ id }) =>
      Boolean(
        process.env[`AUTH_${id === "twitter" ? "X" : id.toUpperCase()}_ID`] &&
        process.env[`AUTH_${id === "twitter" ? "X" : id.toUpperCase()}_SECRET`],
      ),
    ),
    devLogin: process.env.NODE_ENV !== "production",
  };
}

export default function Login({ loaderData }: Route.ComponentProps) {
  const [params] = useSearchParams();
  const next = loginNext(params);
  const [handle, setHandle] = useState("tester");
  const [misskeyHost, setMisskeyHost] = useState("");
  const [mastodonHost, setMastodonHost] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function social(provider: "discord" | "google" | "twitter") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/sign-in/social", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, callbackURL: next }),
      });
      const data = (await res.json()) as { url?: string };
      if (!res.ok || !data.url) throw new Error("ログインを開始できませんでした");
      window.location.assign(data.url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "ログインに失敗しました");
      setBusy(false);
    }
  }

  async function federated(provider: "miauth" | "mastodon", host: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/auth/${provider}/start`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ host, callbackURL: next }),
      });
      const data = (await res.json()) as { url?: string };
      if (!res.ok || !data.url) throw new Error("ログインを開始できませんでした");
      window.location.assign(data.url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "ログインに失敗しました");
      setBusy(false);
    }
  }

  async function dev(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/dev/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle }),
      });
      if (!res.ok) throw new Error("開発用ログインに失敗しました");
      window.location.assign(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "ログインに失敗しました");
      setBusy(false);
    }
  }

  return (
    <main id="main" className="login-stage">
      <div className="intro">
        <div className="eyebrow">LUMORPHIA ACCOUNT</div>
        <h1>
          いつもの自分で、
          <br />
          それぞれの場所へ。
        </h1>
        <p>
          ひとつのアカウントで、
          <br />
          PrismtoneやScenoteを利用できます。
        </p>
        <div className="intro-art" aria-hidden="true">
          <div className="intro-visual">
            <div className="intro-glow" />
            <img src="/brand/lumorphia-logo.png" width="1983" height="793" alt="" />
          </div>
        </div>
        <div className="services" aria-label="Lumorphia のサービス">
          <span className="prismtone-mini">
            <img className="logo-light" src="/brand/prismtone-light-wordmark.svg" alt="Prismtone" />
            <img
              className="logo-dark"
              src="/brand/prismtone-dark-wordmark.svg"
              alt=""
              aria-hidden="true"
            />
          </span>
          <span>Scenote</span>
        </div>
      </div>
      <section className="panel login-panel" aria-labelledby="login-title">
        <h2 id="login-title">Lumorphia にログイン</h2>
        <p className="sub">ログインに使うアカウントを選んでください。</p>
        {params.get("deleted") === "1" && (
          <p role="status" className="notice">
            退会を受け付けました。30日以内なら、同じアカウントでログインして「復旧する」を選ぶと戻せます。画像は戻りません。
          </p>
        )}
        <p className="destination">
          {next.startsWith("/api/auth/oauth2/authorize?")
            ? "サービスへのログインを続けます。"
            : next.startsWith("/settings")
              ? "ログイン後はアカウント管理へ進みます。"
              : "ログイン後は Lumorphia のトップページに戻ります。"}
        </p>
        <div className="providers">
          {loaderData.providers.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              disabled={busy}
              onClick={() => void social(id)}
              className="provider"
            >
              <ProviderIcon provider={id} />
              {label} でログイン
            </button>
          ))}
        </div>
        <details>
          <summary>Misskey・Mastodon でログイン</summary>
          <div className="federated">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void federated("miauth", misskeyHost);
              }}
            >
              <label htmlFor="misskey-host">Misskey のサーバー</label>
              <div className="federated-row">
                <input
                  id="misskey-host"
                  value={misskeyHost}
                  onChange={(event) => setMisskeyHost(event.target.value)}
                  placeholder="misskey.io"
                  required
                />
                <button
                  type="submit"
                  className="secondary"
                  disabled={busy}
                  data-testid="misskey-submit"
                >
                  Misskey でログイン
                </button>
              </div>
            </form>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void federated("mastodon", mastodonHost);
              }}
            >
              <label htmlFor="mastodon-host">Mastodon のサーバー</label>
              <div className="federated-row">
                <input
                  id="mastodon-host"
                  value={mastodonHost}
                  onChange={(event) => setMastodonHost(event.target.value)}
                  placeholder="mstdn.jp"
                  required
                />
                <button
                  type="submit"
                  className="secondary"
                  disabled={busy}
                  data-testid="mastodon-submit"
                >
                  Mastodon でログイン
                </button>
              </div>
            </form>
          </div>
        </details>
        <p className="agreement">
          初めての方も、同じ方法で始められます。
          <br />
          登録時に利用規約とプライバシーポリシーをご確認いただきます。
        </p>
        {loaderData.devLogin && (
          <details className="dev-login" open>
            <summary>開発用ログイン</summary>
            <form onSubmit={(event) => void dev(event)} className="field" data-testid="dev-login">
              <label htmlFor="dev-handle">開発用ログイン</label>
              <input
                id="dev-handle"
                value={handle}
                onChange={(event) => setHandle(event.target.value)}
              />
              <button type="submit" disabled={busy} className="secondary">
                ログイン
              </button>
            </form>
          </details>
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
