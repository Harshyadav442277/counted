import { Hono } from "hono";
import { config, publicUrl } from "./config.js";
import { apiRoutes, type AppEnv } from "./channels/api.js";
import { mcpRoutes } from "./channels/mcp.js";
import { installWebhook, telegramRoutes } from "./channels/telegram.js";
import { webRoutes } from "./channels/web.js";
import { bearer, secretsMatch } from "./core/ids.js";

/** One Hono app for every channel; served by Vercel (api/index.ts) and locally (server.ts). */
export const app = new Hono<AppEnv>();

app.onError((err, c) => {
  console.error(`${c.req.method} ${c.req.path}:`, err.message);
  return c.json({ error: err.message }, 500);
});

webRoutes(app);
apiRoutes(app);
mcpRoutes(app);
telegramRoutes(app);

/** Operator-only: register the Telegram webhook for PUBLIC_URL. */
app.post("/admin/telegram/webhook", async (c) => {
  const cfg = config();
  if (!cfg.ADMIN_TOKEN || !secretsMatch(bearer(c.req.header("authorization")), cfg.ADMIN_TOKEN)) return c.json({ error: "unauthorized" }, 401);
  const base = cfg.PUBLIC_URL ?? new URL(c.req.url).origin;
  return c.json({ ok: true, webhook: `${base}/telegram/webhook`, result: await installWebhook(base) });
});

app.get("/robots.txt", (c) => c.text("User-agent: *\nAllow: /\n"));
app.notFound((c) => c.json({ error: "not found", see: `${publicUrl()}/api/prices` }, 404));

export default app;
