import { z } from "zod";

/**
 * Environment, parsed once. Every spending knob is OFF unless set: without
 * X402_API_KEY the paid routes answer 503 instead of pretending to settle.
 */
const HEX64 = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export function normalisePrivateKey(raw: string | undefined): string | undefined {
  const t = raw?.trim();
  if (!t) return undefined;
  const withPrefix = /^0x/i.test(t) ? `0x${t.slice(2)}` : `0x${t}`;
  return HEX64.test(withPrefix) ? withPrefix.toLowerCase() : undefined;
}

const schema = z.object({
  /** The registered agent wallet: x402 payTo, AskBots funder, ERC-8004 owner. Public address only. */
  AGENT_WALLET: z.string().regex(ADDRESS, "AGENT_WALLET must be a 0x address").optional(),
  /** Only the scripts (ERC-8004 mint, test payments) need the key. The web service never does. */
  AGENT_PRIVATE_KEY: z.string().regex(HEX64).optional(),
  /** celo_ + 12 hex, issued at registration on celobuilders.xyz. */
  ATTRIBUTION_TAG: z.string().regex(/^[a-z0-9_]{1,32}$/).optional(),
  X402_API_KEY: z.string().min(8).optional(),
  X402_FACILITATOR_URL: z.string().url().default("https://api.x402.celo.org"),
  RPC_URL: z.string().url().default("https://forno.celo.org"),
  BLOCKSCOUT_URL: z.string().url().default("https://celo.blockscout.com/api/v2"),
  CELOSCAN_API_KEY: z.string().min(8).optional(),
  DUNE_API_KEY: z.string().min(8).optional(),
  TELEGRAM_BOT_TOKEN: z.string().min(10).optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(16).optional(),
  TELEGRAM_BOT_USERNAME: z
    .string()
    .regex(/^@?[A-Za-z0-9_]{5,32}$/)
    .transform((v) => v.replace(/^@/, ""))
    .optional(),
  DATABASE_URL: z.string().url().optional(),
  /** Vercel Blob read-write token; a durable ledger without Postgres. Linked by `vercel blob create-store`. */
  BLOB_READ_WRITE_TOKEN: z.string().min(8).optional(),
  ADMIN_TOKEN: z.string().min(16).optional(),
  HASH_SALT: z.string().min(8).default("counted-dev-salt-change-me"),
  PUBLIC_URL: z.string().url().optional(),
  PRICE_CHECK_USD: z.coerce.number().min(0.001).max(10).default(0.05),
  PRICE_AUDIT_USD: z.coerce.number().min(0.01).max(50).default(1),
  /** Counterparties inspected per audit. Each costs 2-4 explorer calls. */
  AUDIT_MAX_COUNTERPARTIES: z.coerce.number().int().min(5).max(200).default(40),
  /** Local development only: serve the paid routes without a payment. Never set in production. */
  ALLOW_UNPAID: z
    .string()
    .default("false")
    .transform((v) => v === "true" || v === "1"),
});

export type Config = z.infer<typeof schema>;

let cached: Config | null = null;
let problems: string[] = [];

export function configProblems(): string[] {
  config();
  return problems;
}

export function config(): Config {
  if (cached) return cached;
  const env: Record<string, unknown> = { ...process.env };
  const found: string[] = [];
  if (env["AGENT_PRIVATE_KEY"] !== undefined) {
    const key = normalisePrivateKey(String(env["AGENT_PRIVATE_KEY"]));
    if (key) env["AGENT_PRIVATE_KEY"] = key;
    else {
      delete env["AGENT_PRIVATE_KEY"];
      found.push("AGENT_PRIVATE_KEY is set but is not 64 hex characters");
    }
  }
  for (const k of Object.keys(env)) if (env[k] === "") delete env[k];
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`invalid environment: ${issues}`);
  }
  cached = parsed.data;
  if (!cached.AGENT_WALLET) found.push("AGENT_WALLET is not set: paid routes are disabled");
  if (!cached.X402_API_KEY) found.push("X402_API_KEY is not set: the facilitator cannot settle, paid routes are disabled");
  if (!cached.DUNE_API_KEY) found.push("DUNE_API_KEY is not set: /standing answers from the dashboard link only");
  if (cached.TELEGRAM_BOT_TOKEN && !cached.TELEGRAM_WEBHOOK_SECRET) found.push("TELEGRAM_WEBHOOK_SECRET is not set: the Telegram webhook is disabled until it is");
  if (cached.TELEGRAM_BOT_TOKEN && cached.HASH_SALT === "counted-dev-salt-change-me") found.push("HASH_SALT is the development default: set a random value before enabling Telegram");
  problems = found;
  return cached;
}

/** Test seam. */
export function resetConfigForTests(): void {
  cached = null;
  problems = [];
}

/** Paid routes exist only when the facilitator can settle to a known wallet. */
export function paymentsEnabled(c: Config = config()): boolean {
  return Boolean(c.AGENT_WALLET && c.X402_API_KEY);
}

export function publicUrl(c: Config = config()): string {
  return (c.PUBLIC_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}
