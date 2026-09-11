import { list } from "@vercel/blob";
import { config } from "../config.js";

/**
 * The organisers' published leaderboard queries. `/standing` reads their latest
 * results through the Dune API when a key is configured. Dune's API is a paid
 * feature, so without a key it reads the latest *snapshot* of the public board,
 * uploaded with `npm run board:snapshot` after reading the dashboard in a browser,
 * and every answer carries the time the snapshot was taken.
 */
export const QUERIES = {
  track1: { id: 8400974, title: "Track 1 — Value Moved" },
  track2: { id: 8405652, title: "Track 2 — Real World Adoption" },
  stablecoin: { id: 8405664, title: "Best Stablecoin Adoption" },
  headline: { id: 8425318, title: "Headline totals" },
  askbots: { id: 8667672, title: "Track 3 — AskBots CLI Growth" },
  registered: { id: 8405672, title: "Registered projects" },
} as const;

export type TrackKey = keyof typeof QUERIES;
export type Row = Record<string, unknown>;
export type Source = "dune" | "snapshot";

/** The uploaded board snapshot: one row array per table, keyed as in QUERIES. */
export interface Snapshot {
  capturedAt: string;
  /** What the dashboard itself said, e.g. "Updated 3 hours ago", when captured. */
  boardUpdated?: string;
  tables: Partial<Record<TrackKey, Row[]>>;
}

export const SNAPSHOT_PATH = "board/latest.json";

const cache = new Map<TrackKey, { at: number; rows: Row[]; executedAt: string | null }>();
const TTL_MS = 10 * 60_000;

export class NoDuneKey extends Error {
  constructor() {
    super("No board data on this deployment: DUNE_API_KEY is not set and no board snapshot has been uploaded");
  }
}

/** Accepts only the shape `board:snapshot` writes; anything else is null, never a partial. */
export function parseSnapshot(raw: unknown): Snapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o["capturedAt"] !== "string" || Number.isNaN(Date.parse(o["capturedAt"]))) return null;
  if (!o["tables"] || typeof o["tables"] !== "object") return null;
  const tables: Partial<Record<TrackKey, Row[]>> = {};
  for (const [k, v] of Object.entries(o["tables"] as Record<string, unknown>)) {
    if (!(k in QUERIES) || !Array.isArray(v)) continue;
    if (!v.every((r) => r && typeof r === "object" && !Array.isArray(r))) return null;
    tables[k as TrackKey] = v as Row[];
  }
  if (!Object.keys(tables).length) return null;
  const snap: Snapshot = { capturedAt: new Date(o["capturedAt"]).toISOString(), tables };
  if (typeof o["boardUpdated"] === "string") snap.boardUpdated = o["boardUpdated"];
  return snap;
}

let snapshotCache: { at: number; snap: Snapshot | null } | null = null;
const SNAPSHOT_TTL_MS = 60_000;

/** The latest uploaded snapshot, or null when there is no Blob store or nothing uploaded. */
export async function loadSnapshot(): Promise<Snapshot | null> {
  if (!config().BLOB_READ_WRITE_TOKEN) return null;
  if (snapshotCache && Date.now() - snapshotCache.at < SNAPSHOT_TTL_MS) return snapshotCache.snap;
  let snap: Snapshot | null = null;
  try {
    const { blobs } = await list({ prefix: SNAPSHOT_PATH, limit: 5 });
    const b = blobs.find((x) => x.pathname === SNAPSHOT_PATH);
    if (b) {
      const version = b.uploadedAt instanceof Date ? b.uploadedAt.getTime() : Date.now();
      const res = await fetch(`${b.url}?v=${version}`, { signal: AbortSignal.timeout(10_000) });
      if (res.ok) snap = parseSnapshot(await res.json());
    }
  } catch (e) {
    console.error("board snapshot read failed:", (e as Error).message);
  }
  snapshotCache = { at: Date.now(), snap };
  return snap;
}

/** Test seam. */
export function resetSnapshotForTests(): void {
  snapshotCache = null;
}

export async function trackRows(track: TrackKey): Promise<{ rows: Row[]; executedAt: string | null; cached: boolean; source: Source }> {
  const key = config().DUNE_API_KEY;
  if (!key) {
    const snap = await loadSnapshot();
    const rows = snap?.tables[track];
    if (!snap || !rows) throw new NoDuneKey();
    return { rows, executedAt: snap.capturedAt, cached: true, source: "snapshot" };
  }
  const hit = cache.get(track);
  if (hit && Date.now() - hit.at < TTL_MS) return { rows: hit.rows, executedAt: hit.executedAt, cached: true, source: "dune" };
  const res = await fetch(`https://api.dune.com/api/v1/query/${QUERIES[track].id}/results?limit=500`, {
    headers: { "X-Dune-API-Key": key },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Dune ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { execution_ended_at?: string; result?: { rows?: Row[] } };
  const rows = json.result?.rows ?? [];
  const executedAt = json.execution_ended_at ?? null;
  cache.set(track, { at: Date.now(), rows, executedAt });
  return { rows, executedAt, cached: false, source: "dune" };
}

/** Where /standing answers from right now, for /api/health. */
export async function boardStatus(): Promise<{ source: Source | "none"; asOf: string | null }> {
  if (config().DUNE_API_KEY) return { source: "dune", asOf: null };
  const snap = await loadSnapshot();
  return snap ? { source: "snapshot", asOf: snap.capturedAt } : { source: "none", asOf: null };
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
