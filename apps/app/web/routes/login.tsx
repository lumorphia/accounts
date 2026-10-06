import { useState } from "react";
import { useSearchParams } from "react-router";
import type { Route } from "./+types/login";

const providers = [
  { id: "discord", label: "Discord" },
  { id: "google", label: "Google" },
  { id: "twitter", label: "X" },
] as const;

function safeNext(value: string | null): string {
  return value?.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\")
    ? value
    : "/";
}

export function meta() {
  return [{ title: "ログイン - Lumorphia" }, { name: "robots", content: "noindex" }];
}

export function loader() {
  return {
    providers: providers.filter(({ id }) =>
      Boolean(process.env[`AUTH_${id === "twitter" ? "X" : id.toUpperCase()}_ID`]),
    ),
    devLogin: process.env.NODE_ENV !== "production",
  };
}

export default function Login({ loaderData }: Route.ComponentProps) {
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const [handle, setHandle] = useState("tester");
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
    <main className="mx-auto max-w-sm space-y-6 p-8">
      <h1 className="text-2xl font-semibold">Lumorphia にログイン</h1>
      <p className="text-sm text-ink-muted">Lumorphia アカウントでサービスにログインできます。</p>
      <div className="space-y-2">
        {loaderData.providers.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            disabled={busy}
            onClick={() => void social(id)}
            className="block w-full rounded border border-line p-3 text-left hover:bg-surface-hover disabled:opacity-50"
          >
            {label} でログイン
          </button>
        ))}
      </div>
      {loaderData.devLogin && (
        <form
          onSubmit={(event) => void dev(event)}
          className="space-y-3 rounded border border-line p-4"
          data-testid="dev-login"
        >
          <label htmlFor="dev-handle" className="block text-sm">
            開発用ログイン
          </label>
          <input
            id="dev-handle"
            value={handle}
            onChange={(event) => setHandle(event.target.value)}
            className="w-full rounded border border-line bg-surface-raised p-2"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded bg-accent px-4 py-2 text-accent-ink disabled:opacity-50"
          >
            ログイン
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </main>
  );
}
