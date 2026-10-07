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
    <main className="mx-auto max-w-md space-y-5 p-8">
      <h1 className="text-2xl font-semibold">アカウントを設定</h1>
      <p className="text-sm text-ink-muted">Lumorphia で使う ID と表示名を決めてください。</p>
      {!loading && <LegacyMigrationGuide onChooseHandle={setHandle} />}
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
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              required
              checked={ageConfirmed}
              onChange={(event) => setAgeConfirmed(event.target.checked)}
            />
            15歳以上です
          </label>
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              required
              checked={legalConfirmed}
              onChange={(event) => setLegalConfirmed(event.target.checked)}
            />
            <span>
              <a href="/terms" target="_blank" rel="noopener" className="underline">
                利用規約
              </a>
              と
              <a href="/privacy" target="_blank" rel="noopener" className="underline">
                プライバシーポリシー
              </a>
              を読み、同意します
            </span>
          </label>
          <button
            type="submit"
            disabled={busy || !consent || !ageConfirmed || !legalConfirmed}
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
