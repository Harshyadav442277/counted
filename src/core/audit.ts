import { config } from "../config.js";
import {
  FACILITATOR_RELAYER,
  LOOKBACK_START,
  NAMED_STABLES,
  WINDOW_END,
  WINDOW_START,
  WINDOW_START_BLOCK,
  txInputs,
  usdFor,
} from "./chain.js";
import { addressInfo, tokenTransfers, transaction, transactions, type Transfer, type Tx } from "./explorer.js";
import { decodeTag, judgeTag, type TagVerdict } from "./tags.js";

/**
 * The audit engine. It reproduces, from public explorer data, the checks the
 * Agents at Work scoring applies to every counterparty:
 *   1. pre-existing history  - a token transfer on Celo in 29 Jun - 28 Aug (organisers, 12 Sep)
 *   2. first-funder collapse - was the wallet first funded by the project itself
 *   3. spawn-window          - wallets born together are one script, not customers
 *   4. own wallets           - a project's own wallets are never its users
 * and, before any of that, attribution: only transactions carrying the project's
 * ERC-8021 tag, or x402 settlements to its registered wallet, exist for the board.
 * Nothing here is authoritative; the organisers' queries are. It is the same test,
 * run early enough to act on.
 */
export interface WalletVerdict {
  wallet: string;
  isContract: boolean;
  /** False when the address lookup failed, so `isContract` is a default rather than an answer. */
  contractKnown: boolean;
  name: string | null;
  activeBeforeWindow: boolean;
  activeInLookback: boolean;
  lastActivityBeforeWindow: string | null;
  /** Latest *token transfer* before the window. Only these make a wallet pre-existing. */
  lastTokenTransferBeforeWindow: string | null;
  firstSeen: string | null;
  firstFunder: string | null;
  firstFunderResolved: boolean;
  flags: string[];
  verifiedUser: boolean;
  countsAsSigner: boolean;
  reasons: string[];
}

/**
 * Whether a counterparty counts, from what the explorer actually answered. An
 * unresolved contract check is not a passed one: if the address lookup failed we
 * cannot say the wallet is not a contract, so it counts as neither a verified user
 * nor a signer until the check is re-run. Understating is the safe direction here —
 * the product exists to be trusted when it says an activity counts.
 */
export function countsFor(o: {
  activeInLookback: boolean;
  isContract: boolean;
  contractKnown: boolean;
  ownWallet: boolean;
  fundedByProject: boolean;
  relayer: boolean;
  noActivity: boolean;
}): { verifiedUser: boolean; countsAsSigner: boolean } {
  const excluded = o.ownWallet || o.relayer || o.fundedByProject || o.isContract || !o.contractKnown;
  return {
    verifiedUser: !excluded && o.activeInLookback,
    countsAsSigner: !excluded && !o.noActivity,
  };
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
  const [tr, tx] = await Promise.all([tokenTransfers(wallet, { maxPages: 6 }), transactions(wallet, { maxPages: 6 })]);
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
    // A failed lookup must not read as "not a contract": that default would promote
    // an unanswered check into a passed one and credit a protocol contract as a user.
    addressInfo(wallet)
      .then((i) => ({ ...i, known: true }))
      .catch(() => ({ address: wallet, isContract: false, name: null, celoUsd: null, known: false })),
    tokenTransfers(wallet, { beforeBlock: WINDOW_START_BLOCK, maxPages: 1 }),
    transactions(wallet, { beforeBlock: WINDOW_START_BLOCK, maxPages: 1 }),
  ]);
  const latestBefore = [before.items[0]?.at, beforeTx.items[0]?.at].filter((x): x is string => Boolean(x)).sort().at(-1) ?? null;
  const activeBeforeWindow = latestBefore !== null;
  // Organisers, 2026-09-12: the prelude scans *token transfers* only, over 29 Jun - 28 Aug.
  // A wallet that only made contract calls in that window is not pre-existing, so the
  // lookback test reads the token-transfer feed alone; plain transactions are context.
  const latestTokenBefore = before.items[0]?.at ?? null;
  const activeInLookback = latestTokenBefore !== null && Date.parse(latestTokenBefore) >= LOOKBACK_START;

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
        ? `Moved a token on Celo at ${latestTokenBefore!.slice(0, 16)}Z, inside the 29 Jun - 28 Aug window the scoring prelude scans. Pre-existing.`
        : latestTokenBefore
          ? `Last token transfer ${latestTokenBefore.slice(0, 16)}Z, before the 29 Jun - 28 Aug window. Not pre-existing: the prelude scans that window only (organisers, 12 Sep).`
          : `Active on Celo before 28 Aug (last seen ${latestBefore.slice(0, 16)}Z) but with no token transfer. Only token transfers make a wallet pre-existing (organisers, 12 Sep), so contract calls alone do not qualify.`,
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
  if (!info.known) {
    flags.push("contract-unknown");
    reasons.push("The explorer could not answer whether this address is a contract, so it is counted as neither a verified user nor a signer. Run the check again in a few minutes.");
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

  const { verifiedUser, countsAsSigner } = countsFor({
    activeInLookback,
    isContract: info.isContract,
    contractKnown: info.known,
    ownWallet: own.has(wallet),
    fundedByProject: flags.includes("funded-by-project"),
    relayer: flags.includes("relayer"),
    noActivity: flags.includes("no-activity"),
  });
  if (verifiedUser) reasons.push("Counts as a verified user: independent, pre-existing, not a contract.");
  else if (countsAsSigner) reasons.push("Counts as a signer/authoriser and as a counterparty, but not as a verified user.");

  return { wallet, isContract: info.isContract, contractKnown: info.known, name: info.name, activeBeforeWindow, activeInLookback, lastActivityBeforeWindow: latestBefore, lastTokenTransferBeforeWindow: latestTokenBefore, firstSeen, firstFunder, firstFunderResolved, flags, verifiedUser, countsAsSigner, reasons };
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
      hash, found: false, at: null, from: null, to: null, status: null, method: null, inWindow: false, submittedByFacilitator: false,
      tag: judgeTag(null, expected),
      notes: ["Transaction not found on Celo mainnet. Testnet activity counts for nothing."],
    };
  }
  const at = Date.parse(tx.at);
  const inWindow = at >= WINDOW_START && at <= WINDOW_END;
  const submittedByFacilitator = tx.from === lower(FACILITATOR_RELAYER);
  const tag = judgeTag(decodeTag(tx.rawInput), expected);
  const notes: string[] = [];
  if (!inWindow) notes.push("Outside the counting window (28 Aug 00:00 to 21 Sep 09:00 GMT). Not counted.");
  if (submittedByFacilitator) notes.push("Submitted by the x402 facilitator relayer. Settlements cannot carry a tag; they are attributed to the registered payTo wallet instead, so make sure that wallet is on your registration.");
  if (tx.status && tx.status !== "ok") notes.push(`Transaction status: ${tx.status}. Failed transactions move nothing.`);
  return { hash, found: true, at: tx.at, from: tx.from, to: tx.to, status: tx.status, method: tx.method, inWindow, submittedByFacilitator, tag, notes };
}

/** How the board sees one transaction. */
export type Attribution = "x402" | "tagged" | "other-tag" | "none" | "unknown";

/**
 * Attribution of a transaction: an x402 settlement (relayer-submitted, attributed by
 * wallet), a transaction whose calldata carries the project's tag, a different tag,
 * nothing, or unknown when the calldata could not be fetched.
 */
export function classifyTx(o: { x402: boolean; codes: string[] | null; tag: string | null }): Attribution {
  if (o.x402) return "x402";
  if (o.codes === null) return "unknown";
  if (o.codes.length === 0) return "none";
  if (o.tag === null) return "tagged";
  return o.codes.map(lower).includes(o.tag) ? "tagged" : "other-tag";
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
  attributedTxs: number;
  x402Txs: number;
  taggedTxs: number;
  unattributedTxs: number;
  unattributedUsd: number;
  unattributedCounterparties: number;
  unknownAttributionTxs: number;
  otherCodesSeen: string[];
  allCounterparties: number;
  /** Inspected counterparties the explorer could not answer for; their legs are excluded from the verified totals. */
  unverifiedCounterparties: number;
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
  scanned: { transfers: number; nativeTxs: number; uniqueTxs: number; capped: boolean; counterpartiesInspected: number; counterpartiesTotal: number };
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

/**
 * least(1, signers / 20). Organisers, 12 Sep: the signer count is taken across all of a
 * project's counted payments, not only the independent ones, excluding its own wallets.
 * Only the volume it multiplies is restricted to pre-existing counterparties.
 */
export function signerGate(distinctSigners: number): number {
  return Math.min(1, distinctSigners / 20);
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

/**
 * Calldata fetches per audit for transfers whose transaction is not in the wallet's
 * own tx list (a user calling a token contract directly, for instance). Fetched in
 * order of value so anything left unclassified is the smallest legs.
 */
const INPUT_FETCH_CAP = 600;

/** EIP-3009 selectors: transferWithAuthorization (v,r,s and bytes forms) and receiveWithAuthorization. */
const X402_SELECTORS = new Set(["0xe3ee160e", "0xcf092995", "0xef55bec6"]);

export async function auditProject(
  payToRaw: string,
  opts: { ownWallets?: string[]; tag?: string | null; maxCounterparties?: number } = {},
): Promise<AuditReport> {
  const payTo = lower(payToRaw);
  const ownList = [payTo, ...(opts.ownWallets ?? []).map(lower)];
  const own = new Set(ownList);
  const tag = opts.tag?.toLowerCase() ?? null;
  const maxCp = Math.min(200, opts.maxCounterparties ?? config().AUDIT_MAX_COUNTERPARTIES);

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

  // 1. Attribution per transaction hash. An x402 settlement is recognised by any of:
  //    the explorer's decoded method name (not always present), the transaction
  //    sender being the facilitator relayer, or an EIP-3009 function selector.
  const relayer = lower(FACILITATOR_RELAYER);
  const isX402Tx = (t: { from: string; rawInput: string | null }) =>
    t.from === relayer || X402_SELECTORS.has((t.rawInput ?? "").slice(0, 10).toLowerCase());
  const x402ByHash = new Map<string, boolean>();
  for (const t of transfers) if (/withauthorization/i.test(t.method ?? "")) x402ByHash.set(t.hash, true);
  const inputByHash = new Map<string, string | null>();
  for (const t of natives) {
    inputByHash.set(t.hash, t.rawInput);
    if (isX402Tx(t)) x402ByHash.set(t.hash, true);
  }
  const hashes = new Set<string>([...transfers.map((t) => t.hash), ...natives.map((t) => t.hash)]);
  const usdByHashAll = new Map<string, number>();
  for (const t of transfers) {
    const rate = usdFor(t.token.address, t.token.symbol, celoUsd);
    if (rate === null) continue;
    const usd = (Number(t.value) / 10 ** t.token.decimals) * rate;
    usdByHashAll.set(t.hash, Math.max(usdByHashAll.get(t.hash) ?? 0, usd));
  }
  const missing = [...hashes]
    .filter((h) => !x402ByHash.get(h) && !inputByHash.has(h))
    .sort((a, b) => (usdByHashAll.get(b) ?? 0) - (usdByHashAll.get(a) ?? 0))
    .slice(0, INPUT_FETCH_CAP);
  // Batched over JSON-RPC first; the explorer is the fallback for anything the node did not return.
  const viaRpc = await txInputs(missing).catch(() => new Map<string, { from: string; input: string } | null>());
  const stillMissing = missing.filter((h) => !viaRpc.get(h));
  const fetched = await pool(stillMissing, 4, (h) => transaction(h).catch(() => null));
  const fetchedByHash = new Map(stillMissing.map((h, i) => [h, fetched[i] ?? null]));
  for (const h of missing) {
    const r = viaRpc.get(h);
    const f = r ? { from: r.from, rawInput: r.input } : fetchedByHash.get(h) ?? null;
    inputByHash.set(h, f?.rawInput ?? null);
    if (f && isX402Tx(f)) x402ByHash.set(h, true);
  }
  const attribution = new Map<string, Attribution>();
  const otherCodes = new Set<string>();
  for (const h of hashes) {
    const input = inputByHash.get(h);
    const codes = input === undefined ? null : (decodeTag(input)?.codes ?? []);
    const a = classifyTx({ x402: Boolean(x402ByHash.get(h)), codes, tag });
    attribution.set(h, a);
    if (a === "other-tag" && codes) for (const c of codes) otherCodes.add(c);
  }
  const attributed = (h: string) => {
    const a = attribution.get(h);
    return a === "x402" || a === "tagged";
  };

  // 2. Legs, aggregated per counterparty, attributed and not.
  const aggs = new Map<string, Agg>();
  const unattributed = { hashes: new Set<string>(), usdByHash: new Map<string, number>(), counterparties: new Set<string>() };
  const touch = (cp: string, hash: string, at: string, usd: number | null, token: string, x402: boolean) => {
    if (own.has(cp) || cp === payTo) return;
    if (!attributed(hash)) {
      unattributed.hashes.add(hash);
      unattributed.counterparties.add(cp);
      if (usd !== null) unattributed.usdByHash.set(hash, Math.max(unattributed.usdByHash.get(hash) ?? 0, usd));
      return;
    }
    const a = aggs.get(cp) ?? { hashes: new Set<string>(), days: new Set<string>(), firstAt: at, lastAt: at, usdByHash: new Map<string, number>(), unpriced: new Set<string>(), tokens: new Set<string>(), x402: new Set<string>() };
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

  const stables = new Set<string>();
  let usatOverX402 = false;
  for (const t of transfers) {
    if (t.from === t.to) continue;
    const cp = t.from === payTo ? t.to : t.from;
    const rate = usdFor(t.token.address, t.token.symbol, celoUsd);
    const amount = Number(t.value) / 10 ** t.token.decimals;
    const usd = rate === null ? null : amount * rate;
    const x402 = Boolean(x402ByHash.get(t.hash));
    const stable = NAMED_STABLES[t.token.address];
    if (stable && attributed(t.hash)) stables.add(stable);
    if (x402 && stable === "USAT") usatOverX402 = true;
    touch(cp, t.hash, t.at, usd, t.token.symbol ?? t.token.address, x402);
  }
  let taggedOwnTxs = 0;
  let untaggedOwnTxs = 0;
  for (const t of natives) {
    if (t.from === payTo) {
      if (attribution.get(t.hash) === "tagged") taggedOwnTxs += 1;
      else untaggedOwnTxs += 1;
    }
    if (t.value === "0" || !t.to) continue;
    const cp = t.from === payTo ? t.to : t.from;
    const usd = celoUsd === null ? null : (Number(t.value) / 1e18) * celoUsd;
    touch(cp, t.hash, t.at, usd, "CELO", false);
  }

  // 3. Verify the counterparties that matter most.
  const ranked = [...aggs.entries()]
    .map(([address, a]) => ({ address, a, usd: [...a.usdByHash.values()].reduce((x, y) => x + y, 0) }))
    .sort((x, y) => y.usd - x.usd || y.a.hashes.size - x.a.hashes.size);
  const inspect = ranked.slice(0, maxCp);
  const verifyOnce = (address: string) => verifyWallet(address, { ownWallets: ownList });
  const verdicts = await pool(inspect, 3, (r) =>
    verifyOnce(r.address)
      .catch(() => new Promise<void>((res) => setTimeout(res, 2000)).then(() => verifyOnce(r.address)))
      .catch(() => null),
  );

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

  // 4. Metrics, the way the board computes them.
  const judged = counterparties.filter((c) => c.verdict);
  const contracts = judged.filter((c) => c.verdict!.isContract).length;
  const signers = judged.filter((c) => c.verdict!.countsAsSigner).length;
  const verified = judged.filter((c) => c.verdict!.verifiedUser);
  const returning = judged.filter((c) => c.verdict!.countsAsSigner && c.days >= 2).length;
  const verifiedReturning = verified.filter((c) => c.days >= 2).length;
  const fresh = judged.filter((c) => c.verdict!.flags.includes("fresh")).length;
  const fundedByProject = judged.filter((c) => c.verdict!.flags.includes("funded-by-project")).length;
  const contractUnknown = judged.filter((c) => c.verdict!.flags.includes("contract-unknown")).length;
  const grossUsd = counterparties.reduce((s, c) => s + c.usd, 0);
  const independentUsd = verified.reduce((s, c) => s + c.usd, 0);
  const gate = signerGate(signers);
  const attributedHashes = [...hashes].filter(attributed);
  const metrics: AuditMetrics = {
    attributedTxs: attributedHashes.length,
    x402Txs: attributedHashes.filter((h) => attribution.get(h) === "x402").length,
    taggedTxs: attributedHashes.filter((h) => attribution.get(h) === "tagged").length,
    unattributedTxs: unattributed.hashes.size,
    unattributedUsd: Number([...unattributed.usdByHash.values()].reduce((x, y) => x + y, 0).toFixed(4)),
    unattributedCounterparties: unattributed.counterparties.size,
    unknownAttributionTxs: [...hashes].filter((h) => attribution.get(h) === "unknown").length,
    otherCodesSeen: [...otherCodes],
    allCounterparties: counterparties.length,
    unverifiedCounterparties: inspect.length - judged.length,
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
    stablecoins: [...stables],
    usatOverX402,
    taggedOwnTxs,
    untaggedOwnTxs,
  };

  // 5. What would change the rank.
  const hints: string[] = [];
  if (hashes.size === 0) hints.push("No transactions inside the window yet. Nothing can rank until someone else's wallet transacts with this one.");
  if (metrics.attributedTxs === 0 && hashes.size > 0) {
    hints.push(tag
      ? `None of the ${hashes.size} transactions in the window are attributed: no calldata carries ${tag} and none is an x402 settlement. The board reads zero for this wallet.`
      : `None of the ${hashes.size} transactions in the window carry an ERC-8021 tag or are x402 settlements. Pass ?tag=celo_… to check for your code; the board reads zero without attribution.`);
  }
  if (metrics.unattributedTxs > 0) {
    hints.push(`${metrics.unattributedTxs} transactions worth about $${metrics.unattributedUsd.toFixed(2)} with ${metrics.unattributedCounterparties} counterparties are invisible to the board: no tag in the calldata and not x402 settlements. A tag cannot be added after sending.`);
  }
  if (metrics.otherCodesSeen.length > 0 && tag) hints.push(`Some transactions carry other codes (${metrics.otherCodesSeen.join(", ")}) instead of ${tag}. Only the assigned code is credited.`);
  if (metrics.unverifiedCounterparties > 0) hints.push(`${metrics.unverifiedCounterparties} of ${inspect.length} inspected counterparties could not be verified (explorer rate limit or timeout); their volume is left out of the independent total. Run the audit again in a few minutes.`);
  if (contractUnknown > 0) hints.push(`${contractUnknown} inspected counterparties could not be checked for contract status (explorer rate limit or timeout), so they are excluded from verified users, signers and the independent total. Run the audit again in a few minutes; the totals here are a lower bound.`);
  if (metrics.unknownAttributionTxs > 0) hints.push(`${metrics.unknownAttributionTxs} transactions could not be classified (calldata fetch cap of ${INPUT_FETCH_CAP} reached); they are excluded from the totals above.`);
  if (metrics.attributedTxs > 0 && verified.length === 0) hints.push("Zero verified users: none of the counterparties inspected moved a token on Celo between 29 Jun and 28 Aug. Track 2 ranks verified users first; recruit wallets that already existed.");
  if (signers > 0 && signers < 20) {
    const next = signerGate(signers + 5);
    hints.push(`Signer multiplier is ${gate.toFixed(2)} with ${signers} distinct signers (every counted payer, not only verified ones); five more would lift it to ${next.toFixed(2)} and adjusted volume from $${metrics.adjustedUsd.toFixed(2)} to $${(independentUsd * next).toFixed(2)}.`);
  }
  if (verified.length > 0 && verifiedReturning === 0) hints.push("No verified user has come back on a second UTC day. Returning users are the second ranking signal; give them a reason to return tomorrow.");
  if (fresh > 0) hints.push(`${fresh} of ${judged.length} inspected counterparties were born inside the window. They count as signers and counterparties, never as verified users.`);
  if (fundedByProject > 0) hints.push(`${fundedByProject} counterparties were first funded by your own wallets. The first-funder audit excludes them; do not count them.`);
  if (metrics.x402Txs > 0 && !usatOverX402) hints.push("You settle over x402 but not in USA₮. USA₮ settled over x402 is the highest-scoring combination for Best Stablecoin Adoption.");
  if (metrics.attributedTxs > 0 && metrics.x402Txs === 0 && stables.size === 0) hints.push("No x402 settlements and no named stablecoin (USA₮, cNGN, wFIAT) in attributed flows: not eligible for the stablecoin bounty as it stands.");
  if (tag && taggedOwnTxs === 0 && untaggedOwnTxs > 0) hints.push(`${untaggedOwnTxs} transactions sent by this wallet carry no ${tag} suffix. Only tagged transactions and facilitator settlements are attributed; there is no backfill.`);
  if (tr.capped || tx.capped) hints.push("The explorer scan was capped; volumes are a lower bound.");
  if (ranked.length > inspect.length) hints.push(`${ranked.length - inspect.length} smaller counterparties were not inspected (limit ${maxCp}; pass ?max=… up to 200).`);

  return {
    payTo,
    ownWallets: ownList,
    tag,
    window: { start: new Date(WINDOW_START).toISOString(), end: new Date(WINDOW_END).toISOString(), lookbackStart: new Date(LOOKBACK_START).toISOString() },
    scanned: { transfers: transfers.length, nativeTxs: natives.length, uniqueTxs: hashes.size, capped: tr.capped || tx.capped, counterpartiesInspected: inspect.length, counterpartiesTotal: ranked.length },
    counterparties,
    metrics,
    hints,
    generatedAt: new Date().toISOString(),
  };
}

/** The rules, as the product states them. Free, and the same text on every channel. */
export const RULES = [
  "Only Celo mainnet activity between 28 Aug 00:00 and 21 Sep 09:00 GMT counts.",
  "Attribution comes from the ERC-8021 tag in your calldata, or from x402 settlements to your registered wallet. A tag cannot be added after sending; untagged transfers are invisible to the board.",
  "A counterparty counts only if it is not one of your registered wallets, was not first funded by you or your dominant funder, and moved a token on Celo between 29 Jun and 28 Aug 00:00 (confirmed by the organisers on 12 Sep: token transfers only, that 60-day window only, and activity during the hackathon does not qualify).",
  "Track 1 (Value Moved) ranks adjusted volume: net per transaction, independent counterparties only, multiplied by least(1, distinct signers / 20). The signer count is taken across all your counted payments, not only the independent ones.",
  "Track 2 (Real World Adoption) ranks verified users first, returning users (2+ distinct UTC days) second, distinct signers and EIP-3009 authorisers third. Money moved is irrelevant.",
  "Best Stablecoin Adoption uses the same signals among projects using USA₮, cNGN or Ripio wFIAT, or settling over the x402 facilitator. USA₮ settled over x402 scores highest.",
  "Drafts on the builders portal are registered but not eligible. Publish before the deadline.",
];
