import type { ReactNode } from "react";

function inline(text: string): ReactNode[] {
  return text.split(/(\[[^\]]+\]\((?:https:\/\/|\/)[^)]+\))/g).map((part, index) => {
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    return link ? (
      <a key={index} href={link[2]} className="underline">
        {link[1]}
      </a>
    ) : (
      part
    );
  });
}

/** 管理する本文だけを表示し、HTML を解釈しない。 */
export function LegalDocument({ text }: { text: string }) {
  return (
    <main className="mx-auto max-w-3xl space-y-5 p-8 leading-relaxed">
      {text
        .trim()
        .split(/\n\s*\n/)
        .map((block, index) => {
          if (block.startsWith("# "))
            return (
              <h1 key={index} className="text-2xl font-semibold">
                {block.slice(2)}
              </h1>
            );
          if (block.startsWith("## "))
            return (
              <h2 key={index} className="pt-4 text-xl font-semibold">
                {block.slice(3)}
              </h2>
            );
          return <p key={index}>{inline(block)}</p>;
        })}
    </main>
  );
}
