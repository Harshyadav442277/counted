import type { Hono } from "hono";
import { config } from "../config.js";
import { isAddress, isTxHash } from "../core/chain.js";
import { verifyChat } from "../core/ids.js";
import { getLedger } from "../core/ledger/index.js";
import { landingPage, ledgerPage, mcpInfoPage, payPage, payPromptPage } from "../web/pages.js";
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
    const tag = (c.req.query("tag") ?? "").trim().toLowerCase();
    const tagOk = /^[a-z0-9_]{3,32}$/.test(tag) ? tag : null;
    // No subject is a visitor who followed the advertised link, not a bad request.
    // A subject that is present but wrong is still worth refusing plainly.
    if (!subject) return c.html(payPromptPage({ tool, tag: tagOk }));
    const params: Record<string, string> = {};
    if (tool === "tagcheck") {
      if (!isTxHash(subject)) return c.text("That is not a transaction hash. Pass ?tx=0x… with 64 hex characters.", 400);
      params["tx"] = subject;
    } else {
      if (!isAddress(subject)) return c.text("That is not a wallet address. Pass ?wallet=0x… with 40 hex characters.", 400);
      params["wallet"] = subject;
    }
    if (tagOk) params["tag"] = tagOk;
    const own = (c.req.query("own") ?? "").trim();
    if (own && own.split(",").every((a) => isAddress(a))) params["own"] = own;
    // A signed chat token from the bot: verified here and again by the API.
    const chat = c.req.query("chat");
    const chatOk = chat && verifyChat(chat, config().HASH_SALT) ? chat : null;
    return c.html(payPage({ tool, params, chat: chatOk }));
  });
}
