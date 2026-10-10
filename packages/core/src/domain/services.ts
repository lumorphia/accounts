import type { Database } from "@lumorphia-accounts/db";

/**
 * Lumorphia の上で動くサービスと、OAuth クライアントからの見分け方。
 *
 * サービスは登録時の `metadata.lumorphia_service` だけで見分ける。`client_name` は表示名なので、
 * 変えると退会の通知やトークンの失効が黙って外れる。見分け方はここ以外に書かない。
 */
export const SERVICES = ["prismtone", "scenote", "facetia"] as const;
export type Service = (typeof SERVICES)[number];

export function isService(value: unknown): value is Service {
  return typeof value === "string" && (SERVICES as readonly string[]).includes(value);
}

/** Better Auth は metadata を JSON 文字列で保存するので、文字列でもオブジェクトでも読む。 */
export function serviceOfClientMetadata(metadata: unknown): Service | null {
  let value = metadata;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object") return null;
  const service = (value as Record<string, unknown>).lumorphia_service;
  return isService(service) ? service : null;
}

/** そのサービスのクライアント。数件しかないので全件を読んで metadata で絞る (jsonb は文字列で入っている)。 */
export async function clientsOfService(db: Database, service: Service) {
  const clients = await db.query.oauthClients.findMany({
    columns: { clientId: true, metadata: true, redirectUris: true },
  });
  return clients.filter((client) => serviceOfClientMetadata(client.metadata) === service);
}

/**
 * 設定画面からサービスへ戻る先 (prismtone ADR-0052)。登録したサービスのクライアントの redirect URI と
 * 同じ origin の https の URL にだけ戻す。任意の URL へ戻すとオープンリダイレクトになる
 */
export async function returnTargetOf(
  db: Database,
  raw: string,
): Promise<{ service: Service; url: string } | null> {
  if (!URL.canParse(raw)) return null;
  const target = new URL(raw);
  if (target.protocol !== "https:" || target.username || target.password) return null;
  const clients = await db.query.oauthClients.findMany({
    columns: { metadata: true, redirectUris: true, disabled: true },
  });
  for (const client of clients) {
    const service = serviceOfClientMetadata(client.metadata);
    if (!service || client.disabled) continue;
    const sameOrigin = client.redirectUris.some(
      (uri) => URL.canParse(uri) && new URL(uri).origin === target.origin,
    );
    if (sameOrigin) return { service, url: target.href };
  }
  return null;
}
