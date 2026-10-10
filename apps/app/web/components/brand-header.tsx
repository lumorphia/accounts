import { ExternalLinkIcon } from "./external-link-icon.tsx";
import { useEffect, useRef, useState } from "react";
import { useLocation, useRouteLoaderData } from "react-router";
import type { loader } from "../root.tsx";

type User = { name: string; handle: string; image: string | null; status: string };

export function BrandHeader() {
  const data = useRouteLoaderData<typeof loader>("root");
  const location = useLocation();
  const [user, setUser] = useState<User | null>(null);
  const [open, setOpen] = useState(false);
  const [dark, setDark] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setOpen(false);
    const controller = new AbortController();
    const refresh = () => {
      void fetch("/api/me", { signal: controller.signal })
        .then((res) => {
          if (!res.ok) throw new Error("session unavailable");
          return res.json() as Promise<{ user: User | null }>;
        })
        .then((body) => setUser(body.user))
        .catch(() => undefined);
    };
    refresh();
    window.addEventListener("lumorphia-profile-change", refresh);
    return () => {
      controller.abort();
      window.removeEventListener("lumorphia-profile-change", refresh);
    };
  }, [location.pathname]);
  useEffect(() => {
    const sync = () => setDark(document.documentElement.dataset.theme === "dark");
    sync();
    window.addEventListener("lumorphia-theme-change", sync);
    return () => window.removeEventListener("lumorphia-theme-change", sync);
  }, []);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  const website = data?.websiteOrigin ?? "https://lumorphia.com";
  return (
    <header className="brand-header">
      <a className="brand" href={`${website}/`} aria-label="Lumorphia トップ">
        <img className="brand-icon" src="/brand/lumorphia-icon.png" width="36" height="36" alt="" />
        <span className="wordmark">Lumorphia</span>
        <span className="account-label">アカウント</span>
      </a>
      <div className="header-actions">
        <button
          className="theme-control"
          type="button"
          aria-label={dark ? "ライト表示に切り替える" : "ダーク表示に切り替える"}
          aria-pressed={dark}
          onClick={() => {
            const theme = dark ? "light" : "dark";
            document.documentElement.dataset.theme = theme;
            document.documentElement.dataset.themeSelected = "true";
            try {
              localStorage.setItem("lumorphia-theme", theme);
            } catch {
              /* 保存できなくても切り替える。 */
            }
            setDark(!dark);
          }}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            {dark ? (
              <>
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
              </>
            ) : (
              <path d="M20.5 14A9 9 0 0 1 10 3.5 9 9 0 1 0 20.5 14Z" />
            )}
          </svg>
        </button>
        {user?.status === "active" && (
          <div className="account-menu-wrap" ref={menu}>
            <button
              ref={button}
              type="button"
              className="account-menu-toggle"
              aria-label="アカウントメニュー"
              aria-expanded={open}
              aria-controls="account-menu"
              onClick={() => setOpen(!open)}
            >
              <span className="avatar" aria-hidden="true">
                {user.image ? (
                  <img src={user.image} alt="" />
                ) : (
                  Array.from(user.name)[0]?.toUpperCase()
                )}
              </span>
              <span className="account-menu-label">{user.name}</span>
              <span aria-hidden="true">⌄</span>
            </button>
            <div
              className="account-menu"
              id="account-menu"
              data-testid="account-menu"
              hidden={!open}
            >
              <div className="menu-identity">
                <strong>{user.name}</strong>
                <small>@{user.handle}</small>
              </div>
              {location.pathname !== "/settings" && <a href="/settings">アカウント管理</a>}
              <a href={`${website}/`}>
                Lumorphia トップ <ExternalLinkIcon />
              </a>
              <form action="/logout" method="post">
                <button type="submit">ログアウト</button>
              </form>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
