import { computeStats, type CallRow, type Ledger, type Stats } from "./types.js";

/** In-memory ledger for local development. Labelled "ephemeral" wherever it is shown. */
export class MemoryLedger implements Ledger {
  readonly kind = "memory" as const;
  private calls: CallRow[] = [];

  async init(): Promise<void> {}

  async record(row: CallRow): Promise<void> {
    if (this.calls.some((c) => c.id === row.id)) return;
    this.calls.push(row);
    if (this.calls.length > 5000) this.calls = this.calls.slice(-5000);
  }

  async recent(limit: number): Promise<CallRow[]> {
    return this.calls.slice(-limit).reverse();
  }

  async stats(): Promise<Stats> {
    return computeStats(this.calls);
  }

  async payers(): Promise<Array<{ payer: string; days: number; calls: number; firstAt: string }>> {
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
