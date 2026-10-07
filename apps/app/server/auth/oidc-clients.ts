import type { Auth } from "./auth.ts";
import { normalizeHost } from "./miauth-host.ts";

export type ServiceClientConfig = {
  service: "prismtone" | "scenote" | "facetia";
  redirectUri: string;
  postLogoutRedirectUri?: string;
  backchannelLogoutUri?: string;
};

function webUri(input: string): string {
  const url = new URL(input);
  if (url.protocol !== "https:" || url.username || url.password || url.hash)
    throw new Error("HTTPS web URL required");
  normalizeHost(url.hostname);
  return url.href;
}

export function serviceClientMetadata(config: ServiceClientConfig) {
  if (!["prismtone", "scenote", "facetia"].includes(config.service))
    throw new Error("unknown service");
  return {
    client_name: config.service,
    redirect_uris: [webUri(config.redirectUri)],
    scope: `openid profile email lumorphia:characters${config.service === "prismtone" ? " lumorphia:identities" : ""}`,
    grant_types: ["authorization_code"] as ["authorization_code"],
    response_types: ["code"] as ["code"],
    token_endpoint_auth_method: "client_secret_post" as const,
    application_type: "web" as const,
    require_pkce: true,
    skip_consent: true,
    enable_end_session: true,
    ...(config.postLogoutRedirectUri
      ? { post_logout_redirect_uris: [webUri(config.postLogoutRedirectUri)] }
      : {}),
    ...(config.backchannelLogoutUri
      ? {
          backchannel_logout_uri: webUri(config.backchannelLogoutUri),
          backchannel_logout_session_required: true,
        }
      : {}),
  };
}

/** HTTP からは公開しない。運営者のセッションで登録スクリプトから呼ぶ。 */
export async function registerServiceClient(
  auth: Auth,
  headers: Headers,
  config: ServiceClientConfig,
) {
  const session = await auth.api.getSession({ headers });
  if (!session || session.user.role !== "admin" || session.user.status !== "active")
    throw new Error("active administrator session required");
  return auth.api.adminCreateOAuthClient({ headers, body: serviceClientMetadata(config) });
}
