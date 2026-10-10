import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  LOG_LEVEL: z.string().default("info"),
  FEATURE_LODESTONE: z
    .enum(["0", "1", "true", "false"])
    .default("0")
    .transform((value) => value === "1" || value === "true"),
  LODESTONE_BASE_URL: z.string().url().default("https://jp.finalfantasyxiv.com"),
  LODESTONE_USER_AGENT: z.string().trim().min(1).optional(),
});

export function loadCharacterWorkerEnv(source: NodeJS.ProcessEnv = process.env) {
  const env = schema.parse(source);
  if (env.NODE_ENV === "production") {
    const url = new URL(env.LODESTONE_BASE_URL);
    if (
      url.protocol !== "https:" ||
      url.port ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      !/^(jp|na|eu|fr|de)\.finalfantasyxiv\.com$/.test(url.hostname)
    )
      throw new Error("LODESTONE_BASE_URL must be an official HTTPS origin in production");
    if (env.FEATURE_LODESTONE && !env.LODESTONE_USER_AGENT)
      throw new Error("LODESTONE_USER_AGENT is required in production");
  }
  return env;
}
