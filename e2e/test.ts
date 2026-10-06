import { expect, test as base } from "@playwright/test";

/**
 * 全 E2E 共通の test。CSP の違反を見張り、テストの終わりに 0 件であることを確かめる (lumorphia/prismtone と同じ)。
 * 違反はブラウザが console にエラーとして出すので、コンテキストの console を集める。
 * browser.newContext() で作った別のコンテキストは見ない
 */
export const test = base.extend<{ cspViolations: string[] }>({
  cspViolations: [
    async ({ context }, use) => {
      const violations: string[] = [];
      context.on("console", (msg) => {
        const text = msg.text();
        if (/Content Security Policy|Refused to/i.test(text)) violations.push(text);
      });
      await use(violations);
      expect(violations, "CSP の違反が console に出た").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
