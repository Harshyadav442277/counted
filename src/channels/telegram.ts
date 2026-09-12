import { Bot, InlineKeyboard, webhookCallback, type Context } from "grammy";
import type { Hono } from "hono";
import { config, publicUrl } from "../config.js";
import { RULES } from "../core/audit.js";
import { isAddress, isTxHash } from "../core/chain.js";
import { dashboardUrl, findByTag, NoDuneKey, QUERIES, trackRows } from "../core/dune.js";
import { esc, standingHtml } from "../core/format.js";
import { signChat } from "../core/ids.js";
import { priceUsd } from "../core/x402.js";
import type { AppEnv } from "./api.js";

/**
 * Telegram channel. Free: /standing and /rules. Paid checks hand out a pay link;
 * once the facilitator settles, the result lands back in this chat.
 */
let bot: Bot | null = null;
let botReady: Promise<void> | null = null;

const OPTS = { parse_mode: "HTML" as const, link_preview_options: { is_disabled: true } };

const START = [
  "<b>Counted</b> — does your Celo activity actually count?",
  "",
  "The Agents at Work leaderboard only counts counterparties that are independent and moved a token on Celo between 29 Jun and 28 Aug. This bot runs that audit on any wallet, transaction or project, and settles each check in USA₮ over x402.",
  "",
  "/standing celo_yourtag — your live row on the three track queries (free)",
  "/verify 0x… — does this wallet count as a verified user? ($PRICE_CHECK)",
  "/tagcheck 0x… — is your attribution tag in this transaction? ($PRICE_CHECK)",
  "/audit 0x… — full pre-submission audit of your payTo wallet ($PRICE_AUDIT)",
  "/rules — the scoring rules in plain words (free)",
  "/pay — how to pay: buy, MetaMask, or any x402 client",
].join("\n");

export const COMMANDS = [
  { command: "start", description: "What Counted is" },
  { command: "standing", description: "Your live leaderboard row: /standing celo_…" },
  { command: "verify", description: "Does a wallet count as a verified user? /verify 0x…" },
  { command: "tagcheck", description: "Is your tag in a transaction? /tagcheck 0x…" },
  { command: "audit", description: "Full pre-submission audit: /audit 0x…" },
  { command: "rules", description: "The scoring rules, plain words" },
  { command: "pay", description: "How to pay" },
  { command: "help", description: "All commands" },
];

function payLink(tool: "verify" | "tagcheck" | "audit", params: Record<string, string>, chatId: string | number): string {
  const u = new URL(`${publicUrl()}/pay`);
  u.searchParams.set("tool", tool);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  // Signed, so only this chat can receive the result (see ids.ts).
  u.searchParams.set("chat", signChat(chatId, config().HASH_SALT));
  return u.toString();
}

function payKeyboard(url: string, label: string): InlineKeyboard {
  return new InlineKeyboard().url(label, url);
}

function withPrices(s: string): string {
  return s.replace(/\$PRICE_CHECK/g, `$${priceUsd("verify").toFixed(2)}`).replace(/\$PRICE_AUDIT/g, `$${priceUsd("audit").toFixed(2)}`);
}

export function getBot(): Bot {
  if (bot) return bot;
  const c = config();
  if (!c.TELEGRAM_BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  const b = new Bot(c.TELEGRAM_BOT_TOKEN);

  b.command(["start", "help"], (ctx) => ctx.reply(withPrices(START), OPTS));

  b.command("rules", (ctx) => ctx.reply(`<b>What counts</b>\n\n${RULES.map((r) => `• ${esc(r)}`).join("\n")}\n\nBoard: ${dashboardUrl()}`, OPTS));

  b.command("pay", (ctx) => {
    const base = publicUrl();
    ctx.reply(
      [
        "<b>Three ways to pay</b>",
        "",
        `1. Agents with <code>@celo/buy</code>: <code>npx --yes @celo/buy@0.5.0 curl --max-amount 0.05 --token USDT "${esc(base)}/api/verify?wallet=0x…"</code>`,
        `2. Humans: open the pay page from any /verify, /tagcheck or /audit reply and sign with MetaMask or Rabby. USA₮ by default.`,
        `3. Any x402 v2 client against ${esc(base)}/api/verify, /api/tagcheck, /api/audit on eip155:42220.`,
        "",
        "Pay from a wallet that moved a token on Celo between 29 Jun and 28 Aug: that is the one that counts as a verified user for you and for us.",
        "Need USA₮? Verify once in the Self app and claim from the Google Cloud faucet: https://cloud.google.com/application/web3/faucet/celo/mainnet",
      ].join("\n"),
      OPTS,
    );
  });

  b.command("standing", async (ctx) => {
    const tag = (ctx.match ?? "").trim().toLowerCase();
    if (!/^[a-z0-9_]{3,32}$/.test(tag)) return ctx.reply("Send /standing followed by your attribution tag, e.g. /standing celo_9d71588659ec");
    try {
      const tracks = await Promise.all(
        (["track1", "track2", "stablecoin"] as const).map(async (k) => {
          const { rows, executedAt, source } = await trackRows(k);
          return { title: QUERIES[k].title, row: findByTag(rows, tag), rows, executedAt, source };
        }),
      );
      await ctx.reply(standingHtml(tag, tracks), OPTS);
    } catch (e) {
      if (e instanceof NoDuneKey) return ctx.reply(`No board snapshot is loaded on this deployment yet. Read your row here: ${dashboardUrl()}`);
      await ctx.reply(`Could not read the board: ${esc((e as Error).message)}`, OPTS);
    }
  });

  b.command("verify", async (ctx) => {
    const parts = (ctx.match ?? "").trim().split(/\s+/).filter(Boolean);
    const wallet = parts[0];
    if (!isAddress(wallet)) return ctx.reply("Send /verify followed by a 0x… wallet. Optionally add your own registered wallet(s) after it so first-funder checks know who you are.");
    const own = parts.slice(1).filter((p) => isAddress(p)).join(",");
    const url = payLink("verify", { wallet, ...(own ? { own } : {}) }, ctx.chat.id);
    await ctx.reply(
      `Will check <code>${esc(wallet)}</code>: pre-28-Aug history, 60-day lookback, first funder, contract and own-wallet flags.\n\nPay $${priceUsd("verify").toFixed(2)} in USA₮ (or USDC/USD₮) and the verdict is posted back here.`,
      { ...OPTS, reply_markup: payKeyboard(url, `Pay $${priceUsd("verify").toFixed(2)} and get the verdict here`) },
    );
  });

  b.command("tagcheck", async (ctx) => {
    const parts = (ctx.match ?? "").trim().split(/\s+/).filter(Boolean);
    const tx = parts[0];
    if (!isTxHash(tx)) return ctx.reply("Send /tagcheck followed by a 0x… transaction hash. Optionally add your celo_… tag to check for it.");
    const tag = parts[1] && /^[a-z0-9_]{3,32}$/i.test(parts[1]) ? parts[1].toLowerCase() : "";
    const url = payLink("tagcheck", { tx, ...(tag ? { tag } : {}) }, ctx.chat.id);
    await ctx.reply(
      `Will decode the ERC-8021 suffix on <code>${esc(tx)}</code>${tag ? ` and look for <code>${esc(tag)}</code>` : ""}, and say whether it is inside the counting window.\n\nPay $${priceUsd("tagcheck").toFixed(2)} and the result is posted back here.`,
      { ...OPTS, reply_markup: payKeyboard(url, `Pay $${priceUsd("tagcheck").toFixed(2)} and get the result here`) },
    );
  });

  b.command("audit", async (ctx) => {
    const parts = (ctx.match ?? "").trim().split(/\s+/).filter(Boolean);
    const wallet = parts[0];
    if (!isAddress(wallet)) return ctx.reply("Send /audit followed by your registered payTo wallet. Optionally add your celo_… tag and other own wallets.");
    const tag = parts.find((p) => /^celo_[0-9a-f]{12}$/i.test(p))?.toLowerCase() ?? "";
    const own = parts.slice(1).filter((p) => isAddress(p)).join(",");
    const url = payLink("audit", { wallet, ...(tag ? { tag } : {}), ...(own ? { own } : {}) }, ctx.chat.id);
    await ctx.reply(
      `Will audit <code>${esc(wallet)}</code> over the whole counting window: every counterparty classified, verified and returning users, signer gate, adjusted volume, stablecoin and x402 flags, and what would change your rank.\n\nPay $${priceUsd("audit").toFixed(2)} and the report is posted back here.`,
      { ...OPTS, reply_markup: payKeyboard(url, `Pay $${priceUsd("audit").toFixed(2)} and get the audit here`) },
    );
  });

  b.on("message:text", async (ctx) => {
    if (ctx.chat.type !== "private") return;
    const t = ctx.message.text.trim();
    if (isAddress(t)) return ctx.reply(`Looks like a wallet. Use /verify ${t} or /audit ${t}.`);
    if (isTxHash(t)) return ctx.reply(`Looks like a transaction. Use /tagcheck ${t}.`);
    if (/^celo_[0-9a-f]{12}$/i.test(t)) return ctx.reply(`Looks like a tag. Use /standing ${t.toLowerCase()}.`);
    return ctx.reply(withPrices(START), OPTS);
  });

  b.catch((err) => console.error("telegram handler error:", err.error));
  bot = b;
  return b;
}

/** Post a result into a chat after the facilitator settles the payment. */
export async function notifyChat(chatId: string, html: string): Promise<void> {
  if (!config().TELEGRAM_BOT_TOKEN) return;
  const b = getBot();
  try {
    await b.api.sendMessage(chatId, html.slice(0, 4000), OPTS);
  } catch {
    await b.api.sendMessage(chatId, html.replace(/<[^>]+>/g, "").slice(0, 4000));
  }
}

export function telegramRoutes(app: Hono<AppEnv>): void {
  app.post("/telegram/webhook", async (c) => {
    const cfg = config();
    if (!cfg.TELEGRAM_BOT_TOKEN) return c.json({ error: "telegram is not configured" }, 503);
    // Never accept unsigned updates: without the secret anyone could drive the bot.
    if (!cfg.TELEGRAM_WEBHOOK_SECRET) return c.json({ error: "TELEGRAM_WEBHOOK_SECRET is not set; webhook disabled" }, 503);
    const b = getBot();
    botReady ??= b.init();
    await botReady;
    const handler = webhookCallback(b, "hono", "return", 25_000, cfg.TELEGRAM_WEBHOOK_SECRET);
    return handler(c);
  });
}

/** Operator action: point Telegram at this deployment and publish the command menu. */
export async function installWebhook(base: string): Promise<unknown> {
  const cfg = config();
  if (!cfg.TELEGRAM_WEBHOOK_SECRET) throw new Error("TELEGRAM_WEBHOOK_SECRET is required before installing the webhook");
  const b = getBot();
  const webhook = await b.api.setWebhook(`${base.replace(/\/+$/, "")}/telegram/webhook`, {
    secret_token: cfg.TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ["message"],
    drop_pending_updates: true,
  });
  const commands = await b.api.setMyCommands(COMMANDS);
  return { webhook, commands };
}

export type { Context };
