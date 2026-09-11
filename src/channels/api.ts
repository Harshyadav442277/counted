import type { Context, Hono } from "hono";
import { config, configProblems, paymentsEnabled, publicUrl } from "../config.js";
import { auditProject, RULES, tagCheck, verifyWallet, type AuditReport, type TagCheck, type WalletVerdict } from "../core/audit.js";
import { isAddress, isTxHash } from "../core/chain.js";
import { dashboardUrl, findByTag, NoDuneKey, QUERIES, trackRows } from "../core/dune.js";
import { auditHtml, auditSummary, tagCheckHtml, tagCheckSummary, walletVerdictHtml, walletVerdictSummary } from "../core/format.js";
import { newId, verifyChat } from "../core/ids.js";
import { getLedger, ledgerDurable } from "../core/ledger/index.js";
import type { CallRow, Channel, Tool } from "../core/ledger/types.js";
import { howToPay, paymentFromHeaders, priceUsd, settlementFromHeader, x402Middleware, type PaidTool } from "../core/x402.js";
import { notifyChat } from "./telegram.js";

/**
 * HTTP surface. `/api/verify`, `/api/tagcheck` and `/api/audit` sit behind the x402
 * middleware; everything else is free. An outer middleware records every paid call
 * with its settlement hash once the facilitator has confirmed it.
 */
export type AppEnv = {
  Variables: {
    result?: { tool: Tool; subject: string; summary: string; html: string; startedAt: number; chatId?: string };
  };
};

function channelOf(c: Context): Channel {
  const ua = c.req.header("user-agent") ?? "";
  if (c.req.query("via") === "web" || c.req.header("sec-fetch-mode") === "cors") return "web";
  if (/buy|x402|node|undici|python|curl|mcp/i.test(ua)) return "api";
  return "api";
}

export function settlementLogger(): (c: Context, next: () => Promise<void>) => Promise<void> {
  return async (c, next) => {
    const started = Date.now();
    await next();
    const result = (c as Context<AppEnv>).get("result");
    if (!result) return;
    const settlement = settlementFromHeader(c.res.headers.get("PAYMENT-RESPONSE"));
    const paid = Boolean(settlement?.success && settlement?.transaction);
    // Payer, asset and amount are recorded only from a settlement the facilitator
    // confirmed. The request header is client-supplied and never trusted on its own.
    const payment = paid ? paymentFromHeaders((n) => c.req.header(n)) : null;
    const row: CallRow = {
      id: paid ? settlement!.transaction! : newId(),
      at: new Date().toISOString(),
      channel: channelOf(c),
      tool: result.tool,
      subject: result.subject,
      paid,
      payer: paid ? settlement?.payer ?? payment?.payer ?? null : null,
      asset: paid ? payment?.assetSymbol ?? payment?.asset ?? null : null,
      amountUsd: paid ? payment?.amountUsd ?? priceUsd(result.tool as PaidTool) : null,
      settlementTx: paid ? settlement!.transaction : null,
      status: c.res.status < 400 ? "ok" : "error",
      summary: result.summary.slice(0, 200),
      durationMs: Date.now() - started,
    };
    try {
      await getLedger().record(row);
    } catch (e) {
      console.error("ledger write failed:", (e as Error).message);
    }
    if (result.chatId && (paid || config().ALLOW_UNPAID)) {
      const tx = settlement?.transaction;
      const footer = tx ? `\n\nSettled on Celo: https://celoscan.io/tx/${tx}` : "";
      await notifyChat(result.chatId, `${result.html}${footer}`).catch((e) => console.error("telegram notify failed:", (e as Error).message));
    }
  };
}

function bad(c: Context, msg: string, status: 400 | 404 | 503 = 400) {
  return c.json({ error: msg }, status);
}

function ownWalletsParam(c: Context): string[] {
  const raw = c.req.query("own") ?? "";
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => isAddress(s));
}

async function bodyOrQuery(c: Context, key: string): Promise<string | undefined> {
  const q = c.req.query(key);
  if (q) return q;
  if (c.req.method === "POST") {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const v = body[key];
    return typeof v === "string" ? v : undefined;
  }
  return undefined;
}

/** The chat to notify, accepted only as a token the bot itself signed. */
function chatParam(c: Context): string | undefined {
  return verifyChat(c.req.query("chat"), config().HASH_SALT) ?? undefined;
}

export function apiRoutes(app: Hono<AppEnv>): void {
  app.use("/api/*", settlementLogger());
  const pm = x402Middleware();
  if (pm) app.use("/api/*", pm);

  const guard = (c: Context) => {
    if (paymentsEnabled() || config().ALLOW_UNPAID) return null;
    return bad(c, "Payments are not configured on this deployment (AGENT_WALLET and X402_API_KEY). The check is not free by design.", 503);
  };

  app.on(["GET", "POST"], "/api/verify", async (c) => {
    const g = guard(c);
    if (g) return g;
    const wallet = await bodyOrQuery(c, "wallet");
    if (!isAddress(wallet)) return bad(c, "Pass ?wallet=0x… (40 hex). Optional ?own=0x…,0x… for your registered wallets.");
    const startedAt = Date.now();
    const v: WalletVerdict = await verifyWallet(wallet, { ownWallets: ownWalletsParam(c) });
    const chatId = chatParam(c);
    (c as Context<AppEnv>).set("result", { tool: "verify", subject: wallet.toLowerCase(), summary: walletVerdictSummary(v), html: walletVerdictHtml(v), startedAt, ...(chatId ? { chatId } : {}) });
    return c.json({ ok: true, tool: "verify", verdict: v, text: walletVerdictHtml(v).replace(/<[^>]+>/g, "") });
  });

  app.on(["GET", "POST"], "/api/tagcheck", async (c) => {
    const g = guard(c);
    if (g) return g;
    const tx = await bodyOrQuery(c, "tx");
    if (!isTxHash(tx)) return bad(c, "Pass ?tx=0x… (64 hex). Optional ?tag=celo_… to check for your assigned code.");
    const expected = (await bodyOrQuery(c, "tag")) ?? null;
    const startedAt = Date.now();
    const t: TagCheck = await tagCheck(tx, expected);
    const chatId = chatParam(c);
    (c as Context<AppEnv>).set("result", { tool: "tagcheck", subject: tx.toLowerCase(), summary: tagCheckSummary(t), html: tagCheckHtml(t), startedAt, ...(chatId ? { chatId } : {}) });
    return c.json({ ok: true, tool: "tagcheck", check: t });
  });

  app.on(["GET", "POST"], "/api/audit", async (c) => {
    const g = guard(c);
    if (g) return g;
    const wallet = await bodyOrQuery(c, "wallet");
    if (!isAddress(wallet)) return bad(c, "Pass ?wallet=0x… (your registered payTo wallet). Optional ?own=0x…,0x… and ?tag=celo_….");
    const tag = (await bodyOrQuery(c, "tag")) ?? null;
    const maxRaw = Number(c.req.query("max") ?? "");
    const startedAt = Date.now();
    const r: AuditReport = await auditProject(wallet, {
      ownWallets: ownWalletsParam(c),
      tag,
      ...(Number.isInteger(maxRaw) && maxRaw >= 5 ? { maxCounterparties: Math.min(200, maxRaw) } : {}),
    });
    const chatId = chatParam(c);
    (c as Context<AppEnv>).set("result", { tool: "audit", subject: wallet.toLowerCase(), summary: auditSummary(r), html: auditHtml(r, publicUrl()), startedAt, ...(chatId ? { chatId } : {}) });
    return c.json({ ok: true, tool: "audit", report: r });
  });

  app.get("/api/standing", async (c) => {
    const tag = (c.req.query("tag") ?? "").trim().toLowerCase();
    if (!/^[a-z0-9_]{3,32}$/.test(tag)) return bad(c, "Pass ?tag=celo_… (your attribution tag).");
    try {
      const tracks = await Promise.all(
        (["track1", "track2", "stablecoin"] as const).map(async (k) => {
          const { rows, executedAt } = await trackRows(k);
          return { key: k, title: QUERIES[k].title, executedAt, row: findByTag(rows, tag) ?? null, eligibleLeaders: rows.filter((r) => /^yes$/i.test(String(r["Eligible"] ?? r["eligible"] ?? ""))).slice(0, 5) };
        }),
      );
      return c.json({ ok: true, tag, tracks, dashboard: dashboardUrl() });
    } catch (e) {
      if (e instanceof NoDuneKey) return c.json({ ok: false, tag, error: "Dune API key not configured on this deployment.", dashboard: dashboardUrl() }, 503);
      return c.json({ ok: false, tag, error: (e as Error).message, dashboard: dashboardUrl() }, 502);
    }
  });

  app.get("/api/rules", (c) => c.json({ rules: RULES, sources: ["https://dune.com/celo/agents-at-work-hackathon", "https://celobuilders.xyz/hackathons/agents-at-work/rules"] }));

  app.get("/api/prices", (c) => {
    const base = publicUrl();
    return c.json({
      network: "eip155:42220",
      payTo: config().AGENT_WALLET ?? null,
      assets: ["USA₮", "USDC", "USD₮"],
      tools: { verify: howToPay("verify", base), tagcheck: howToPay("tagcheck", base), audit: howToPay("audit", base) },
      note: "Pay any route with @celo/buy, with any x402 v2 client, or from a browser wallet at /pay. USA₮ over x402 is the highest-scoring rail for the stablecoin bounty.",
    });
  });

  app.get("/api/ledger", async (c) => {
    const limit = Math.min(200, Math.max(1, Number(c.req.query("limit") ?? 50)));
    const [rows, stats] = await Promise.all([getLedger().recent(limit), getLedger().stats()]);
    return c.json({ ledger: getLedger().kind, stats, rows });
  });

  // `ok` is whether the service can do the job it sells: quote a price and settle it.
  // An ephemeral ledger and a missing Dune key lose history and the /standing answer,
  // which is worth reporting, but a checker reading the status code should not be told
  // a service that is taking payments is down.
  app.get("/api/health", async (c) => {
    const cfg = config();
    const ledger = getLedger();
    const stats = await ledger.stats().catch(() => null);
    const ok = paymentsEnabled(cfg);
    const degraded: string[] = [];
    if (!ledgerDurable(ledger)) degraded.push("ledger is in memory: paid calls are lost on a cold start (set DATABASE_URL or BLOB_READ_WRITE_TOKEN)");
    if (!cfg.DUNE_API_KEY) degraded.push("DUNE_API_KEY is not set: /standing answers from the dashboard link only");
    if (!cfg.TELEGRAM_BOT_TOKEN) degraded.push("no Telegram bot token: the bot channel is off");
    return c.json(
      {
        ok,
        degraded,
        payments: paymentsEnabled(cfg),
        payTo: cfg.AGENT_WALLET ?? null,
        tag: cfg.ATTRIBUTION_TAG ?? null,
        ledger: ledger.kind,
        ledgerDurable: ledgerDurable(ledger),
        telegram: Boolean(cfg.TELEGRAM_BOT_TOKEN),
        dune: Boolean(cfg.DUNE_API_KEY),
        calls: stats?.calls ?? null,
        paidCalls: stats?.paidCalls ?? null,
        problems: configProblems(),
      },
      ok ? 200 : 503,
    );
  });
}
