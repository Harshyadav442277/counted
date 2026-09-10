import { config } from "../../config.js";
import { MemoryLedger } from "./memory.js";
import { PostgresLedger } from "./postgres.js";
import type { Ledger } from "./types.js";

let instance: Ledger | null = null;

/** Postgres when DATABASE_URL is set, otherwise the labelled ephemeral ledger. */
export function getLedger(): Ledger {
  if (instance) return instance;
  const url = config().DATABASE_URL;
  instance = url ? new PostgresLedger(url) : new MemoryLedger();
  return instance;
}

/** Test seam. */
export function setLedgerForTests(l: Ledger | null): void {
  instance = l;
}

export type { Ledger, CallRow, Channel, Stats, Tool } from "./types.js";
