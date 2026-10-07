import { useEffect, useState } from "react";
import { LegacyMigrationGuide } from "../components/legacy-migration-guide.tsx";
import type { Route } from "./+types/home";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Lumorphia アカウント" }];
}

export default function Home() {
  const [session, setSession] = useState<"loading" | "guest" | "authenticated" | "error">(
    "loading",
  );
  useEffect(() => {
    void fetch("/api/me")
      .then((res) => {
        if (!res.ok) throw new Error("ログイン状態を確認できませんでした");
        return res.json();
      })
      .then((data: { user: { status: string } | null }) => {
        if (data.user?.status === "pending") {
          window.location.assign("/welcome");
          return;
        }
        setSession(data.user ? "authenticated" : "guest");
      })
      .catch(() => setSession("error"));
  }, []);
  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold">Lumorphia アカウント</h1>
      <p className="mt-2 text-ink-muted">
        Lumorphia のサービス (Prismtone、Scenote) で使うアカウントです。準備中です。
      </p>
      <div className="mt-6">
        <LegacyMigrationGuide />
      </div>
      {session === "guest" ? (
        <a href="/login" className="mt-6 inline-block rounded bg-accent px-4 py-2 text-accent-ink">
          ログイン
        </a>
      ) : null}
      {session === "authenticated" ? (
        <a href="/settings" className="mt-6 inline-block text-accent underline">
          設定
        </a>
      ) : null}
      {session === "error" ? (
        <p role="alert" className="mt-6 text-ink-muted">
          ログイン状態を確認できませんでした。ページを再読み込みしてください。
        </p>
      ) : null}
    </main>
  );
}
