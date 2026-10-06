import type { Route } from "./+types/home";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Lumorphia アカウント" }];
}

export default function Home() {
  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold">Lumorphia アカウント</h1>
      <p className="mt-2 text-ink-muted">
        Lumorphia のサービス (Prismtone、Scenote) で使うアカウントです。準備中です。
      </p>
      <a href="/login" className="mt-6 inline-block rounded bg-accent px-4 py-2 text-accent-ink">
        ログイン
      </a>
    </main>
  );
}
