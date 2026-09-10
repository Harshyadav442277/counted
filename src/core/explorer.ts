import { config } from "../config.js";

/**
 * Blockscout v2 client for Celo mainnet. No API key, newest-first pagination, and
 * a `block_number` cursor that lets us start paging from a cutoff block: one call
 * answers "did this wallet do anything before 28 August".
 */
export interface Transfer {
  hash: string;
  block: number;
  at: string; // ISO
  from: string;
  to: string;
  token: { address: string; symbol: string | null; decimals: number };
  /** Raw integer amount, as a string. */
  value: string;
  method: string | null;
}

export interface Tx {
  hash: string;
  block: number;
  at: string;
  from: string;
  to: string | null;
  /** Native value in wei, as a string. */
  value: string;
  method: string | null;
  rawInput: string | null;
  status: string | null;
}

export interface AddressInfo {
  address: string;
  isContract: boolean;
  name: string | null;
  /** CELO/USD as reported by the explorer. */
  celoUsd: number | null;
}

interface Page<T> {
  items: T[];
  next: Record<string, string | number> | null;
}

type PageOpts = {
  /** Start paging strictly below this block (a cursor, not a filter). */
  beforeBlock?: number;
  /** Stop once items are older than this timestamp (ms). */
  stopBefore?: number;
  /** Direction filter as the explorer understands it. */
  filter?: "to" | "from";
  maxPages?: number;
};

const cache = new Map<string, { at: number; value: unknown }>();
const TTL_MS = 5 * 60_000;

async function getJson<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const base = config().BLOCKSCOUT_URL.replace(/\/+$/, "");
  const url = new URL(`${base}${path}`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  const key = url.toString();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as T;
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(key, {
        headers: { accept: "application/json", "user-agent": "counted/0.1 (+https://github.com/Harshyadav442277/counted)" },
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 404) return { items: [], next_page_params: null } as unknown as T;
      if (res.status === 429) {
        // Public explorer rate limit: back off hard rather than fail the audit.
        lastErr = new Error("explorer 429");
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        continue;
      }
      if (res.status >= 500) throw new Error(`explorer ${res.status}`);
      if (!res.ok) throw new Error(`explorer ${res.status} for ${path}`);
      const json = (await res.json()) as T;
      if (cache.size > 800) cache.clear();
      cache.set(key, { at: Date.now(), value: json });
      return json;
    } catch (e) {
      lastErr = e as Error;
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
  throw lastErr ?? new Error("explorer unreachable");
}

type RawTransfer = {
  transaction_hash: string;
  block_number: number;
  timestamp: string;
  from: { hash: string };
  to: { hash: string };
  token: { address_hash?: string; address?: string; symbol: string | null; decimals: string | null };
  total: { value?: string; decimals?: string | null };
  method: string | null;
};

type RawTx = {
  hash: string;
  block_number: number;
  timestamp: string;
  from: { hash: string };
  to: { hash: string } | null;
  value: string;
  method: string | null;
  raw_input?: string;
  status?: string | null;
};

function toTransfer(r: RawTransfer): Transfer {
  return {
    hash: r.transaction_hash,
    block: Number(r.block_number),
    at: new Date(r.timestamp).toISOString(),
    from: r.from.hash.toLowerCase(),
    to: r.to.hash.toLowerCase(),
    token: {
      address: (r.token.address_hash ?? r.token.address ?? "").toLowerCase(),
      symbol: r.token.symbol,
      decimals: Number(r.total.decimals ?? r.token.decimals ?? 18),
    },
    value: r.total.value ?? "0",
    method: r.method,
  };
}

function toTx(r: RawTx): Tx {
  return {
    hash: r.hash,
    block: Number(r.block_number),
    at: new Date(r.timestamp).toISOString(),
    from: r.from.hash.toLowerCase(),
    to: r.to?.hash?.toLowerCase() ?? null,
    value: r.value ?? "0",
    method: r.method,
    rawInput: r.raw_input ?? null,
    status: r.status ?? null,
  };
}

async function paged<TRaw, T>(
  path: string,
  map: (r: TRaw) => T,
  atOf: (t: T) => string,
  opts: PageOpts,
  extra: Record<string, string | number | undefined> = {},
): Promise<{ items: T[]; capped: boolean }> {
  const out: T[] = [];
  const maxPages = opts.maxPages ?? 4;
  let params: Record<string, string | number | undefined> = { ...extra };
  if (opts.filter) params["filter"] = opts.filter;
  if (opts.beforeBlock !== undefined) params = { ...params, block_number: opts.beforeBlock, index: 0, items_count: 50 };
  for (let page = 0; page < maxPages; page++) {
    const res = await getJson<{ items: TRaw[]; next_page_params: Record<string, string | number> | null }>(path, params);
    const items = (res.items ?? []).map(map);
    for (const it of items) {
      if (opts.stopBefore !== undefined && Date.parse(atOf(it)) < opts.stopBefore) return { items: out, capped: false };
      out.push(it);
    }
    if (!res.next_page_params) return { items: out, capped: false };
    params = { ...extra, ...(opts.filter ? { filter: opts.filter } : {}), ...res.next_page_params };
  }
  return { items: out, capped: true };
}

export async function tokenTransfers(address: string, opts: PageOpts = {}): Promise<{ items: Transfer[]; capped: boolean }> {
  return paged<RawTransfer, Transfer>(`/addresses/${address}/token-transfers`, toTransfer, (t) => t.at, opts, { type: "ERC-20" });
}

export async function transactions(address: string, opts: PageOpts = {}): Promise<{ items: Tx[]; capped: boolean }> {
  return paged<RawTx, Tx>(`/addresses/${address}/transactions`, toTx, (t) => t.at, opts);
}

export async function transaction(hash: string): Promise<Tx | null> {
  const r = await getJson<RawTx & { message?: string }>(`/transactions/${hash}`);
  if (!r || !r.hash) return null;
  return toTx(r);
}

export async function addressInfo(address: string): Promise<AddressInfo> {
  const r = await getJson<{ hash?: string; is_contract?: boolean; name?: string | null; exchange_rate?: string | null }>(`/addresses/${address}`);
  const rate = r.exchange_rate ? Number(r.exchange_rate) : null;
  return { address: address.toLowerCase(), isContract: Boolean(r.is_contract), name: r.name ?? null, celoUsd: rate && Number.isFinite(rate) ? rate : null };
}

/** Test seam: drop the response cache. */
export function resetExplorerCache(): void {
  cache.clear();
}
