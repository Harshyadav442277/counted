import type { Hono } from "hono";
import { isAddress, isTxHash } from "../core/chain.js";
import { getLedger } from "../core/ledger/index.js";
import { landingPage, ledgerPage, mcpInfoPage, payPage } from "../web/pages.js";
import type { AppEnv } from "./api.js";

/** Web channel: landing, the pay page, the ledger, MCP info. */
export function webRoutes(app: Hono<AppEnv>): void {
  app.get("/", async (c) => {
    const ledger = getLedger();
    const [stats, recent] = await Promise.all([ledger.stats(), ledger.recent(15)]);
    return c.html(landingPage({ stats, recent, ledgerKind: ledger.kind }));
  });

  app.get("/ledger", async (c) => {
    const ledger = getLedger();
    const [stats, rows] = await Promise.all([ledger.stats(), ledger.recent(200)]);
    return c.html(ledgerPage({ stats, rows, ledgerKind: ledger.kind }));
  });

  app.get("/mcp-info", (c) => c.html(mcpInfoPage()));

  app.get("/pay", (c) => {
    const toolRaw = c.req.query("tool") ?? "verify";
    const tool = toolRaw === "audit" || toolRaw === "tagcheck" ? toolRaw : "verify";
    const subject = (c.req.query("subject") ?? c.req.query("wallet") ?? c.req.query("tx") ?? "").trim();
    const params: Record<string, string> = {};
    if (tool === "tagcheck") {
      if (!isTxHash(subject)) return c.text("Pass a 0x… transaction hash.", 400);
      params["tx"] = subject;
    } else {
      if (!isAddress(subject)) return c.text("Pass a 0x… wallet address.", 400);
      params["wallet"] = subject;
    }
    const tag = (c.req.query("tag") ?? "").trim().toLowerCase();
    if (/^[a-z0-9_]{3,32}$/.test(tag)) params["tag"] = tag;
    const own = (c.req.query("own") ?? "").trim();
    if (own && own.split(",").every((a) => isAddress(a))) params["own"] = own;
    // A signed chat token from the bot; passed through untouched and verified by the API.
    const chat = c.req.query("chat");
    return c.html(payPage({ tool, params, chat: chat && /^-?\d{3,20}\.[0-9a-f]{24}$/.test(chat) ? chat : null }));
  });
}
