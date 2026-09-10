import { createPublicClient, http, type Address, type Hex } from "viem";
import { celo } from "viem/chains";
import { config } from "../config.js";

/**
 * Celo mainnet constants the whole product depends on. Every address here was read
 * from the organisers' own scoring SQL or from the token contract on 2026-09-10.
 */
export const CHAIN_ID = 42220;
export const NETWORK = "eip155:42220" as const;

/** Counting window of the Agents at Work hackathon, from the published queries. */
export const WINDOW_START = Date.UTC(2026, 7, 28, 0, 0, 0); // 2026-08-28T00:00:00Z
export const WINDOW_END = Date.UTC(2026, 8, 14, 9, 0, 0); // 2026-09-14T09:00:00Z
/** The shared prelude scans ~60 days of token transfers for the "pre-existing" set. */
export const LOOKBACK_START = WINDOW_START - 60 * 86_400_000;
/**
 * Block height at the window start. Celo produces one block per second; block
 * 75,888,042 was mined at 2026-08-27T00:00:00Z (measured), so +86,400.
 */
export const WINDOW_START_BLOCK = 75_974_442;

export interface Token {
  symbol: string;
  address: Address;
  decimals: number;
  /** EIP-712 domain, needed to sign EIP-3009 transferWithAuthorization. */
  eip712: { name: string; version: string } | null;
  usd: number | null;
  /** Adapter address for the Celo feeCurrency field, when gas can be paid in it. */
  feeCurrencyAdapter: Address | null;
}

export const TOKENS: Record<string, Token> = {
  USAT: {
    symbol: "USA₮",
    address: "0xd2ab3c9a02dbbab236bfec45d1d755df4267f771",
    decimals: 6,
    eip712: { name: "Tether America USD", version: "1" },
    usd: 1,
    feeCurrencyAdapter: "0x0357EE22278c922e1D36cFe6b899269b161880C4",
  },
  USDC: {
    symbol: "USDC",
    address: "0xcEBA9300f2b948710d2653dD7B07f33A8B32118C",
    decimals: 6,
    eip712: { name: "USDC", version: "2" },
    usd: 1,
    feeCurrencyAdapter: "0x2F25deB3848C207fc8E0c34035B3Ba7fC157602B",
  },
  USDT: {
    symbol: "USD₮",
    address: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e",
    decimals: 6,
    eip712: { name: "Tether USD", version: "1" },
    usd: 1,
    feeCurrencyAdapter: "0x0E2A3e05bc9A16F5292A6170456A710cb89C6f72",
  },
  USDM: {
    symbol: "USDm",
    address: "0x765DE816845861e75A25fCA122bb6898B8B1282a",
    decimals: 18,
    eip712: null,
    usd: 1,
    feeCurrencyAdapter: "0x765DE816845861e75A25fCA122bb6898B8B1282a",
  },
  CELO: {
    symbol: "CELO",
    address: "0x471EcE3750Da237f93B8E339c536989b8978a438",
    decimals: 18,
    eip712: null,
    usd: null,
    feeCurrencyAdapter: null,
  },
};

/** Stablecoins that count for the Best Stablecoin Adoption bounty on their own. */
export const NAMED_STABLES: Record<string, string> = {
  "0xd2ab3c9a02dbbab236bfec45d1d755df4267f771": "USAT",
  "0xf6829d7393dae24509eb1e52ee8e572e2e271a4f": "cNGN",
  "0x0dc4f92879b7670e5f4e4e6e3c801d229129d90d": "wARS",
  "0xd76f5faf6888e24d9f04bf92a0c8b921fe4390e0": "wBRL",
  "0x337e7456b420bd3481e7fa61fa9850343d610d34": "wMXN",
  "0x8a1d45e102e886510e891d2ec656a708991e2d76": "wCOP",
  "0x4f34c8b3b5fb6d98da888f0fea543d4d9c9f2ebe": "wPEN",
  "0x61d450a098b6a7f69fc4b98ce68198fe59768651": "wCLP",
};

/** The x402 facilitator's relayer: the tx sender on every settlement, never the user. */
export const FACILITATOR_RELAYER: Address = "0x0d74D5Cefd2e7F24E623330ebE3d8D4cB45fFB48";

export const ERC8004_IDENTITY: Address = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";

/** Symbols the audit prices at exactly one dollar. */
export function usdFor(tokenAddress: string, symbol: string | null, celoUsd: number | null): number | null {
  const a = tokenAddress.toLowerCase();
  for (const t of Object.values(TOKENS)) if (t.address.toLowerCase() === a) return t.usd ?? celoUsd;
  if (NAMED_STABLES[a] === "USAT") return 1;
  if (symbol && /^(USDC|USDT|USD₮|USAT|USDm|cUSD)$/i.test(symbol)) return 1;
  return null;
}

export function tokenByAddress(address: string): Token | undefined {
  const a = address.toLowerCase();
  return Object.values(TOKENS).find((t) => t.address.toLowerCase() === a);
}

function makeClient() {
  return createPublicClient({ chain: celo, transport: http(config().RPC_URL, { timeout: 15_000 }) });
}

let client: ReturnType<typeof makeClient> | null = null;

/** Shared viem client for Celo mainnet (forno by default). */
export function publicClient(): ReturnType<typeof makeClient> {
  client ??= makeClient();
  return client;
}

export function isAddress(v: unknown): v is Address {
  return typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v);
}

export function isTxHash(v: unknown): v is Hex {
  return typeof v === "string" && /^0x[0-9a-fA-F]{64}$/.test(v);
}

export function short(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

export function celoscanTx(hash: string): string {
  return `https://celoscan.io/tx/${hash}`;
}

export function celoscanAddress(a: string): string {
  return `https://celoscan.io/address/${a}`;
}
