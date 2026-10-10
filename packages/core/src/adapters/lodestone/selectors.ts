/**
 * Lodestone の HTML から値を取り出す。セレクタはこのファイルにだけ書く。
 * 構造が変わって取れなくなったら parse_error にし、監視で気づく (prismtone docs/design/12 §3)。
 */
import { parse, type HTMLElement } from "node-html-parser";

import {
  LodestoneError,
  type LodestoneCharacter,
  type LodestoneSearchHit,
  type Race,
  type Gender,
} from "./types.ts";

/** 「Tiamat [Gaia]」の形。ワールド名と DC 名を取る */
const WORLD_PATTERN = /^\s*([A-Za-z]+)\s*\[([A-Za-z]+)\]\s*$/;

/** 日本語ページの種族名 -> 種族のコード */
const RACE_JA: Record<string, Race> = {
  ヒューラン: "hyur",
  エレゼン: "elezen",
  ララフェル: "lalafell",
  ミコッテ: "miqote",
  ルガディン: "roegadyn",
  アウラ: "aura",
  ロスガル: "hrothgar",
  ヴィエラ: "viera",
};

const text = (el: HTMLElement | null | undefined): string => (el?.textContent ?? "").trim();

function required(el: HTMLElement | null | undefined, what: string): HTMLElement {
  if (!el) throw new LodestoneError("parse_error", `missing ${what}`);
  return el;
}

function parseWorld(raw: string, what: string): { world: string; dataCenter: string } {
  const m = WORLD_PATTERN.exec(raw);
  if (!m) throw new LodestoneError("parse_error", `unexpected ${what}: ${raw}`);
  return { world: m[1]!, dataCenter: m[2]! };
}

export function parseCharacterPage(html: string, lodestoneId: string): LodestoneCharacter {
  const root = parse(html);
  // 存在しない id は 200 でエラーページを返すことがある (fixture: character-404.html)
  if (root.querySelector(".error__heading") || root.querySelector(".parts__zero")) {
    throw new LodestoneError("not_found");
  }
  const name = text(required(root.querySelector(".frame__chara__name"), "name"));
  const worldRaw = text(required(root.querySelector(".frame__chara__world"), "world"));
  const { world, dataCenter } = parseWorld(worldRaw, "world");

  // 「種族/部族/性別」ブロック: <p class="character-block__name">ミコッテ<br />ムーンキーパー / ♀</p>
  const raceBlock = root
    .querySelectorAll(".character-block__title")
    .find((el) => text(el) === "種族/部族/性別");
  const raceName = required(
    raceBlock?.parentNode?.querySelector(".character-block__name"),
    "race block",
  );
  const [rawRace = "", clanGender = ""] = raceName.innerHTML
    .split(/<br\s*\/?>/i)
    .map((s) => s.replace(/<[^>]+>/g, "").trim());
  const [clan = "", genderMark = ""] = clanGender.split("/").map((s) => s.trim());
  const gender: Gender | null = genderMark === "♀" ? "female" : genderMark === "♂" ? "male" : null;
  if (!rawRace || !clan)
    throw new LodestoneError("parse_error", `unexpected race block: ${raceName.innerHTML}`);

  const avatarUrl = root.querySelector(".frame__chara__face img")?.getAttribute("src") ?? null;
  const portraitUrl =
    root.querySelector(".character__detail__image a")?.getAttribute("href") ??
    root.querySelector(".character__detail__image img")?.getAttribute("src") ??
    null;
  const selfIntroduction = text(root.querySelector(".character__selfintroduction"));

  return {
    lodestoneId,
    name,
    world,
    dataCenter,
    race: RACE_JA[rawRace] ?? null,
    rawRace,
    clan,
    gender,
    avatarUrl,
    portraitUrl,
    selfIntroduction,
  };
}

export function parseSearchPage(html: string): LodestoneSearchHit[] {
  const root = parse(html);
  if (root.querySelector(".parts__zero")) return [];
  // 検索結果は <div class="entry"><a class="entry__link" href="/lodestone/character/{id}/">。
  // 右の「ランキング」欄にも entry__link があるので、div.entry 直下だけを見る
  const entries = root.querySelectorAll("div.entry > a.entry__link");
  if (entries.length === 0) throw new LodestoneError("parse_error", "no search entries");
  return entries.map((entry) => {
    const href = entry.getAttribute("href") ?? "";
    const id = /\/lodestone\/character\/(\d+)\//.exec(href)?.[1];
    if (!id) throw new LodestoneError("parse_error", `unexpected entry href: ${href}`);
    const name = text(required(entry.querySelector(".entry__name"), "entry name"));
    const { world, dataCenter } = parseWorld(
      text(required(entry.querySelector(".entry__world"), "entry world")),
      "entry world",
    );
    return { lodestoneId: id, name, world, dataCenter };
  });
}
