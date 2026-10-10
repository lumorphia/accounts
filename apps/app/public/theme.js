// CSS の読み込み前にテーマを決め、初回表示での色の切り替わりを防ぐ。
(() => {
  const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
  const previewTheme = new URLSearchParams(window.location.search).get("theme");
  let savedTheme;
  try {
    savedTheme = window.localStorage.getItem("lumorphia-theme");
  } catch {
    // ストレージを使えない環境でも、端末の設定と切り替えは使える。
  }
  const explicitTheme = ["light", "dark"].includes(previewTheme) ? previewTheme : savedTheme;
  document.documentElement.dataset.theme = ["light", "dark"].includes(explicitTheme)
    ? explicitTheme
    : systemTheme.matches
      ? "dark"
      : "light";
  systemTheme.addEventListener("change", (event) => {
    if (
      ["light", "dark"].includes(explicitTheme) ||
      document.documentElement.dataset.themeSelected === "true"
    )
      return;
    document.documentElement.dataset.theme = event.matches ? "dark" : "light";
    window.dispatchEvent(new Event("lumorphia-theme-change"));
  });
})();
