import { config } from "../config.js";
import {
  FACILITATOR_RELAYER,
  LOOKBACK_START,
  NAMED_STABLES,
  WINDOW_END,
  WINDOW_START,
  WINDOW_START_BLOCK,
  usdFor,
} from "./chain.js";
import { addressInfo, tokenTransfers, transaction, transactions, type Transfer, type Tx } from "./explorer.js";
import { decodeTag, judgeTag, type TagVerdict } from "./tags.js";

/**
 * The audit engine. It reproduces, from public explorer data, the checks the
 * Agents at Work scoring applies to every counterparty:
 *   1. pre-existing history  - activity on Celo before 28 Aug (the prelude scans ~60 days)
 *   2. first-funder collapse - was the wallet first funded by the project itself
 *   3. spawn-window          - wallets born together are one script, not customers
 *   4. own wallets           - a project's own wallets are never its users
 * Nothing here is authoritative; the organisers' queries are. It is the same test,
 * run early enough to act on.
 */
export interface WalletVerdict {
  wallet: string;
  isContract: boolean;
  name: string | null;
  activeBeforeWindow: boolean;
  activeInLookback: boolean;
  lastActivityBeforeWindow: string | null;
  firstSeen: string | null;
  firstFunder: string | null;
  firstFunderResolved: boolean;
  flags: string[];
  verifiedUser: boolean;
  countsAsSigner: boolean;
  reasons: string[];
}

export interface VerifyContext {
  /** The project's registered wallet(s). Counterparties funded by these are excluded. */
  ownWallets?: string[];
}

const lower = (s: string) => s.toLowerCase();

async function celoscanFirst(wallet: string, key: string): Promise<{ at: string; from: string; to: string } | null> {
  const base = `https://api.etherscan.io/v2/api?chainid=42220&module=account&address=${wallet}&startblock=0&endblock=99999999&page=1&offset=1&sort=asc&apikey=${key}`;
  const pull = async (action: string) => {
    const res = await fetch(`${base}&action=${action}`, { signal: AbortSignal.timeout(15_000) });
    const json = (await res.json()) as { status: string; result: Array<{ timeStamp: string; from: string; to: string }> | string };
    if (json.status !== "1" || !Array.isArray(json.result) || !json.result[0]) return null;
    const r = json.result[0];
    return { at: new Date(Number(r.timeStamp) * 1000).toISOString(), from: lower(r.from), to: lower(r.to) };
  };
  const [tx, tok] = await Promise.all([pull("txlist").catch(() => null), pull("tokentx").catch(() => null)]);
  const both = [tx, tok].filter((x): x is NonNullable<typeof x> => Boolean(x));
  both.sort((a, b) => a.at.localeCompare(b.at));
  return both[0] ?? null;
}

/** Earliest known event for a wallet born inside the window, by paging its short history. */
async function freshWalletOrigin(wallet: string): Promise<{ at: string; from: string; to: string; capped: boolean } | null> {
  const [tr, tx] = await Promise.all([
    tokenTransfers(wallet, { maxPages: 6 }),
    transactions(wallet, { maxPages: 6 }),
  ]);
  const events: Array<{ at: string; from: string; to: string }> = [
    ...tr.items.map((t) => ({ at: t.at, from: t.from, to: t.to })),
    ...tx.items.filter((t) => t.value !== "0" || t.to === wallet).map((t) => ({ at: t.at, from: t.from, to: t.to ?? "" })),
  ];
  if (events.length === 0) return null;
  events.sort((a, b) => a.at.localeCompare(b.at));
  const inbound = events.find((e) => e.to === wallet) ?? events[0]!;
  return { ...inbound, capped: tr.capped || tx.capped };
}

export async function verifyWallet(walletRaw: string, ctx: VerifyContext = {}): Promise<WalletVerdict> {
  const wallet = lower(walletRaw);
  const own = new Set((ctx.ownWallets ?? []).map(lower));
  const [info, before, beforeTx] = await Promise.all([
    addressInfo(wallet).catch(() => ({ address: wallet, isContract: false, name: null, celoUsd: null })),
    tokenTransfers(wallet, { beforeBlock: WINDOW_START_BLOCK, maxPages: 1 }),
    transactions(wallet, { beforeBlock: WINDOW_START_BLOCK, maxPages: 1 }),
  ]);
  const latestBefore = [before.items[0]?.at, beforeTx.items[0]?.at].filter((x): x is string => Boolean(x)).sort().at(-1) ?? null;
  const activeBeforeWindow = latestBefore !== null;
  const activeInLookback = activeBeforeWindow && Date.parse(latestBefore) >= LOOKBACK_START;

  let firstSeen: string | null = null;
  let firstFunder: string | null = null;
  let firstFunderResolved = false;
  const reasons: string[] = [];
  const flags: string[] = [];

  if (!activeBeforeWindow) {
    const origin = await freshWalletOrigin(wallet);
    if (origin) {
      firstSeen = origin.at;
      firstFunder = origin.to === wallet ? origin.from : null;
      firstFunderResolved = !origin.capped;
      flags.push("fresh");
      reasons.push(`First seen ${origin.at.slice(0, 16)}Z, inside the counting window. Fresh wallets count as signers, never as verified users.`);
    } else {
      flags.push("no-activity");
      reasons.push("No transactions or token transfers found for this address on Celo mainnet.");
    }
  } else {
    reasons.push(
      activeInLookback
        ? `Active on Celo before 28 Aug (last seen ${latestBefore.slice(0, 16)}Z), inside the 60-day lookback the scoring prelude scans.`
        : `Active on Celo before 28 Aug, but last seen ${latestBefore.slice(0, 16)}Z, which is before the 60-day lookback window (${new Date(LOOKBACK_START).toISOString().slice(0, 10)}). Treat as unverified until the organisers confirm the lookback.`,
    );
    const key = config().CELOSCAN_API_KEY;
    if (key) {
      const first = await celoscanFirst(wallet, key).catch(() => null);
      if (first) {
        firstSeen = first.at;
        firstFunder = first.to === wallet ? first.from : null;
        firstFunderResolved = true;
      }
    }
  }

  if (info.isContract) {
    flags.push("contract");
    reasons.push(`This address is a contract${info.name ? ` (${info.name})` : ""}. Contracts are not users; trades against protocol contracts are excluded.`);
  }
  if (wallet === lower(FACILITATOR_RELAYER)) {
    flags.push("relayer");
    reasons.push("This is the x402 facilitator relayer. It submits settlements for every project and is never a counterparty.");
  }
  if (own.has(wallet)) {
    flags.push("own-wallet");
    reasons.push("This is one of the project's own registered wallets. A project's own wallets are not its users.");
  }
  if (firstFunder && own.has(firstFunder)) {
    flags.push("funded-by-project");
    reasons.push(`First funded by ${firstFunder}, which is one of the project's wallets. First-funder collapse excludes it.`);
  }

  const verifiedUser = activeInLookback && !info.isContract && !own.has(wallet) && !flags.includes("funded-by-project") && !flags.includes("relayer");
  const countsAsSigner = !own.has(wallet) && !flags.includes("relayer") && !info.isContract && !flags.includes("funded-by-project") && !flags.includes("no-activity");
  if (verifiedUser) reasons.push("Counts as a verified user: independent, pre-existing, not a contract.");
  else if (countsAsSigner) reasons.push("Counts as a signer/authoriser and as a counterparty, but not as a verified user.");

  return {
    wallet,
    isContract: info.isContract,
    name: info.name,
    activeBeforeWindow,
    activeInLookback,
    lastActivityBeforeWindow: latestBefore,
    firstSeen,
    firstFunder,
    firstFunderResolved,
    flags,
    verifiedUser,
    countsAsSigner,
    reasons,
  };
}

export interface TagCheck {
  hash: string;
  found: boolean;
  at: string | null;
  from: string | null;
  to: string | null;
  status: string | null;
  method: string | null;
  inWindow: boolean;
  submittedByFacilitator: boolean;
  tag: TagVerdict;
  notes: string[];
}

export async function tagCheck(hash: string, expected: string | null): Promise<TagCheck> {
  const tx = await transaction(hash);
  if (!tx) {
    return {
      hash,
      found: false,
      at: null,
      from: null,
      to: null,
      status: null,
      method: null,
      inWindow: false,
      submittedByFacilitator: false,
      tag: judgeTag(null, expected),
      notes: ["Transaction not found on Celo mainnet. Testnet activity counts for nothing."],
    };
  }
  const at = Date.parse(tx.at);
  const inWindow = at >= WINDOW_START && at <= WINDOW_END;
  const submittedByFacilitator = tx.from === lower(FACILITATOR_RELAYER);
  const tag = judgeTag(decodeTag(tx.rawInput), expected);
  const notes: string[] = [];
  if (!inWindow) notes.push("Outside the counting window (28 Aug 00:00 to 14 Sep 09:00 GMT). Not counted.");
  if (submittedByFacilitator) notes.push("Submitted by the x402 facilitator relayer. Settlements cannot carry a tag; they are attributed to the registered payTo wallet instead, so make sure that wallet is on your registration.");
  if (tx.status && tx.status !== "ok") notes.push(`Transaction status: ${tx.status}. Failed transactions move nothing.`);
  return { hash, found: true, at: tx.at, from: tx.from, to: tx.to, status: tx.status, method: tx.method, inWindow, submittedByFacilitator, tag, notes };
}

export interface CounterpartyReport {
  address: string;
  txs: number;
  days: number;
  firstAt: string;
  lastAt: string;
  usd: number;
  unpricedTxs: number;
  tokens: string[];
  x402Txs: number;
  verdict: WalletVerdict | null;
}

export interface AuditMetrics {
  allCounterparties: number;
  contracts: number;
  signers: number;
  verifiedUsers: number;
  returning: number;
  verifiedReturning: number;
  fresh: number;
  fundedByProject: number;
  grossUsd: number;
  independentUsd: number;
  verifiedSigners: number;
  signerGate: number;
  adjustedUsd: number;
  x402Settlements: number;
  stablecoins: string[];
  usatOverX402: boolean;
  taggedOwnTxs: number;
  untaggedOwnTxs: number;
}

export interface AuditReport {
  payTo: string;
  ownWallets: string[];
  tag: string | null;
  window: { start: string; end: string; lookbackStart: string };
  scanned: { transfers: number; nativeTxs: number; capped: boolean; counterpartiesInspected: number; counterpartiesTotal: number };
  counterparties: CounterpartyReport[];
  metrics: AuditMetrics;
  hints: string[];
  generatedAt: string;
}

interface Agg {
  hashes: Set<string>;
  days: Set<string>;
  firstAt: string;
  lastAt: string;
  usdByHash: Map<string, number>;
  unpriced: Set<string>;
  tokens: Set<string>;
  x402: Set<string>;
}

export function signerGate(verifiedSigners: number): number {
  return Math.min(1, verifiedSigners / 20);
}

async function pool<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]!);
      }
    }),
  );
  return out;
}

export async function auditProject(
  payToRaw: string,
  opts: { ownWallets?: string[]; tag?: string | null; maxCounterparties?: number } = {},
): Promise<AuditReport> {
  const payTo = lower(payToRaw);
  const ownList = [payTo, ...(opts.ownWallets ?? []).map(lower)];
  const own = new Set(ownList);
  const tag = opts.tag?.toLowerCase() ?? null;
  const maxCp = opts.maxCounterparties ?? config().AUDIT_MAX_COUNTERPARTIES;

  const [info, tr, tx] = await Promise.all([
    addressInfo(payTo).catch(() => ({ address: payTo, isContract: false, name: null, celoUsd: null })),
    tokenTransfers(payTo, { stopBefore: WINDOW_START, maxPages: 40 }),
    transactions(payTo, { stopBefore: WINDOW_START, maxPages: 12 }),
  ]);
  const celoUsd = info.celoUsd;
  const inWindow = (at: string) => {
    const t = Date.parse(at);
    return t >= WINDOW_START && t <= WINDOW_END;
  };
  const transfers: Transfer[] = tr.items.filter((t) => inWindow(t.at));
  const natives: Tx[] = tx.items.filter((t) => inWindow(t.at));

  const aggs = new Map<string, Agg>();
  const touch = (cp: string, hash: string, at: string, usd: number | null, token: string, x402: boolean) => {
    if (own.has(cp) || cp === payTo) return;
    const a = aggs.get(cp) ?? {
      hashes: new Set<string>(),
      days: new Set<string>(),
      firstAt: at,
      lastAt: at,
      usdByHash: new Map<string, number>(),
      unpriced: new Set<string>(),
      tokens: new Set<string>(),
      x402: new Set<string>(),
    };
    a.hashes.add(hash);
    a.days.add(at.slice(0, 10));
    if (at < a.firstAt) a.firstAt = at;
    if (at > a.lastAt) a.lastAt = at;
    if (usd === null) a.unpriced.add(hash);
    else a.usdByHash.set(hash, Math.max(a.usdByHash.get(hash) ?? 0, usd));
    a.tokens.add(token);
    if (x402) a.x402.add(hash);
    aggs.set(cp, a);
  };

  let x402Settlements = 0;
  const stables = new Set<string>();
  let usatOverX402 = false;
  for (const t of transfers) {
    if (t.from === t.to) continue;
    const cp = t.from === payTo ? t.to : t.from;
    const rate = usdFor(t.token.address, t.token.symbol, celoUsd);
    const amount = Number(t.value) / 10 ** t.token.decimals;
    const usd = rate === null ? null : amount * rate;
    const x402 = /withauthorization/i.test(t.method ?? "");
    if (x402) x402Settlements += 1;
    const stable = NAMED_STABLES[t.token.address];
    if (stable) stables.add(stable);
    if (x402 && stable === "USAT") usatOverX402 = true;
    touch(cp, t.hash, t.at, usd, t.token.symbol ?? t.token.address, x402);
  }
  let taggedOwnTxs = 0;
  let untaggedOwnTxs = 0;
  for (const t of natives) {
    if (t.from === payTo) {
      const decoded = decodeTag(t.rawInput);
      if (tag && decoded?.codes.map(lower).includes(tag)) taggedOwnTxs += 1;
      else untaggedOwnTxs += 1;
    }
    if (t.value === "0" || !t.to) continue;
    const cp = t.from === payTo ? t.to : t.from;
    const usd = celoUsd === null ? null : (Number(t.value) / 1e18) * celoUsd;
    touch(cp, t.hash, t.at, usd, "CELO", false);
  }

  const ranked = [...aggs.entries()]
    .map(([address, a]) => ({ address, a, usd: [...a.usdByHash.values()].reduce((x, y) => x + y, 0) }))
    .sort((x, y) => y.usd - x.usd || y.a.hashes.size - x.a.hashes.size);
  const inspect = ranked.slice(0, maxCp);
  const verdicts = await pool(inspect, 3, (r) => verifyWallet(r.address, { ownWallets: ownList }).catch(() => null));

  const counterparties: CounterpartyReport[] = ranked.map((r, i) => ({
    address: r.address,
    txs: r.a.hashes.size,
    days: r.a.days.size,
    firstAt: r.a.firstAt,
    lastAt: r.a.lastAt,
    usd: Number(r.usd.toFixed(4)),
    unpricedTxs: r.a.unpriced.size,
    tokens: [...r.a.tokens],
    x402Txs: r.a.x402.size,
    verdict: i < inspect.length ? (verdicts[i] ?? null) : null,
  }));

  const judged = counterparties.filter((c) => c.verdict);
  const contracts = judged.filter((c) => c.verdict!.isContract).length;
  const signers = judged.filter((c) => c.verdict!.countsAsSigner).length;
  const verified = judged.filter((c) => c.verdict!.verifiedUser);
  const returning = judged.filter((c) => c.verdict!.countsAsSigner && c.days >= 2).length;
  const verifiedReturning = verified.filter((c) => c.days >= 2).length;
  const fresh = judged.filter((c) => c.verdict!.flags.includes("fresh")).length;
  const fundedByProject = judged.filter((c) => c.verdict!.flags.includes("funded-by-project")).length;
  const grossUsd = counterparties.reduce((s, c) => s + c.usd, 0);
  const independentUsd = verified.reduce((s, c) => s + c.usd, 0);
  const gate = signerGate(verified.length);
  const metrics: AuditMetrics = {
    allCounterparties: counterparties.length,
    contracts,
    signers,
    verifiedUsers: verified.length,
    returning,
    verifiedReturning,
    fresh,
    fundedByProject,
    grossUsd: Number(grossUsd.toFixed(4)),
    independentUsd: Number(independentUsd.toFixed(4)),
    verifiedSigners: verified.length,
    signerGate: Number(gate.toFixed(3)),
    adjustedUsd: Number((independentUsd * gate).toFixed(4)),
    x402Settlements,
    stablecoins: [...stables],
    usatOverX402,
    taggedOwnTxs,
    untaggedOwnTxs,
  };

  const hints: string[] = [];
  if (counterparties.length === 0) hints.push("No counterparties inside the window yet. Nothing can rank until someone else's wallet transacts with this one.");
  if (verified.length === 0 && counterparties.length > 0) hints.push("Zero verified users: none of the counterparties inspected had Celo activity in the 60 days before 28 Aug. Track 2 ranks verified users first; recruit wallets that already existed.");
  if (verified.length > 0 && verified.length < 20) {
    const next = signerGate(verified.length + 5);
    hints.push(`Signer gate is ${gate.toFixed(2)} with ${verified.length} verified signers; five more would lift it to ${next.toFixed(2)} and adjusted volume from $${metrics.adjustedUsd.toFixed(2)} to $${(independentUsd * next).toFixed(2)}.`);
  }
  if (verified.length > 0 && verifiedReturning === 0) hints.push("No verified user has come back on a second UTC day. Returning users are the second ranking signal; give them a reason to return tomorrow.");
  if (fresh > 0) hints.push(`${fresh} of ${judged.length} inspected counterparties were born inside the window. They count as signers and counterparties, never as verified users.`);
  if (fundedByProject > 0) hints.push(`${fundedByProject} counterparties were first funded by your own wallets. The first-funder audit excludes them; do not count them.`);
  if (x402Settlements > 0 && !usatOverX402) hints.push("You settle over x402 but not in USA₮. USA₮ settled over x402 is the highest-scoring combination for Best Stablecoin Adoption.");
  if (x402Settlements === 0 && stables.size === 0) hints.push("No x402 settlements and no named stablecoin (USA₮, cNGN, wFIAT) flows: this wallet is not eligible for the stablecoin bounty as it stands.");
  if (tag && taggedOwnTxs === 0 && untaggedOwnTxs > 0) hints.push(`${untaggedOwnTxs} transactions sent by this wallet carry no ${tag} suffix. Only tagged transactions and facilitator settlements are attributed; there is no backfill.`);
  if (tr.capped || tx.capped) hints.push("The explorer scan was capped; volumes are a lower bound.");
  if (ranked.length > inspect.length) hints.push(`${ranked.length - inspect.length} smaller counterparties were not inspected (limit ${maxCp}).`);

  return {
    payTo,
    ownWallets: ownList,
    tag,
    window: { start: new Date(WINDOW_START).toISOString(), end: new Date(WINDOW_END).toISOString(), lookbackStart: new Date(LOOKBACK_START).toISOString() },
    scanned: { transfers: transfers.length, nativeTxs: natives.length, capped: tr.capped || tx.capped, counterpartiesInspected: inspect.length, counterpartiesTotal: ranked.length },
    counterparties,
    metrics,
    hints,
    generatedAt: new Date().toISOString(),
  };
}

/** The rules, as the product states them. Free, and the same text on every channel. */
export const RULES = [
  "Only Celo mainnet activity between 28 Aug 00:00 and 14 Sep 09:00 GMT counts.",
  "A counterparty counts only if it is not one of your registered wallets, was not first funded by you or your dominant funder, and had Celo activity before 28 Aug (the scoring prelude scans about 60 days back).",
  "Track 1 (Value Moved) ranks adjusted volume: net per transaction, independent counterparties only, multiplied by a gate on distinct signers that reaches 1.0 at about 20.",
  "Track 2 (Real World Adoption) ranks verified users first, returning users (2+ distinct UTC days) second, distinct signers and EIP-3009 authorisers third. Money moved is irrelevant.",
  "Best Stablecoin Adoption uses the same signals among projects using USA₮, cNGN or Ripio wFIAT, or settling over the x402 facilitator. USA₮ settled over x402 scores highest.",
  "Attribution comes from the ERC-8021 tag in your calldata, or from x402 settlements to your registered wallet. A tag cannot be added after sending.",
  "Drafts on the builders portal are registered but not eligible. Publish before the deadline.",
];
