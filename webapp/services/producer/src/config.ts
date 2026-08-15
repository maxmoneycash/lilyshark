import { z } from "zod";

const configSchema = z.object({
  SHELBY_API_KEY: z.string().optional().default("dev-api-key"),
  SHELBY_PRIVATE_KEY: z.string().optional().default("dev-private-key"),
  SHELBY_ACCOUNT_ADDRESS: z.string().optional().default("dev-account"),
  MATCH_ID: z.string().min(1),
  INTERVAL_MS: z.coerce.number().int().default(65),
  WS_PORT: z.coerce.number().int().default(8787),
  HISTORIC_SOURCE: z.enum(["random", "csv"]).default("random"),
  CSV_PATH: z.string().optional(),
  PERSISTENCE_MODE: z.enum(["disabled", "local"]).default("local"),
  LOCAL_PERSIST_ROOT: z.string().default("data/local-shelby"),
  SHELBY_FLUSH_INTERVAL_MS: z.coerce.number().optional(),
  SHELBY_SEGMENT_TARGET_BYTES: z.coerce.number().optional(),
});

export type ProducerConfig = z.infer<typeof configSchema>;

export function loadConfig(): ProducerConfig {
  const result = configSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    }));
    throw new Error(
      `Invalid producer configuration: ${JSON.stringify(issues)}`,
    );
  }
  return result.data;
}
