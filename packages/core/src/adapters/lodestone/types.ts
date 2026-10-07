/**
 * Lodestone の境界 (prismtone ADR-0013、accounts ADR-0005)。
 * 公式 API は無く HTML を解析する。解析は selectors.ts に閉じ込め、fixture でテストする。
 */
export type Race =
  "hyur" | "elezen" | "lalafell" | "miqote" | "roegadyn" | "aura" | "hrothgar" | "viera";
export type Gender = "male" | "female";

export type LodestoneSearchHit = {
  lodestoneId: string;
  name: string;
  world: string;
  dataCenter: string;
};

export type LodestoneCharacter = {
  lodestoneId: string;
  name: string;
  world: string;
  dataCenter: string;
  /** 種族のコード。判別できなければ null (表示は rawRace で) */
  race: Race | null;
  rawRace: string;
  clan: string;
  gender: Gender | null;
  /** 一覧用の顔画像 (Lodestone の URL。自前コピーしない、prismtone docs/design/12 §7) */
  avatarUrl: string | null;
  /** 全身のポートレート */
  portraitUrl: string | null;
  /** 自己紹介欄の本文。トークン確認にだけ使い、保存しない */
  selfIntroduction: string;
};

export type LodestoneErrorCode = "not_found" | "parse_error" | "rate_limited" | "unavailable";

export class LodestoneError extends Error {
  readonly code: LodestoneErrorCode;
  constructor(code: LodestoneErrorCode, message?: string) {
    super(message ?? code);
    this.name = "LodestoneError";
    this.code = code;
  }
}

export interface LodestoneSource {
  /** 名前とワールドで検索する。Lodestone は曖昧一致なので、呼び出し側で完全一致に絞る */
  searchCharacter(name: string, world: string): Promise<LodestoneSearchHit[]>;
  /** キャラクターページを取得して解析する。無ければ not_found */
  fetchCharacter(lodestoneId: string): Promise<LodestoneCharacter>;
}
