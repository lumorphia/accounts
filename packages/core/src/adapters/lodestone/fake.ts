import {
  LodestoneError,
  type LodestoneCharacter,
  type LodestoneSearchHit,
  type LodestoneSource,
} from "./types.ts";

/** テスト用。キャラクターを id で持ち、検索は name の完全一致 (大文字小文字は無視) + world */
export class FakeLodestoneSource implements LodestoneSource {
  readonly characters = new Map<string, LodestoneCharacter>();
  /** 次の呼び出しで投げるエラー (1 回で消える) */
  failNextWith: LodestoneError | null = null;
  readonly calls: { method: "search" | "fetch"; arg: string }[] = [];
  constructor(characters: readonly LodestoneCharacter[] = []) {
    for (const c of characters) this.characters.set(c.lodestoneId, c);
  }

  add(character: LodestoneCharacter): this {
    this.characters.set(character.lodestoneId, character);
    return this;
  }

  /** 自己紹介欄を書き換える (認証トークンを貼った状態を作る) */
  setSelfIntroduction(lodestoneId: string, text: string): void {
    const c = this.characters.get(lodestoneId);
    if (!c) throw new Error(`no fake character ${lodestoneId}`);
    this.characters.set(lodestoneId, { ...c, selfIntroduction: text });
  }

  private consumeFailure() {
    if (this.failNextWith) {
      const err = this.failNextWith;
      this.failNextWith = null;
      throw err;
    }
  }

  async searchCharacter(name: string, world: string): Promise<LodestoneSearchHit[]> {
    this.calls.push({ method: "search", arg: `${name}@${world}` });
    this.consumeFailure();
    return [...this.characters.values()]
      .filter((c) => c.name.toLowerCase() === name.toLowerCase() && c.world === world)
      .map(({ lodestoneId, name, world, dataCenter }) => ({
        lodestoneId,
        name,
        world,
        dataCenter,
      }));
  }

  async fetchCharacter(lodestoneId: string): Promise<LodestoneCharacter> {
    this.calls.push({ method: "fetch", arg: lodestoneId });
    this.consumeFailure();
    const c = this.characters.get(lodestoneId);
    if (!c) throw new LodestoneError("not_found");
    return c;
  }
}

export const fakeLodestoneCharacter = (
  overrides: Partial<LodestoneCharacter> & { lodestoneId: string },
): LodestoneCharacter => ({
  name: "Test Character",
  world: "Tiamat",
  dataCenter: "Gaia",
  race: "miqote",
  rawRace: "ミコッテ",
  clan: "ムーンキーパー",
  gender: "female",
  avatarUrl: null,
  portraitUrl: null,
  selfIntroduction: "",
  ...overrides,
});
