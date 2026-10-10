import type { Config } from "@react-router/dev/config";

export default {
  appDirectory: "web",
  ssr: true,
  // ログイン状態を root loader で読むので、prerender しない (lumorphia/prismtone と同じ)
  future: {},
} satisfies Config;
