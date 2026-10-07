import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { APIError } from "better-auth/api";
import { serviceOfClientMetadata, type Service } from "@lumorphia-accounts/core";
import { eq, schema } from "@lumorphia-accounts/db";
import { DomainError } from "../plugins/errors.ts";

export type ServiceAccessOptions = {
  /** トークンとクライアントの両方に要る scope */
  scope: string;
  /** scope が足りないときのエラーの message (既存のクライアントが見ている値を変えない) */
  scopeError: string;
  /** WWW-Authenticate の realm */
  realm: string;
  /** 呼べるサービス。省略すると登録済みのサービスすべて */
  services?: readonly Service[];
};

/**
 * サービスがサーバー間で呼ぶ API の Bearer を確かめ、トークンの持ち主と呼び出し元のサービスを返す。
 * Cookie は見ない。サービスはクライアントの metadata で見分ける (core の services.ts)。
 */
export async function requireServiceAccess(
  app: FastifyInstance,
  req: FastifyRequest,
  reply: FastifyReply,
  options: ServiceAccessOptions,
): Promise<{ sub: string; service: Service }> {
  const invalid = (): never => {
    reply.header("www-authenticate", 'Bearer error="invalid_token"');
    throw new DomainError("unauthorized", "invalid_access_token");
  };
  const bearer = /^Bearer ([^\s]+)$/i.exec(req.headers.authorization ?? "");
  if (!bearer) {
    reply.header("www-authenticate", `Bearer realm="${options.realm}"`);
    throw new DomainError("unauthorized", "access_token_required");
  }
  const access = await app.auth.api
    .serviceAccess({ body: { token: bearer[1]! } })
    .catch((error: unknown) => {
      if (error instanceof APIError) return invalid();
      throw error;
    });
  const client =
    typeof access.client_id === "string"
      ? await app.db.query.oauthClients.findFirst({
          where: eq(schema.oauthClients.clientId, access.client_id),
        })
      : undefined;
  const service = serviceOfClientMetadata(client?.metadata);
  if (
    !client ||
    client.disabled ||
    !service ||
    (options.services && !options.services.includes(service)) ||
    access.token_type !== "Bearer" ||
    access.cnf ||
    !access.sub
  )
    return invalid();
  if (
    !client.scopes?.includes(options.scope) ||
    typeof access.scope !== "string" ||
    !access.scope.split(" ").includes(options.scope)
  ) {
    reply.header("www-authenticate", `Bearer error="insufficient_scope", scope="${options.scope}"`);
    throw new DomainError("forbidden", options.scopeError);
  }
  return { sub: access.sub, service };
}
