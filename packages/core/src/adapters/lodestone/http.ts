import { parseCharacterPage, parseSearchPage } from "./selectors.ts";
import {
  LodestoneError,
  type LodestoneCharacter,
  type LodestoneSearchHit,
  type LodestoneSource,
} from "./types.ts";

import type { LodestonePacer } from "./pacing.ts";

type Sleep = (ms: number) => Promise<void>;

export type HttpLodestoneSourceOptions = {
  /** 既定は日本。地域を変えるときは env で (prismtone docs/design/12 §3) */
  baseUrl?: string;
  /** 本番の API / worker は PostgreSQL の共有制御を渡す */
  pacer?: LodestonePacer;
  fetch?: typeof fetch;
  /** 誰の取得か分かるようにする。連絡先は公開後に env で足す */
  userAgent?: string;
  retries?: number;
  /** 1 秒 1 リクエスト、同時 1 */
  minIntervalMs?: number;
  timeoutMs?: number;
  sleep?: Sleep;
  now?: () => number;
};

export class HttpLodestoneSource implements LodestoneSource {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly userAgent: string;
  private readonly retries: number;
  private readonly minIntervalMs: number;
  private readonly timeoutMs: number;
  private readonly sleep: Sleep;
  private readonly now: () => number;
  private readonly pacer: LodestonePacer | undefined;
  private lastRequestAt = Number.NEGATIVE_INFINITY;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: HttpLodestoneSourceOptions = {}) {
    this.pacer = options.pacer;
    this.baseUrl = (options.baseUrl ?? "https://jp.finalfantasyxiv.com").replace(/\/$/, "");
    this.fetchFn = options.fetch ?? fetch;
    this.userAgent = options.userAgent ?? "lumorphia-accounts/dev";
    this.retries = options.retries ?? 2;
    this.minIntervalMs = options.minIntervalMs ?? 1000;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = options.now ?? Date.now;
  }

  async searchCharacter(name: string, world: string): Promise<LodestoneSearchHit[]> {
    const params = new URLSearchParams({ q: name, worldname: world });
    const html = await this.get(`/lodestone/character/?${params.toString()}`);
    return parseSearchPage(html);
  }

  async fetchCharacter(lodestoneId: string): Promise<LodestoneCharacter> {
    if (!/^[1-9]\d{0,11}$/.test(lodestoneId)) throw new LodestoneError("not_found", "invalid id");
    const html = await this.get(`/lodestone/character/${lodestoneId}/`);
    return parseCharacterPage(html, lodestoneId);
  }

  /** 同時 1 に直列化し、検索とキャラクター取得で同じ順番待ちを使う */
  private get(path: string): Promise<string> {
    const run = this.queue.then(() => this.request(`${this.baseUrl}${path}`));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async request(url: string): Promise<string> {
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      await this.waitForRateLimit();
      let response: Response;
      try {
        const request = async () => {
          const response = await this.fetchFn(url, {
            headers: { "user-agent": this.userAgent, "accept-language": "ja" },
            signal: AbortSignal.timeout(this.timeoutMs),
          });
          // 失敗レスポンスの本文も読み終えるまで共有ロックを保持する。
          return { response, body: await response.text() };
        };
        const result = this.pacer ? await this.pacer.run(request) : await request();
        response = result.response;
        if (response.ok) return result.body;
      } catch (err) {
        if (attempt < this.retries) {
          await this.sleep(500 * 2 ** attempt);
          continue;
        }
        throw new LodestoneError("unavailable", err instanceof Error ? err.message : String(err));
      }
      if (response.status === 404) throw new LodestoneError("not_found");
      if (response.status === 429) {
        if (attempt < this.retries) {
          await this.sleep(retryDelayMs(response.headers.get("retry-after"), attempt));
          continue;
        }
        throw new LodestoneError("rate_limited");
      }
      if (response.status >= 500 && attempt < this.retries) {
        await this.sleep(retryDelayMs(response.headers.get("retry-after"), attempt));
        continue;
      }
      throw new LodestoneError("unavailable", `HTTP ${response.status}`);
    }
    throw new LodestoneError("unavailable", "retries exhausted");
  }

  private async waitForRateLimit(): Promise<void> {
    const remaining = this.lastRequestAt + this.minIntervalMs - this.now();
    if (remaining > 0) await this.sleep(remaining);
    this.lastRequestAt = this.now();
  }
}

/** Retry-After の秒数。不正な値では指数バックオフを使う */
function retryDelayMs(retryAfter: string | null, attempt: number): number {
  const seconds = retryAfter === null || retryAfter.trim() === "" ? NaN : Number(retryAfter);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : 250 * 2 ** attempt;
}
