import { useEffect, useState } from "react";
import { useSearchParams, useRouteLoaderData } from "react-router";
import type { loader } from "../root.tsx";
import { LegacyMigrationGuide } from "../components/legacy-migration-guide.tsx";
import { AccountRecovery, ServiceRecovery } from "../components/recovery.tsx";
import { loginNext } from "../auth/login-next.ts";
import type { Route } from "./+types/home";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Lumorphia アカウント" }];
}

type Me = { status: string; recoverUntil: string | null };
type Session =
  | { kind: "loading" | "guest" | "error" }
  | { kind: "authenticated" }
  | { kind: "deleted"; recoverUntil: string };

export default function Home() {
  const root = useRouteLoaderData<typeof loader>("root");
  const website = root?.websiteOrigin ?? "https://lumorphia.com";
  const [params] = useSearchParams();
  const [session, setSession] = useState<Session>({ kind: "loading" });
  const next = loginNext(params);
  const service = params.get("service");
  useEffect(() => {
    void fetch("/api/me")
      .then((res) => {
        if (!res.ok) throw new Error("ログイン状態を確認できませんでした");
        return res.json();
      })
      .then((data: { user: Me | null }) => {
        if (data.user?.status === "pending") {
          window.location.assign("/welcome");
          return;
        }
        if (data.user?.status === "deleted" && data.user.recoverUntil) {
          setSession({ kind: "deleted", recoverUntil: data.user.recoverUntil });
          return;
        }
        if (data.user && !service) {
          window.location.assign(`${website}/`);
          return;
        }
        if (!data.user) {
          window.location.assign("/login");
          return;
        }
        setSession({ kind: data.user ? "authenticated" : "guest" });
      })
      .catch(() => setSession({ kind: "error" }));
  }, [service, website]);
  return (
    <main id="main" className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold">アカウントの確認</h1>
      {session.kind === "loading" && <p role="status">ログイン状態を確認しています…</p>}
      {session.kind === "deleted" ? (
        <AccountRecovery
          recoverUntil={session.recoverUntil}
          next={next}
          onRestored={() => {
            // 全体を戻したあとも、そのサービスだけの退会が残っていればここでもう一度選ばせる
            if (service) setSession({ kind: "authenticated" });
            else window.location.assign(next);
          }}
        />
      ) : null}
      {session.kind === "authenticated" && service ? (
        <ServiceRecovery service={service} next={next} />
      ) : null}
      <div className="mt-6">
        <LegacyMigrationGuide />
      </div>
      {session.kind === "guest" ? (
        <a href="/login" className="mt-6 inline-block rounded bg-accent px-4 py-2 text-accent-ink">
          ログイン
        </a>
      ) : null}
      {session.kind === "authenticated" ? (
        <a href="/settings" className="mt-6 inline-block text-accent underline">
          アカウント管理
        </a>
      ) : null}
      {session.kind === "error" ? (
        <p role="alert" className="mt-6 text-ink-muted">
          ログイン状態を確認できませんでした。ページを再読み込みしてください。
        </p>
      ) : null}
    </main>
  );
}
