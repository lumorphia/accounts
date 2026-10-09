import { useEffect, useState } from "react";

const STORAGE_KEY = "lumorphia.return_to";
const SERVICE_NAMES = { prismtone: "Prismtone", scenote: "Scenote", facetia: "Facetia" } as const;
type Target = { service: keyof typeof SERVICE_NAMES; url: string };

/** 戻り先は連携などで設定画面の外へ出ても失わないよう、このタブの中で覚えておく */
function rememberedReturnTo(): string | null {
  const fromQuery = new URLSearchParams(window.location.search).get("return_to");
  try {
    if (fromQuery) window.sessionStorage.setItem(STORAGE_KEY, fromQuery);
    return fromQuery ?? window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return fromQuery;
  }
}

/**
 * サービスの設定から移ってきた人を、そのサービスへ戻すリンク (prismtone ADR-0052)。
 * 戻り先が登録したサービスの URL かは accounts が確かめ、違えば何も出さない
 */
export function ReturnToService() {
  const [target, setTarget] = useState<Target | null>(null);
  useEffect(() => {
    const returnTo = rememberedReturnTo();
    if (!returnTo) return;
    let cancelled = false;
    void fetch(`/api/return-target?url=${encodeURIComponent(returnTo)}`)
      .then((res) => (res.ok ? (res.json() as Promise<{ target: Target | null }>) : null))
      .then((body) => {
        if (!cancelled && body?.target) setTarget(body.target);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  if (!target) return null;
  return (
    <a href={target.url} className="inline-block text-sm underline" data-testid="return-to-service">
      {SERVICE_NAMES[target.service]} に戻る
    </a>
  );
}
