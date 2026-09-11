import { put } from "@vercel/blob";
import { readFileSync } from "node:fs";
import { parseSnapshot, SNAPSHOT_PATH } from "../src/core/dune.js";

/**
 * Upload a snapshot of the public leaderboard so /standing can answer without a
 * Dune API key (a paid feature). Produce the file by running
 * `scripts/board-extract.browser.js` in the browser console on
 * https://dune.com/celo/agents-at-work-hackathon, then:
 *
 *   npm run board:snapshot -- path/to/board.json
 *
 * Needs BLOB_READ_WRITE_TOKEN (in .env.local after `vercel blob create-store`).
 */
const file = process.argv[2];
if (!file) throw new Error("usage: npm run board:snapshot -- <board.json>");
const snap = parseSnapshot(JSON.parse(readFileSync(file, "utf8")));
if (!snap) throw new Error("not a board snapshot: expected { capturedAt, tables: { track1: [...], track2: [...], ... } }");
const ageMin = Math.round((Date.now() - Date.parse(snap.capturedAt)) / 60_000);
if (ageMin > 24 * 60) throw new Error(`snapshot is ${Math.round(ageMin / 60)} hours old; capture a fresh one`);
const res = await put(SNAPSHOT_PATH, JSON.stringify(snap), {
  access: "public",
  addRandomSuffix: false,
  allowOverwrite: true,
  contentType: "application/json",
  cacheControlMaxAge: 60,
});
console.log(`uploaded ${SNAPSHOT_PATH} captured ${snap.capturedAt}${snap.boardUpdated ? ` (board said "${snap.boardUpdated}")` : ""}`);
for (const [k, rows] of Object.entries(snap.tables)) console.log(`  ${k}: ${rows?.length ?? 0} rows`);
console.log(res.url);
