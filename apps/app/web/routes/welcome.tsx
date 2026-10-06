import { useEffect, useState } from "react";
import type { Route } from "./+types/welcome";

export function meta() {
  return [{ title: "アカウントの設定 - Lumorphia" }, { name: "robots", content: "noindex" }];
}

export default function Welcome(_: Route.ComponentProps) {
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetch("/api/me")
      .then((res) => res.json())
      .then((data: { user: { name: string; status: string } | null }) => {
        if (!data.user) {
          window.location.assign("/login");
          return;
        }
        if (data.user.status !== "pending") {
          window.location.assign("/");
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
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/me/onboarding", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle, name }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: { message?: string } };
        throw new Error(body.error?.message ?? "アカウントを設定できませんでした");
      }
      window.location.assign("/");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "アカウントを設定できませんでした");
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-md space-y-5 p-8">
      <h1 className="text-2xl font-semibold">アカウントを設定</h1>
      <p className="text-sm text-ink-muted">Lumorphia で使う ID と表示名を決めてください。</p>
      {!loading && (
        <form onSubmit={(event) => void submit(event)} className="space-y-4">
          <label htmlFor="welcome-handle" className="block text-sm">
            ID
          </label>
          <input
            id="welcome-handle"
            data-testid="welcome-handle"
            value={handle}
            onChange={(event) => setHandle(event.target.value.toLowerCase())}
            minLength={3}
            maxLength={20}
            required
            className="w-full rounded border border-line bg-surface-raised p-2"
          />
          <label htmlFor="welcome-name" className="block text-sm">
            表示名
          </label>
          <input
            id="welcome-name"
            data-testid="welcome-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={50}
            required
            className="w-full rounded border border-line bg-surface-raised p-2"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded bg-accent px-4 py-2 text-accent-ink disabled:opacity-50"
          >
            設定を完了
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
