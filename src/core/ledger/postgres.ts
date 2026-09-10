import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { computeStats, type CallRow, type Ledger, type Stats } from "./types.js";

/**
 * Neon Postgres over the HTTP driver: one stateless query per call, which suits
 * serverless. Schema is created on first use.
 */
const SCHEMA = `
create table if not exists counted_calls (
  id text primary key,
  at timestamptz not null,
  channel text not null,
  tool text not null,
  subject text not null,
  paid boolean not null default false,
  payer text,
  asset text,
  amount_usd double precision,
  settlement_tx text,
  status text not null,
  summary text,
  duration_ms integer
);
create index if not exists counted_calls_at_idx on counted_calls (at desc);
create index if not exists counted_calls_payer_idx on counted_calls (payer);`;

type Row = Record<string, unknown>;

export class PostgresLedger implements Ledger {
  readonly kind = "postgres" as const;
  private readonly sql: NeonQueryFunction<false, false>;
  private ready: Promise<void> | null = null;

  constructor(databaseUrl: string) {
    this.sql = neon(databaseUrl);
  }

  init(): Promise<void> {
    if (!this.ready) {
      this.ready = (async () => {
        for (const stmt of SCHEMA.split(";").map((s) => s.trim()).filter(Boolean)) await this.sql.query(stmt);
      })();
    }
    return this.ready;
  }

  private async q(text: string, params: unknown[] = []): Promise<Row[]> {
    await this.init();
    return (await this.sql.query(text, params)) as Row[];
  }

  async record(r: CallRow): Promise<void> {
    await this.q(
      `insert into counted_calls (id, at, channel, tool, subject, paid, payer, asset, amount_usd, settlement_tx, status, summary, duration_ms)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) on conflict (id) do nothing`,
      [r.id, r.at, r.channel, r.tool, r.subject, r.paid, r.payer, r.asset, r.amountUsd, r.settlementTx, r.status, r.summary, r.durationMs],
    );
  }

  async recent(limit: number): Promise<CallRow[]> {
    const rows = await this.q(`select * from counted_calls order by at desc limit $1`, [limit]);
    return rows.map(toCallRow);
  }

  async stats(): Promise<Stats> {
    // Small table for the life of the project: compute in code, one shape everywhere.
    const rows = await this.q(`select * from counted_calls order by at asc limit 20000`);
    return computeStats(rows.map(toCallRow));
  }

  async payers(): Promise<Array<{ payer: string; days: number; calls: number; firstAt: string }>> {
    const rows = await this.q(
      `select payer, count(distinct date_trunc('day', at at time zone 'utc'))::int as days, count(*)::int as calls, min(at) as first_at
       from counted_calls where paid and payer is not null and status = 'ok' group by payer`,
    );
    return rows.map((r) => ({ payer: String(r["payer"]), days: Number(r["days"]), calls: Number(r["calls"]), firstAt: iso(r["first_at"]) ?? "" }));
  }
}

function iso(v: unknown): string | null {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string") return new Date(v).toISOString();
  return null;
}

function toCallRow(r: Row): CallRow {
  const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
  const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
  return {
    id: String(r["id"]),
    at: iso(r["at"]) ?? "",
    channel: String(r["channel"]) as CallRow["channel"],
    tool: String(r["tool"]) as CallRow["tool"],
    subject: String(r["subject"] ?? ""),
    paid: Boolean(r["paid"]),
    payer: str(r["payer"]),
    asset: str(r["asset"]),
    amountUsd: num(r["amount_usd"]),
    settlementTx: str(r["settlement_tx"]),
    status: String(r["status"]) as CallRow["status"],
    summary: str(r["summary"]),
    durationMs: num(r["duration_ms"]),
  };
}
