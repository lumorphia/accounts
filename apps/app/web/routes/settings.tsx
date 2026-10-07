import { useEffect, useRef, useState } from "react";
import { LegacyMigrationGuide } from "../components/legacy-migration-guide.tsx";
import { AccountLifecycleSettings } from "../components/account-lifecycle-settings.tsx";
import { CharacterSettings } from "../components/character-settings.tsx";
import type { Route } from "./+types/settings";

type User = {
  name: string;
  handle: string;
  image: string | null;
  status: string;
  nextHandleChangeAt: string | null;
};
type Account = {
  id: string;
  providerId: string;
  label: string;
  displayName: string | null;
  imageUrl: string | null;
};
type SocialProvider = "discord" | "google" | "twitter";
const providers: { id: SocialProvider; label: string }[] = [
  { id: "discord", label: "Discord" },
  { id: "google", label: "Google" },
  { id: "twitter", label: "X" },
];

export function meta() {
  return [{ title: "設定 - Lumorphia" }, { name: "robots", content: "noindex" }];
}

export function loader() {
  return {
    providers: providers.filter(({ id }) =>
      Boolean(process.env[`AUTH_${id === "twitter" ? "X" : id.toUpperCase()}_ID`]),
    ),
  };
}

async function responseBody<T>(res: Response, fallback: string): Promise<T> {
  const body = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(body.error?.message ?? fallback);
  return body;
}

export default function Settings({ loaderData }: Route.ComponentProps) {
  const [user, setUser] = useState<User | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [misskeyHost, setMisskeyHost] = useState("");
  const [mastodonHost, setMastodonHost] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const refreshed = useRef(false);

  async function load() {
    const me = await responseBody<{ user: User | null }>(
      await fetch("/api/me"),
      "読み込めませんでした",
    );
    if (!me.user) {
      window.location.assign("/login?next=%2Fsettings");
      return;
    }
    if (me.user.status === "pending") {
      window.location.assign("/welcome?next=%2Fsettings");
      return;
    }
    const linked = await responseBody<{ accounts: Account[] }>(
      await fetch("/api/me/accounts"),
      "連携を読み込めませんでした",
    );
    setUser(me.user);
    setName(me.user.name);
    setHandle(me.user.handle);
    setAccounts(linked.accounts);
    setLoading(false);
    if (
      !refreshed.current &&
      linked.accounts.some(
        (account) =>
          ["discord", "google", "twitter"].includes(account.providerId) && !account.imageUrl,
      )
    ) {
      refreshed.current = true;
      void fetch("/api/me/accounts/refresh", { method: "POST" })
        .then((res) => responseBody<{ accounts: Account[] }>(res, "更新できませんでした"))
        .then((data) => setAccounts(data.accounts))
        .catch(() => undefined);
    }
  }

  useEffect(() => {
    const error = new URLSearchParams(window.location.search).get("error");
    if (error) setLinkError("アカウントを接続できませんでした");
    void load().catch((cause) => {
      setLinkError(cause instanceof Error ? cause.message : "読み込めませんでした");
      setLoading(false);
    });
  }, []);

  const lockedUntil = user?.nextHandleChangeAt ? new Date(user.nextHandleChangeAt) : null;
  const handleLocked = !!lockedUntil && lockedUntil.getTime() > Date.now();
  const handleValid = /^[a-z0-9_]{3,20}$/.test(handle);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const body = await responseBody<{
        profile: { name: string; handle: string; nextHandleChangeAt: string | null };
      }>(
        await fetch("/api/me/profile", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name,
            ...(handle !== user?.handle && !handleLocked ? { handle } : {}),
          }),
        }),
        "保存できませんでした",
      );
      setUser((current) => (current ? { ...current, ...body.profile } : current));
      setMessage({ ok: true, text: "保存しました" });
    } catch (cause) {
      setMessage({
        ok: false,
        text: cause instanceof Error ? cause.message : "保存できませんでした",
      });
    } finally {
      setBusy(false);
    }
  }

  async function upload(file: File) {
    setBusy(true);
    setMessage(null);
    try {
      const body = await responseBody<{ image: string }>(
        await fetch("/api/me/avatar", {
          method: "PUT",
          headers: { "content-type": file.type },
          body: file,
        }),
        "アイコンを保存できませんでした",
      );
      setUser((current) => (current ? { ...current, image: body.image } : current));
      setMessage({ ok: true, text: "アイコンを保存しました" });
    } catch (cause) {
      setMessage({
        ok: false,
        text: cause instanceof Error ? cause.message : "保存できませんでした",
      });
    } finally {
      setBusy(false);
    }
  }

  async function removeAvatar() {
    setBusy(true);
    try {
      const res = await fetch("/api/me/avatar", { method: "DELETE" });
      if (!res.ok) throw new Error("アイコンを削除できませんでした");
      setUser((current) => (current ? { ...current, image: null } : current));
      setMessage({ ok: true, text: "アイコンを削除しました" });
    } catch (cause) {
      setMessage({
        ok: false,
        text: cause instanceof Error ? cause.message : "削除できませんでした",
      });
    } finally {
      setBusy(false);
    }
  }

  async function useAccountAvatar(accountId: string) {
    setBusy(true);
    try {
      const body = await responseBody<{ image: string }>(
        await fetch("/api/me/avatar/from-account", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ accountId }),
        }),
        "アイコンを取り込めませんでした",
      );
      setUser((current) => (current ? { ...current, image: body.image } : current));
      setLinkError(null);
    } catch (cause) {
      setLinkError(cause instanceof Error ? cause.message : "取り込めませんでした");
    } finally {
      setBusy(false);
    }
  }

  async function unlink(accountId: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/me/accounts/${encodeURIComponent(accountId)}`, {
        method: "DELETE",
      });
      await responseBody(res, "連携を解除できませんでした");
      setAccounts((current) => current.filter((account) => account.id !== accountId));
      setLinkError(null);
    } catch (cause) {
      setLinkError(cause instanceof Error ? cause.message : "解除できませんでした");
    } finally {
      setBusy(false);
    }
  }

  async function beginLink(path: string, body: Record<string, string>) {
    setBusy(true);
    setLinkError(null);
    try {
      const result = await responseBody<{ url: string }>(
        await fetch(path, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...body, callbackURL: "/settings" }),
        }),
        "接続を開始できませんでした",
      );
      if (!result.url) throw new Error("接続を開始できませんでした");
      window.location.assign(result.url);
    } catch (cause) {
      setLinkError(cause instanceof Error ? cause.message : "接続できませんでした");
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl space-y-10 p-8">
      <h1 className="text-2xl font-semibold">設定</h1>
      {loading ? <p>読み込み中</p> : null}
      {user && (
        <>
          <section className="space-y-4" aria-labelledby="profile-heading">
            <h2 id="profile-heading" className="text-xl font-semibold">
              プロフィール
            </h2>
            {user.image && (
              <img
                src={user.image}
                alt="現在のアイコン"
                className="h-20 w-20 rounded-full object-cover"
              />
            )}
            <label className="block text-sm">
              アイコンを選ぶ
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={busy}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void upload(file);
                }}
                className="mt-1 block"
                data-testid="settings-avatar-file"
              />
            </label>
            {user.image && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void removeAvatar()}
                className="rounded border border-line px-3 py-1 text-sm disabled:opacity-50"
              >
                アイコンを削除
              </button>
            )}
            <form onSubmit={(event) => void save(event)} className="space-y-4">
              <label className="block text-sm">
                表示名
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={50}
                  required
                  className="mt-1 block w-full rounded border border-line bg-surface-raised p-2"
                  data-testid="settings-name"
                />
              </label>
              <label className="block text-sm">
                ID
                <input
                  value={handle}
                  onChange={(event) => setHandle(event.target.value.toLowerCase())}
                  maxLength={20}
                  disabled={handleLocked}
                  spellCheck={false}
                  className="mt-1 block w-full rounded border border-line bg-surface-raised p-2 disabled:opacity-60"
                  data-testid="settings-handle"
                />
                <span className="mt-1 block text-xs text-ink-muted">
                  3〜20 文字の半角英小文字・数字・_。変更は 30 日に 1 回です。
                </span>
                {handleLocked && lockedUntil && (
                  <span
                    className="mt-1 block text-xs text-ink-muted"
                    data-testid="settings-handle-locked"
                  >
                    ID は 30 日後の {lockedUntil.toLocaleDateString("ja-JP")} まで変更できません
                  </span>
                )}
              </label>
              {message && (
                <p
                  role={message.ok ? "status" : "alert"}
                  data-testid="settings-profile-message"
                  className="text-sm"
                >
                  {message.text}
                </p>
              )}
              <button
                type="submit"
                disabled={busy || !handleValid || !name.trim()}
                className="rounded bg-accent px-4 py-2 text-accent-ink disabled:opacity-50"
                data-testid="settings-save"
              >
                保存
              </button>
            </form>
          </section>
          <CharacterSettings />
          <section className="space-y-4" aria-labelledby="accounts-heading">
            <h2 id="accounts-heading" className="text-xl font-semibold">
              接続しているアカウント
            </h2>
            <p className="text-sm text-ink-muted">
              どの連携先からもログインできます。最後の 1 件は解除できません。
            </p>
            <ul
              className="divide-y divide-line-soft rounded border border-line-soft"
              data-testid="linked-accounts"
            >
              {accounts.map((account) => (
                <li
                  key={account.id}
                  className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm"
                  data-testid="linked-account"
                >
                  <span>
                    {account.label}
                    {account.displayName ? ` · ${account.displayName}` : ""}
                  </span>
                  <span className="flex gap-2">
                    {account.imageUrl && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void useAccountAvatar(account.id)}
                        className="rounded border border-line px-2 py-1 disabled:opacity-50"
                      >
                        アイコンに使う
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busy || accounts.length <= 1}
                      onClick={() => void unlink(account.id)}
                      className="rounded border border-line px-2 py-1 disabled:opacity-50"
                      data-testid="unlink-account"
                    >
                      解除
                    </button>
                  </span>
                </li>
              ))}
            </ul>
            {linkError && (
              <p role="alert" className="text-sm text-red-700">
                {linkError}
              </p>
            )}
            <h3 className="text-sm font-medium">アカウントを追加</h3>
            <div className="flex flex-wrap gap-2">
              {loaderData.providers
                .filter(({ id }) => !accounts.some((account) => account.providerId === id))
                .map(({ id, label }) => (
                  <button
                    key={id}
                    type="button"
                    disabled={busy}
                    onClick={() => void beginLink("/api/auth/link-social", { provider: id })}
                    className="rounded border border-line px-3 py-2 text-sm disabled:opacity-50"
                  >
                    {label} を接続
                  </button>
                ))}
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void beginLink("/api/auth/miauth/start", { host: misskeyHost.trim() });
              }}
              className="flex flex-wrap items-end gap-2"
            >
              <label className="text-sm">
                Misskey のサーバー
                <input
                  value={misskeyHost}
                  onChange={(event) => setMisskeyHost(event.target.value)}
                  placeholder="misskey.io"
                  required
                  className="mt-1 block rounded border border-line bg-surface-raised p-2"
                />
              </label>
              <button
                type="submit"
                disabled={busy}
                className="rounded border border-line px-3 py-2 text-sm disabled:opacity-50"
              >
                Misskey を接続
              </button>
            </form>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void beginLink("/api/auth/mastodon/start", { host: mastodonHost.trim() });
              }}
              className="flex flex-wrap items-end gap-2"
            >
              <label className="text-sm">
                Mastodon のサーバー
                <input
                  value={mastodonHost}
                  onChange={(event) => setMastodonHost(event.target.value)}
                  placeholder="mstdn.jp"
                  required
                  className="mt-1 block rounded border border-line bg-surface-raised p-2"
                />
              </label>
              <button
                type="submit"
                disabled={busy}
                className="rounded border border-line px-3 py-2 text-sm disabled:opacity-50"
              >
                Mastodon を接続
              </button>
            </form>
          </section>
          <LegacyMigrationGuide />
          <AccountLifecycleSettings handle={user.handle} />
        </>
      )}
    </main>
  );
}
