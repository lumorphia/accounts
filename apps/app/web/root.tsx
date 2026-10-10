import { useEffect } from "react";
import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteLoaderData,
} from "react-router";
import type { Route } from "./+types/root";
import "./app.css";
import { BrandHeader } from "./components/brand-header.tsx";

/** 全ルート共通の公開設定。プロフィールとセッションは本人APIで読む。 */
export async function loader() {
  return {
    // CI が Docker の ARG で埋める。ローカルでは未設定
    version: process.env.APP_VERSION ?? "dev",
    websiteOrigin: new URL(process.env.WEBSITE_ORIGIN ?? "https://lumorphia.com").origin,
    sentryDsn: process.env.SENTRY_DSN ?? "",
    sentryEnvironment: process.env.SENTRY_ENVIRONMENT ?? "production",
  };
}

export function Layout({ children }: { children: React.ReactNode }) {
  // ErrorBoundary からも呼ばれるので loader が無いことがある
  const data = useRouteLoaderData<typeof loader>("root");
  return (
    <html lang="ja" data-theme="light" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="app-version" content={data?.version ?? "dev"} />
        <link rel="icon" href="/brand/lumorphia-icon.png" type="image/png" />
        <script src="/theme.js" />
        {data?.sentryDsn ? <meta name="sentry-dsn" content={data.sentryDsn} /> : null}
        <meta name="sentry-environment" content={data?.sentryEnvironment ?? "production"} />
        <Meta />
        <Links />
      </head>
      <body className="min-h-dvh bg-surface text-ink antialiased">
        <a href="#main" className="sr-only focus:not-sr-only">
          本文へ移動
        </a>
        <div className="shell account-shell">
          <BrandHeader />
          {children}
          <footer>
            <span>© Lumorphia</span>
            <nav className="footer-links" aria-label="フッター">
              <a href="/terms" className="underline">
                利用規約
              </a>
              <a href="/privacy" className="underline">
                プライバシーポリシー
              </a>
              <a href="https://forms.gle/cn7FLf8W8gqehL977" className="underline">
                お問い合わせ
              </a>
            </nav>
          </footer>
        </div>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  // hydration が終わった印。E2E はこれを待ってからクリックする (hydration 前のクリックは React に届かず空振りする)
  useEffect(() => {
    document.documentElement.dataset.hydrated = "true";
  }, []);
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "エラー";
  let detail = "予期しないエラーが発生しました。";
  if (isRouteErrorResponse(error)) {
    title = error.status === 404 ? "ページが見つかりません" : `エラー (${error.status})`;
    detail = error.status === 404 ? "URL をお確かめください。" : error.statusText || detail;
  } else if (import.meta.env.DEV && error instanceof Error) {
    detail = error.message;
  }
  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="mt-2 text-ink-muted">{detail}</p>
    </main>
  );
}
