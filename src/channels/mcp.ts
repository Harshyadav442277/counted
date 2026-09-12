import { StreamableHTTPTransport } from "@hono/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Hono } from "hono";
import { z } from "zod";
import { publicUrl } from "../config.js";
import { RULES } from "../core/audit.js";
import { dashboardUrl, findByTag, NoBoardSnapshot, QUERIES, trackRows } from "../core/dune.js";
import { howToPay, type PaidTool } from "../core/x402.js";
import type { AppEnv } from "./api.js";

/**
 * Hosted MCP server (Streamable HTTP, stateless). Free tools answer directly. Paid
 * tools call this same deployment's x402 routes: pass `payment`, a base64 x402 v2
 * PaymentPayload for the PAYMENT-SIGNATURE header, or receive the 402 terms and a
 * one-line `buy curl` that pays them.
 */
function text(obj: unknown) {
  return { content: [{ type: "text" as const, text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) }] };
}

async function callPaid(app: Hono<AppEnv>, tool: PaidTool, params: Record<string, string | undefined>, payment?: string) {
  const u = new URL(`${publicUrl()}/api/${tool}`);
  for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
  const headers: Record<string, string> = { accept: "application/json", "user-agent": "counted-mcp" };
  if (payment) headers["PAYMENT-SIGNATURE"] = payment;
  const res = await app.request(u.toString(), { headers });
  const body = await res.json().catch(async () => ({ raw: await res.text().catch(() => "") }));
  if (res.status === 402) {
    const how = howToPay(tool, publicUrl());
    return text({
      paymentRequired: true,
      priceUsd: how.priceUsd,
      assets: how.assets,
      terms: body,
      howToPay: [
        `Any x402 v2 client: retry with PAYMENT-SIGNATURE for one of the accepts (USA₮ first).`,
        `With @celo/buy: ${how.buyCurl.replace("0x…", params["wallet"] ?? params["tx"] ?? "0x…")}`,
        `In a browser wallet: ${how.webPage}&${Object.entries(params).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join("&")}`,
      ],
    });
  }
  const settlement = res.headers.get("PAYMENT-RESPONSE");
  return text({ status: res.status, settlement: settlement ? JSON.parse(Buffer.from(settlement, "base64").toString("utf8")) : null, result: body });
}

export function buildServer(app: Hono<AppEnv>): McpServer {
  const server = new McpServer({ name: "counted", version: "0.1.0" });

  server.registerTool(
    "counted_rules",
    { title: "What counts on the Agents at Work leaderboard", description: "The scoring rules in plain words: independent parties, pre-existing history, the signer gate, the three Track 2 signals, the stablecoin bounty, attribution. Free.", inputSchema: {} },
    async () => text({ rules: RULES, dashboard: dashboardUrl() }),
  );

  server.registerTool(
    "counted_standing",
    { title: "Leaderboard row for an attribution tag", description: "Returns the row for a celo_… tag on the organisers' three published Dune queries, its position among eligible projects, and the eligible leaders. Reads the Dune API when a key is configured, otherwise the latest uploaded snapshot of the public board; every answer carries the time it was taken. Free.", inputSchema: { tag: z.string().regex(/^[a-z0-9_]{3,32}$/i) } },
    async ({ tag }) => {
      try {
        const tracks = await Promise.all(
          (["track1", "track2", "stablecoin"] as const).map(async (k) => {
            const { rows, executedAt, source } = await trackRows(k);
            return { track: QUERIES[k].title, executedAt, source, row: findByTag(rows, tag.toLowerCase()) ?? null, eligibleLeaders: rows.filter((r) => /^yes$/i.test(String(r["Eligible"] ?? r["eligible"] ?? ""))).slice(0, 5) };
          }),
        );
        return text({ tag: tag.toLowerCase(), tracks, dashboard: dashboardUrl() });
      } catch (e) {
        if (e instanceof NoBoardSnapshot) return text({ error: e.message, dashboard: dashboardUrl() });
        return text({ error: (e as Error).message });
      }
    },
  );

  server.registerTool(
    "counted_verify",
    {
      title: "Does this wallet count as a verified, independent user?",
      description: `Pre-28-Aug history, 60-day lookback, first funder, contract and own-wallet checks, with reasons. Paid: $${howToPay("verify", publicUrl()).priceUsd} in USA₮/USDC/USD₮ over x402. Pass 'payment' (base64 x402 v2 PaymentPayload) to pay inline, or omit it to get the 402 terms and a buy one-liner.`,
      inputSchema: { wallet: z.string().regex(/^0x[0-9a-fA-F]{40}$/), own: z.string().optional(), payment: z.string().optional() },
    },
    async ({ wallet, own, payment }) => callPaid(app, "verify", { wallet, own }, payment),
  );

  server.registerTool(
    "counted_tagcheck",
    {
      title: "Is the attribution tag in this transaction?",
      description: `Decodes the ERC-8021 suffix of a Celo mainnet transaction, checks for an expected celo_… code and whether the tx is inside the counting window. Paid: $${howToPay("tagcheck", publicUrl()).priceUsd} over x402.`,
      inputSchema: { tx: z.string().regex(/^0x[0-9a-fA-F]{64}$/), tag: z.string().optional(), payment: z.string().optional() },
    },
    async ({ tx, tag, payment }) => callPaid(app, "tagcheck", { tx, tag }, payment),
  );

  server.registerTool(
    "counted_audit",
    {
      title: "Full pre-submission audit of a project wallet",
      description: `Every counterparty in the window classified (verified, fresh, contract, funded-by-you), Track 2 signals, signer gate and adjusted volume, stablecoin and x402 flags, and what would change your rank. Paid: $${howToPay("audit", publicUrl()).priceUsd} over x402.`,
      inputSchema: { wallet: z.string().regex(/^0x[0-9a-fA-F]{40}$/), tag: z.string().optional(), own: z.string().optional(), payment: z.string().optional() },
    },
    async ({ wallet, tag, own, payment }) => callPaid(app, "audit", { wallet, tag, own }, payment),
  );

  server.registerTool(
    "counted_how_to_pay",
    { title: "How to pay Counted", description: "Prices, accepted assets (USA₮, USDC, USD₮ on Celo mainnet), the buy one-liner and the browser pay page. Free.", inputSchema: {} },
    async () => {
      const base = publicUrl();
      return text({ verify: howToPay("verify", base), tagcheck: howToPay("tagcheck", base), audit: howToPay("audit", base), faucet: "https://cloud.google.com/application/web3/faucet/celo/mainnet" });
    },
  );

  return server;
}

export function mcpRoutes(app: Hono<AppEnv>): void {
  app.all("/mcp", async (c) => {
    const transport = new StreamableHTTPTransport();
    const server = buildServer(app);
    await server.connect(transport);
    const res = await transport.handleRequest(c);
    return res ?? c.body(null, 202);
  });
}
