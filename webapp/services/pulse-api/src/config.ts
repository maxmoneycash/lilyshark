import { z } from "zod";

const configSchema = z.object({
  APTOS_NETWORK: z.string().default("custom"),
  APTOS_NODE_URL: z
    .string()
    .default("https://api.shelbynet.shelby.xyz/v1"),
  APTOS_INDEXER_URL: z
    .string()
    .optional()
    .default("https://api.shelbynet.shelby.xyz/v1/graphql"),
  APTOS_API_KEY: z
    .string()
    .optional()
    .default(""),
  SHELBY_MODULE_ADDRESS: z.string().default("0x1"),
  PORT: z.coerce.number().int().default(3001),
  CACHE_TTL_SECONDS: z.coerce.number().int().default(30),
  // Private key for server-managed uploads (Shelby Share feature). The same
  // key signs lilyshark::capture_registry::register for published captures.
  SHELBY_PRIVATE_KEY: z.string().optional().default(""),
  // Shelby API key for RPC access (bypasses rate limits)
  SHELBY_API_KEY: z.string().optional().default(""),
  // Account that hosts lilyshark::capture_registry on shelbynet
  // (contracts/capture-registry/README.md).
  CAPTURE_REGISTRY_ADDRESS: z
    .string()
    .default(
      "0x34946d19fb18115046c807b8f48845a515efe107892bb9cc49c6f197a6998728",
    ),
  // "true"/"1": build the register transaction but never submit it. Lets a
  // deployment exercise the anchoring path without spending gas.
  ANCHOR_DRY_RUN: z.string().optional().default(""),
});

export type ApiConfig = z.infer<typeof configSchema>;

export function loadConfig(): ApiConfig {
  const result = configSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    }));
    throw new Error(
      `Invalid API configuration: ${JSON.stringify(issues, null, 2)}`,
    );
  }
  return result.data;
}
