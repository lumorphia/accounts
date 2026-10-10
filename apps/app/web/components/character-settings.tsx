import { useEffect, useState } from "react";

type Character = {
  id: string;
  lodestoneId: string;
  name: string;
  world: string;
  dataCenter: string;
  avatarUrl: string | null;
  isPrimary: boolean;
  verified: boolean;
  verification: { token: string; expiresAt: string } | null;
  verificationError: string | null;
  lastSyncedAt: string | null;
  syncError: string | null;
};
const messages: Record<string, string> = {
  lodestone_disabled: "Lodestone の取得を一時停止しています。登録や確認は再開後にお試しください。",
  invalid_lodestone_url: "Lodestone のキャラクター URL または ID を入力してください。",
  character_not_found: "キャラクターが見つかりません。名前とワールドを確かめてください。",
  lodestone_character_not_found: "キャラクターが見つかりません。URL または ID を確かめてください。",
  ambiguous_character: "キャラクターを特定できません。Lodestone の URL で登録してください。",
  already_registered: "このキャラクターは登録済みです。",
  too_many_characters: "登録できるキャラクターは 40 件までです。",
  token_not_found:
    "自己紹介にトークンが見つかりません。保存と反映を確かめて、もう一度確認してください。",
  token_expired: "トークンの期限が切れました。再発行して自己紹介に貼り付けてください。",
  already_verified_by_another_user:
    "別のアカウントですでに確認済みです。登録先を確かめてください。",
  lodestone_error: "Lodestone を読み込めませんでした。時間をおいてもう一度お試しください。",
  unavailable: "Lodestone を読み込めませんでした。時間をおいてもう一度お試しください。",
  parse_error: "Lodestone の情報を読み取れませんでした。時間をおいてもう一度お試しください。",
  rate_limited: "取得が混み合っています。時間をおいてもう一度お試しください。",
  sync_too_soon: "再同期は 24 時間に 1 回です。前回の同期や依頼から時間をおいてください。",
};
const explain = (
  message: string | null,
  fallback = "処理できませんでした。一覧を更新して、もう一度お試しください。",
) => (message ? (messages[message] ?? fallback) : fallback);
const buttonClass = "rounded border border-line px-3 py-1 text-sm disabled:opacity-50";
const inputClass = "mt-1 block w-full rounded border border-line bg-surface-raised p-2";
async function request<T>(path = "", method = "GET", body?: object): Promise<T> {
  const response = await fetch(`/api/me/characters${path}`, {
    method,
    ...(body
      ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
      : {}),
  });
  const data = (await response.json()) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(explain(data.error?.message ?? null));
  return data;
}

export function CharacterSettings() {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState("url");
  const [lodestone, setLodestone] = useState("");
  const [name, setName] = useState("");
  const [world, setWorld] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<string[]>([]);

  async function load() {
    const data = await request<{ enabled: boolean; characters: Character[] }>();
    setCharacters(data.characters);
    setEnabled(data.enabled);
  }
  useEffect(() => {
    void load()
      .catch(() =>
        setMessage({
          ok: false,
          text: "キャラクターを読み込めませんでした。一覧を更新してください。",
        }),
      )
      .finally(() => setLoading(false));
  }, []);
  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
    } catch (error) {
      setMessage({
        ok: false,
        text: error instanceof Error ? error.message : "処理できませんでした",
      });
    } finally {
      setBusy(false);
    }
  }
  const update = (character: Character) =>
    setCharacters((rows) => rows.map((c) => (c.id === character.id ? character : c)));
  return (
    <section className="space-y-4" aria-labelledby="characters-heading">
      <h2 id="characters-heading" className="text-xl font-semibold">
        キャラクター
      </h2>
      <p className="text-sm text-ink-muted">
        Lodestone
        の自己紹介にトークンを貼り付けて、あなたのキャラクターであることを確認します。確認済みのキャラクターを
        Lumorphia のサービスで使えます。
      </p>
      {loading && <p>キャラクターを読み込み中</p>}
      {!loading && enabled === false && (
        <p role="status">
          Lodestone
          の取得を一時停止しています。登録済みの一覧・主キャラクターの変更・登録解除は使えます。
        </p>
      )}
      <button
        type="button"
        className={buttonClass}
        disabled={busy}
        onClick={() =>
          void perform(async () => {
            await load();
            setLoading(false);
          })
        }
      >
        一覧を更新
      </button>
      <ul className="space-y-4" aria-label="登録済みのキャラクター">
        {characters.map((character) => (
          <li
            key={character.id}
            className="space-y-3 rounded border border-line p-4"
            data-testid="character-row"
          >
            <div className="flex items-center gap-3">
              {character.avatarUrl && (
                <img src={character.avatarUrl} alt="" className="h-10 w-10 rounded-full" />
              )}
              <div>
                <a
                  href={`https://jp.finalfantasyxiv.com/lodestone/character/${character.lodestoneId}/`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium underline"
                >
                  {character.name}
                </a>
                <p className="text-sm text-ink-muted">
                  {character.world} [{character.dataCenter}] ·{" "}
                  {character.verified ? "確認済み" : "未確認"}
                  {character.isPrimary ? " · 主キャラクター" : ""}
                </p>
              </div>
            </div>
            {!character.verified && (
              <div className="space-y-2 text-sm">
                {character.verification ? (
                  <>
                    <p>
                      Lodestone
                      の自己紹介に以下のトークンを貼り付け、保存したあと「所有確認を実行」を押してください。確認が終わったら自己紹介から取り除けます。
                    </p>
                    <label className="block">
                      確認用トークン
                      <input
                        readOnly
                        value={character.verification.token}
                        className={`${inputClass} font-mono`}
                        onFocus={(event) => event.target.select()}
                      />
                    </label>
                    <p>
                      有効期限: {new Date(character.verification.expiresAt).toLocaleString("ja-JP")}
                      （発行から 24 時間）
                    </p>
                  </>
                ) : (
                  <p>トークンの期限が切れました。再発行して自己紹介に貼り付けてください。</p>
                )}
                {character.verificationError && (
                  <p role="status">{explain(character.verificationError)}</p>
                )}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={buttonClass}
                    disabled={busy || !enabled || !character.verification}
                    onClick={() =>
                      void perform(async () => {
                        const result = await request<{ result: string; character: Character }>(
                          `/${character.id}/verify`,
                          "POST",
                        );
                        update(result.character);
                        setMessage({
                          ok: result.result === "verified",
                          text:
                            result.result === "verified"
                              ? "所有確認ができました"
                              : explain(result.result),
                        });
                      })
                    }
                  >
                    所有確認を実行
                  </button>
                  <button
                    type="button"
                    className={buttonClass}
                    disabled={busy || !enabled}
                    onClick={() =>
                      void perform(async () => {
                        const result = await request<{ character: Character }>(
                          `/${character.id}/token`,
                          "POST",
                        );
                        update(result.character);
                        setMessage({
                          ok: true,
                          text: "トークンを再発行しました。自己紹介のトークンを置き換えてください。",
                        });
                      })
                    }
                  >
                    トークンを再発行
                  </button>
                </div>
              </div>
            )}
            {character.verified && (
              <div className="space-y-2 text-sm">
                <p>
                  最終同期:{" "}
                  {character.lastSyncedAt
                    ? new Date(character.lastSyncedAt).toLocaleString("ja-JP")
                    : "未同期"}
                  。再同期は 24 時間に 1 回です。通常は週に 1 回自動で更新します。
                </p>
                {character.syncError && (
                  <p role="status">
                    同期できない状態が続いています。{explain(character.syncError)}
                  </p>
                )}
                <button
                  type="button"
                  className={buttonClass}
                  disabled={
                    busy ||
                    !enabled ||
                    syncing.includes(character.id) ||
                    (!!character.lastSyncedAt &&
                      Date.now() - new Date(character.lastSyncedAt).getTime() < 86_400_000)
                  }
                  onClick={() =>
                    void perform(async () => {
                      await request(`/${character.id}/sync`, "POST");
                      setSyncing((ids) => [...ids, character.id]);
                      setMessage({
                        ok: true,
                        text: "再同期を受け付けました。少し待って一覧を更新してください。",
                      });
                    })
                  }
                >
                  再同期を依頼
                </button>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {!character.isPrimary && (
                <button
                  type="button"
                  className={buttonClass}
                  disabled={busy}
                  onClick={() =>
                    void perform(async () => {
                      await request(`/${character.id}/primary`, "PUT");
                      await load();
                      setMessage({ ok: true, text: "主キャラクターを変更しました" });
                    })
                  }
                >
                  主キャラクターにする
                </button>
              )}
              {removing === character.id ? (
                <div className="space-y-2 text-sm">
                  <p>{character.name} の登録を解除します。再登録するときは所有確認が必要です。</p>
                  <button
                    type="button"
                    className={buttonClass}
                    disabled={busy}
                    onClick={() =>
                      void perform(async () => {
                        await request(`/${character.id}`, "DELETE");
                        await load();
                        setRemoving(null);
                        setMessage({ ok: true, text: "キャラクターの登録を解除しました" });
                      })
                    }
                  >
                    解除する
                  </button>{" "}
                  <button
                    type="button"
                    className={buttonClass}
                    disabled={busy}
                    onClick={() => setRemoving(null)}
                  >
                    キャンセル
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className={buttonClass}
                  disabled={busy}
                  onClick={() => setRemoving(character.id)}
                >
                  登録を解除
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {!loading && characters.length === 0 && (
        <p className="text-sm">登録済みのキャラクターはありません。</p>
      )}
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          void perform(async () => {
            await request(
              "",
              "POST",
              mode === "url"
                ? { lodestone: lodestone.trim() }
                : { name: name.trim(), world: world.trim() },
            );
            await load();
            setLodestone("");
            setName("");
            setWorld("");
            setMessage({
              ok: true,
              text: "登録しました。自己紹介にトークンを貼り付けて所有確認を進めてください。",
            });
          });
        }}
      >
        <h3 className="font-medium">キャラクターを追加</h3>
        <div className="character-method-tabs" role="tablist" aria-label="登録方法">
          {(["url", "search"] as const).map((method) => (
            <button
              key={method}
              id={`character-method-${method}`}
              type="button"
              role="tab"
              aria-selected={mode === method}
              aria-controls="character-registration-panel"
              tabIndex={mode === method ? 0 : -1}
              disabled={busy || !enabled}
              onClick={() => setMode(method)}
              onKeyDown={(event) => {
                let next: string;
                if (event.key === "Home") next = "url";
                else if (event.key === "End") next = "search";
                else if (event.key === "ArrowLeft" || event.key === "ArrowRight")
                  next = method === "url" ? "search" : "url";
                else return;
                event.preventDefault();
                setMode(next);
                document.getElementById(`character-method-${next}`)?.focus();
              }}
            >
              {method === "url" ? "URL・ID" : "名前・ワールド"}
            </button>
          ))}
        </div>
        <div
          id="character-registration-panel"
          role="tabpanel"
          aria-labelledby={`character-method-${mode}`}
          className="space-y-3"
          tabIndex={0}
        >
          {mode === "url" ? (
            <label className="block text-sm">
              Lodestone の URL または ID
              <input
                value={lodestone}
                onChange={(event) => setLodestone(event.target.value)}
                maxLength={512}
                placeholder="例：https://jp.finalfantasyxiv.com/lodestone/character/15022394/"
                required
                disabled={busy || !enabled}
                className={inputClass}
              />
            </label>
          ) : (
            <>
              <label className="block text-sm">
                キャラクター名
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={40}
                  required
                  disabled={busy || !enabled}
                  className={inputClass}
                />
              </label>
              <label className="block text-sm">
                ワールド
                <input
                  value={world}
                  onChange={(event) => setWorld(event.target.value)}
                  maxLength={40}
                  pattern="[A-Za-z]+"
                  required
                  disabled={busy || !enabled}
                  className={inputClass}
                  placeholder="Tiamat"
                />
              </label>
            </>
          )}
        </div>
        <p className="text-xs text-ink-muted">最大 40 件登録できます。</p>
        <button
          type="submit"
          className={buttonClass}
          disabled={busy || !enabled || characters.length >= 40}
        >
          キャラクターを登録
        </button>
      </form>
      {message && (
        <p
          role={message.ok ? "status" : "alert"}
          className="text-sm"
          data-testid="character-message"
        >
          {message.text}
        </p>
      )}
    </section>
  );
}
