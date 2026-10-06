/**
 * 連携した SNS アカウントの表示名とアイコン URL を決める。
 *
 * better-auth は accounts を作る hook にプロフィールを渡さないので、
 * hook の中でプロバイダーの getUserInfo を呼び直す。Google は idToken を
 * decode するだけ、Discord は /users/@me を 1 回叩く。
 */

export type ProviderProfile = {
  user: {
    name?: string | undefined;
    email?: string | null | undefined;
    image?: string | undefined;
  };
  /** プロバイダーの生プロフィール。better-auth では object 型なので読むときに絞る */
  data?: object | undefined;
};

export type ProfileProvider = {
  id: string;
  getUserInfo: (tokens: {
    accessToken?: string;
    idToken?: string;
  }) => Promise<ProviderProfile | null>;
};

export type AccountTokens = {
  providerId?: string | undefined;
  accessToken?: string | null | undefined;
  idToken?: string | null | undefined;
};

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const field = (data: object | undefined, key: string): unknown =>
  data && key in data ? (data as Record<string, unknown>)[key] : undefined;

/** プロバイダーごとに「利用者が見て自分だと分かる名前」を選ぶ */
export function displayNameFromProfile(
  providerId: string,
  profile: ProviderProfile,
): string | null {
  switch (providerId) {
    case "discord":
      return str(field(profile.data, "username")) ?? str(profile.user.name);
    case "google":
      return str(profile.user.email) ?? str(profile.user.name);
    case "twitter":
      return str(field(profile.data, "username")) ?? str(profile.user.name);
    default:
      return null;
  }
}

export type AccountProfileFields = { displayName: string | null; imageUrl: string | null };

/**
 * accounts の create / update hook から呼ぶ。対象外のプロバイダー、トークン無し、
 * 取得失敗はすべて null (呼び出し側は null の項目を触らない)。
 */
export async function resolveAccountProfile(
  account: AccountTokens,
  providers: readonly ProfileProvider[],
): Promise<AccountProfileFields> {
  const none = { displayName: null, imageUrl: null };
  const { providerId, accessToken, idToken } = account;
  if (!providerId || (!accessToken && !idToken)) return none;
  const provider = providers.find((p) => p.id === providerId);
  if (!provider) return none;
  try {
    const profile = await provider.getUserInfo({
      ...(accessToken ? { accessToken } : {}),
      ...(idToken ? { idToken } : {}),
    });
    if (!profile) return none;
    return {
      displayName: displayNameFromProfile(providerId, profile),
      imageUrl: str(profile.user.image),
    };
  } catch {
    return none;
  }
}

/** hook に返す data。取れた項目だけ上書きする */
export function withAccountProfile<T extends object>(account: T, fields: AccountProfileFields): T {
  return {
    ...account,
    ...(fields.displayName ? { displayName: fields.displayName } : {}),
    ...(fields.imageUrl ? { imageUrl: fields.imageUrl } : {}),
  };
}
