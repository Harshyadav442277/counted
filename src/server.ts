import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { config, configProblems, paymentsEnabled } from "./config.js";
import { getLedger } from "./core/ledger/index.js";

/** Local development server. Production is served by Vercel through api/index.ts. */
const port = Number(process.env["PORT"] ?? 3000);
const c = config();
await getLedger().init();
serve({ fetch: app.fetch, port }, () => {
  console.log(`counted on http://localhost:${port}`);
  console.log(`ledger: ${getLedger().kind} · payTo: ${c.AGENT_WALLET ?? "none"} · payments: ${paymentsEnabled(c) ? "enabled" : "DISABLED"}${c.ALLOW_UNPAID ? " (ALLOW_UNPAID)" : ""}`);
  for (const p of configProblems()) console.log(`note: ${p}`);
});
