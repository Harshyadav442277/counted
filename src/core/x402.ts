import { HTTPFacilitatorClient, x402ResourceServer, type RoutesConfig } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { paymentMiddleware } from "@x402/hono";
import type { MiddlewareHandler } from "hono";
import { config, paymentsEnabled } from "../config.js";
import { NETWORK, TOKENS, tokenByAddress } from "./chain.js";

/**
 * Seller side of x402 on Celo mainnet. Every paid route accepts USA₮, USDC and
 * USD₮; the facilitator relays the EIP-3009 authorisation and pays the gas, and
 * the authoriser (the buyer) is the signer the leaderboard counts.
 */
export type PaidTool = "verify" | "tagcheck" | "audit";

export function priceUsd(tool: PaidTool): number {
  const c = config();
  return tool === "audit" ? c.PRICE_AUDIT_USD : c.PRICE_CHECK_USD;
}

/** One payment option per accepted stablecoin, USA₮ first so clients that take the first option settle the "both rails" way. */
export function paymentOptions(usd: number, payTo: string) {
  const amount = String(Math.round(usd * 1_000_000));
  return ["USAT", "USDC", "USDT"].map((k) => {
    const t = TOKENS[k]!;
    return {
      scheme: "exact",
      network: NETWORK,
      payTo,
      maxTimeoutSeconds: 300,
      price: { amount, asset: t.address, extra: { name: t.eip712!.name, version: t.eip712!.version } },
    };
  });
}

export function routesConfig(): RoutesConfig {
  const payTo = config().AGENT_WALLET!;
  const mk = (tool: PaidTool, description: string) => ({
    accepts: paymentOptions(priceUsd(tool), payTo),
    description,
    mimeType: "application/json",
    serviceName: "Counted",
  });
  const verify = mk("verify", "Does this wallet count as a verified, independent user under the Agents at Work rules? Pre-28-Aug history, first funder, contract check, own-wallet check.");
  const tagcheck = mk("tagcheck", "Decode the ERC-8021 attribution suffix on a Celo transaction and say whether the assigned tag is present and the tx is inside the counting window.");
  const audit = mk("audit", "Full pre-submission audit of a project wallet: every counterparty classified, verified and returning users, signer gate, adjusted volume, stablecoin and x402 flags, and what would change your rank.");
  return {
    "GET /api/verify": verify,
    "POST /api/verify": verify,
    "GET /api/tagcheck": tagcheck,
    "POST /api/tagcheck": tagcheck,
    "GET /api/audit": audit,
    "POST /api/audit": audit,
  };
}

let middleware: MiddlewareHandler | null | undefined;

/** The Hono middleware, or null when payments are not configured. */
export function x402Middleware(): MiddlewareHandler | null {
  if (middleware !== undefined) return middleware;
  const c = config();
  if (!paymentsEnabled(c)) {
    middleware = null;
    return null;
  }
  const key = c.X402_API_KEY!;
  const facilitator = new HTTPFacilitatorClient({
    url: c.X402_FACILITATOR_URL,
    createAuthHeaders: async () => ({
      verify: { "X-API-Key": key },
      settle: { "X-API-Key": key },
      supported: { "X-API-Key": key },
    }),
  });
  const server = new x402ResourceServer(facilitator).register("eip155:*", new ExactEvmScheme());
  middleware = paymentMiddleware(routesConfig(), server, undefined, undefined, false);
  return middleware;
}

function b64decode(s: string): string {
  return Buffer.from(s, "base64").toString("utf8");
}

export interface PaymentInfo {
  payer: string | null;
  asset: string | null;
  assetSymbol: string | null;
  amountUsd: number | null;
  x402Version: number | null;
}

/** Who is paying, read from the request's PAYMENT-SIGNATURE (v2) or X-PAYMENT (v1) header. */
export function paymentFromHeaders(get: (name: string) => string | undefined): PaymentInfo | null {
  const raw = get("payment-signature") ?? get("x-payment");
  if (!raw) return null;
  try {
    const p = JSON.parse(b64decode(raw)) as {
      x402Version?: number;
      accepted?: { asset?: string; amount?: string };
      payload?: { authorization?: { from?: string; value?: string } };
    };
    const asset = p.accepted?.asset?.toLowerCase() ?? null;
    const token = asset ? tokenByAddress(asset) : undefined;
    const value = p.payload?.authorization?.value ?? p.accepted?.amount ?? null;
    const amountUsd = value && token ? Number(value) / 10 ** token.decimals : null;
    return {
      payer: p.payload?.authorization?.from?.toLowerCase() ?? null,
      asset,
      assetSymbol: token?.symbol ?? null,
      amountUsd,
      x402Version: p.x402Version ?? null,
    };
  } catch {
    return null;
  }
}

export interface SettlementInfo {
  success: boolean;
  transaction: string | null;
  payer: string | null;
  network: string | null;
}

/** The facilitator's settlement, read from the PAYMENT-RESPONSE header the middleware adds. */
export function settlementFromHeader(raw: string | null | undefined): SettlementInfo | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(b64decode(raw)) as { success?: boolean; transaction?: string; payer?: string; network?: string };
    return { success: Boolean(s.success), transaction: s.transaction ?? null, payer: s.payer?.toLowerCase() ?? null, network: s.network ?? null };
  } catch {
    return null;
  }
}

/** Public, client-facing description of how to pay each route. Shown on the site and in MCP. */
export function howToPay(tool: PaidTool, publicUrl: string): { url: string; priceUsd: number; assets: string[]; buyCurl: string; webPage: string } {
  const url = `${publicUrl}/api/${tool}`;
  return {
    url,
    priceUsd: priceUsd(tool),
    assets: ["USA₮", "USDC", "USD₮"],
    buyCurl: `npx --yes @celo/buy@0.5.0 curl --max-amount ${priceUsd(tool).toFixed(2)} --token USDT "${url}?${tool === "tagcheck" ? "tx=0x…" : "wallet=0x…"}"`,
    webPage: `${publicUrl}/pay?tool=${tool}`,
  };
}
