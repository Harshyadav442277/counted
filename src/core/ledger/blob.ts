import { list, put } from "@vercel/blob";
import { computeStats, type CallRow, type Ledger, type Stats } from "./types.js";

/**
 * Vercel Blob ledger: one immutable JSON object per call under `calls/`, so two
 * settlements landing at the same moment can never overwrite each other. The rows
 * are read back once per container (a cold start) and then kept in memory, which
 * is the same shape the memory ledger has, minus the amnesia.
 *
 * The store is public by design: the ledger is served at /ledger and /api/ledger
 * anyway, and every row is a public subject plus a public settlement hash.
 */
const PREFIX = "calls/";
const FETCH_CONCURRENCY = 16;

export interface BlobClient {
  put: typeof put;
  list: typeof list;
  fetch: typeof fetch;
}

export class BlobLedger implements Ledger {
  readonly kind = "blob" as const;
  private calls: CallRow[] = [];
  private ready: Promise<void> | null = null;
  private readonly client: BlobClient;

  constructor(client: BlobClient = { put, list, fetch }) {
    this.client = client;
  }

  init(): Promise<void> {
    if (!this.ready) this.ready = this.load();
    return this.ready;
  }

  private async load(): Promise<void> {
    const urls: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.client.list({ prefix: PREFIX, limit: 1000, ...(cursor ? { cursor } : {}) });
      for (const b of page.blobs) urls.push(b.url);
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);

    const rows: CallRow[] = [];
    for (let i = 0; i < urls.length; i += FETCH_CONCURRENCY) {
      const batch = urls.slice(i, i + FETCH_CONCURRENCY);
      const got = await Promise.all(
        batch.map(async (url) => {
          try {
            const res = await this.client.fetch(url, { signal: AbortSignal.timeout(10_000) });
            if (!res.ok) return null;
            return (await res.json()) as CallRow;
          } catch {
            return null;
          }
        }),
      );
      for (const r of got) if (r && typeof r.id === "string" && typeof r.at === "string") rows.push(r);
    }
    rows.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    // Rows recorded while the load was in flight stay; the store copy wins on a clash.
    const seen = new Set(rows.map((r) => r.id));
    for (const c of this.calls) if (!seen.has(c.id)) rows.push(c);
    this.calls = rows;
  }

  /** `calls/<ISO time>-<id>.json`: sorts by time in any listing, unique per call. */
  static pathFor(row: CallRow): string {
    const id = row.id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || "row";
    return `${PREFIX}${row.at.replace(/[:.]/g, "-")}-${id}.json`;
  }

  async record(row: CallRow): Promise<void> {
    await this.init();
    if (this.calls.some((c) => c.id === row.id)) return;
    this.calls.push(row);
    await this.client.put(BlobLedger.pathFor(row), JSON.stringify(row), {
      access: "public",
      addRandomSuffix: false,
      contentType: "application/json",
    });
  }

  async recent(limit: number): Promise<CallRow[]> {
    await this.init();
    return this.calls.slice(-limit).reverse();
  }

  async stats(): Promise<Stats> {
    await this.init();
    return computeStats(this.calls);
  }

  async payers(): Promise<Array<{ payer: string; days: number; calls: number; firstAt: string }>> {
    await this.init();
    const m = new Map<string, { days: Set<string>; calls: number; firstAt: string }>();
    for (const c of this.calls) {
      if (!c.paid || !c.payer || c.status !== "ok") continue;
      const e = m.get(c.payer) ?? { days: new Set<string>(), calls: 0, firstAt: c.at };
      e.days.add(c.at.slice(0, 10));
      e.calls += 1;
      if (c.at < e.firstAt) e.firstAt = c.at;
      m.set(c.payer, e);
    }
    return [...m.entries()].map(([payer, e]) => ({ payer, days: e.days.size, calls: e.calls, firstAt: e.firstAt }));
  }
}
