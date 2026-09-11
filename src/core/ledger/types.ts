/**
 * The ledger is the evidence. Every check, paid or free, is one row; every x402
 * settlement carries the payer and the on-chain hash so the funding graph can be
 * shown on request (the organisers give 48 hours of right of reply).
 */
export type Channel = "telegram" | "web" | "mcp" | "api";
export type Tool = "verify" | "tagcheck" | "audit" | "standing";

export interface CallRow {
  id: string;
  at: string; // ISO
  channel: Channel;
  tool: Tool;
  /** What was checked: a wallet, a tx hash, a tag. Public by nature. */
  subject: string;
  paid: boolean;
  payer: string | null;
  asset: string | null;
  amountUsd: number | null;
  settlementTx: string | null;
  status: "ok" | "error";
  /** One-line result summary, ≤200 chars. */
  summary: string | null;
  durationMs: number | null;
}

export interface Stats {
  calls: number;
  paidCalls: number;
  payers: number;
  revenueUsd: number;
  byTool: Record<string, number>;
  byAsset: Record<string, number>;
  today: { calls: number; payers: number };
  firstAt: string | null;
  lastAt: string | null;
}

export interface Ledger {
  readonly kind: "postgres" | "blob" | "memory";
  init(): Promise<void>;
  record(row: CallRow): Promise<void>;
  recent(limit: number): Promise<CallRow[]>;
  stats(): Promise<Stats>;
  /** Distinct payers with their days of activity, for the spawn-window self-check. */
  payers(): Promise<Array<{ payer: string; days: number; calls: number; firstAt: string }>>;
}

export function utcDayStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function computeStats(calls: CallRow[]): Stats {
  const ok = calls.filter((c) => c.status === "ok");
  const paid = ok.filter((c) => c.paid);
  const day = utcDayStart().toISOString();
  const today = ok.filter((c) => c.at >= day);
  const byTool: Record<string, number> = {};
  const byAsset: Record<string, number> = {};
  for (const c of ok) byTool[c.tool] = (byTool[c.tool] ?? 0) + 1;
  for (const c of paid) if (c.asset) byAsset[c.asset] = (byAsset[c.asset] ?? 0) + 1;
  return {
    calls: calls.length,
    paidCalls: paid.length,
    payers: new Set(paid.map((c) => c.payer).filter(Boolean)).size,
    revenueUsd: Number(paid.reduce((a, c) => a + (c.amountUsd ?? 0), 0).toFixed(4)),
    byTool,
    byAsset,
    today: { calls: today.length, payers: new Set(today.filter((c) => c.paid).map((c) => c.payer)).size },
    firstAt: ok[0]?.at ?? null,
    lastAt: ok.at(-1)?.at ?? null,
  };
}
