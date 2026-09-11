import { config } from "../../config.js";
import { BlobLedger } from "./blob.js";
import { MemoryLedger } from "./memory.js";
import { PostgresLedger } from "./postgres.js";
import type { Ledger } from "./types.js";

let instance: Ledger | null = null;

/**
 * Postgres when DATABASE_URL is set, Vercel Blob when BLOB_READ_WRITE_TOKEN is set,
 * otherwise the labelled ephemeral ledger.
 */
export function getLedger(): Ledger {
  if (instance) return instance;
  const c = config();
  instance = c.DATABASE_URL ? new PostgresLedger(c.DATABASE_URL) : c.BLOB_READ_WRITE_TOKEN ? new BlobLedger() : new MemoryLedger();
  return instance;
}

/** A ledger that survives a cold start. */
export function ledgerDurable(l: Ledger = getLedger()): boolean {
  return l.kind !== "memory";
}

/** Test seam. */
export function setLedgerForTests(l: Ledger | null): void {
  instance = l;
}

export type { Ledger, CallRow, Channel, Stats, Tool } from "./types.js";
