import { config } from "../config.js";

/**
 * The organisers' published leaderboard queries. `/standing` reads their latest
 * results through the Dune API so a builder sees the row that will decide their
 * prize, not an estimate.
 */
export const QUERIES = {
  track1: { id: 8400974, title: "Track 1 — Value Moved" },
  track2: { id: 8405652, title: "Track 2 — Real World Adoption" },
  stablecoin: { id: 8405664, title: "Best Stablecoin Adoption" },
  headline: { id: 8425318, title: "Headline totals" },
} as const;

export type TrackKey = keyof typeof QUERIES;
export type Row = Record<string, unknown>;

const cache = new Map<TrackKey, { at: number; rows: Row[]; executedAt: string | null }>();
const TTL_MS = 10 * 60_000;

export class NoDuneKey extends Error {
  constructor() {
    super("DUNE_API_KEY is not set");
  }
}

export async function trackRows(track: TrackKey): Promise<{ rows: Row[]; executedAt: string | null; cached: boolean }> {
  const key = config().DUNE_API_KEY;
  if (!key) throw new NoDuneKey();
  const hit = cache.get(track);
  if (hit && Date.now() - hit.at < TTL_MS) return { rows: hit.rows, executedAt: hit.executedAt, cached: true };
  const res = await fetch(`https://api.dune.com/api/v1/query/${QUERIES[track].id}/results?limit=500`, {
    headers: { "X-Dune-API-Key": key },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Dune ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { execution_ended_at?: string; result?: { rows?: Row[] } };
  const rows = json.result?.rows ?? [];
  const executedAt = json.execution_ended_at ?? null;
  cache.set(track, { at: Date.now(), rows, executedAt });
  return { rows, executedAt, cached: false };
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Column lookup that survives Dune aliases with spaces, dashes or parentheses. */
export function col(row: Row, ...names: string[]): unknown {
  const wanted = names.map(norm);
  for (const [k, v] of Object.entries(row)) if (wanted.includes(norm(k))) return v;
  return undefined;
}

export function findByTag(rows: Row[], tag: string): Row | undefined {
  const t = tag.trim().toLowerCase();
  return rows.find((r) => String(col(r, "attribution tag", "tag", "code") ?? "").toLowerCase() === t)
    ?? rows.find((r) => Object.values(r).some((v) => String(v).toLowerCase() === t));
}

export function isEligible(row: Row): boolean {
  return /^yes$/i.test(String(col(row, "eligible") ?? ""));
}

export function dashboardUrl(): string {
  return "https://dune.com/celo/agents-at-work-hackathon";
}
