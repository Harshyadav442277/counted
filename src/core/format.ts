import type { AuditReport, TagCheck, WalletVerdict } from "./audit.js";
import { celoscanAddress, celoscanTx, short } from "./chain.js";
import { col, isEligible, type Row } from "./dune.js";

/** Telegram HTML and plain-text renderings of every result. One shape on every channel. */
export function esc(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function yn(b: boolean): string {
  return b ? "yes" : "no";
}

export function walletVerdictHtml(v: WalletVerdict): string {
  const head = v.verifiedUser
    ? "✅ <b>Counts as a verified user</b>"
    : v.countsAsSigner
      ? "🟡 <b>Counts as a signer, not as a verified user</b>"
      : "❌ <b>Does not count</b>";
  const lines = [
    head,
    `<code>${esc(v.wallet)}</code>${v.name ? ` (${esc(v.name)})` : ""}`,
    `active before 28 Aug: ${yn(v.activeBeforeWindow)}${v.lastActivityBeforeWindow ? ` (last ${esc(v.lastActivityBeforeWindow.slice(0, 10))})` : ""}`,
    `inside 60-day lookback: ${yn(v.activeInLookback)}`,
    `contract: ${v.contractKnown ? yn(v.isContract) : "unknown (explorer did not answer)"}`,
    v.firstSeen ? `first seen: ${esc(v.firstSeen.slice(0, 16))}Z` : null,
    v.firstFunder ? `first funder: <code>${esc(v.firstFunder)}</code>` : v.firstFunderResolved ? null : "first funder: not resolved (old wallet, or explorer cap)",
    v.flags.length ? `flags: ${esc(v.flags.join(", "))}` : null,
    "",
    ...v.reasons.map((r) => `• ${esc(r)}`),
    "",
    `<a href="${celoscanAddress(v.wallet)}">Celoscan</a>`,
  ];
  return lines.filter((l) => l !== null).join("\n");
}

export function walletVerdictSummary(v: WalletVerdict): string {
  return `${short(v.wallet)}: ${v.verifiedUser ? "verified user" : v.countsAsSigner ? "signer only" : "does not count"}${v.flags.length ? ` [${v.flags.join(",")}]` : ""}`;
}

export function tagCheckHtml(t: TagCheck): string {
  if (!t.found) return `❌ <b>Not found</b>\n<code>${esc(t.hash)}</code>\n${esc(t.notes.join(" "))}`;
  const head = t.tag.hasExpected === true ? "✅ <b>Tagged with your code</b>" : t.tag.codes.length ? "🟡 <b>Tagged, but not with the expected code</b>" : t.submittedByFacilitator ? "🟢 <b>x402 settlement (attributed by wallet)</b>" : "❌ <b>No attribution tag</b>";
  const lines = [
    head,
    `<code>${esc(t.hash)}</code>`,
    `at: ${esc(t.at?.slice(0, 16) ?? "?")}Z · in window: ${yn(t.inWindow)} · status: ${esc(t.status ?? "?")}`,
    `from: <code>${esc(t.from ?? "?")}</code>`,
    `to: <code>${esc(t.to ?? "?")}</code>${t.method ? ` · ${esc(t.method)}` : ""}`,
    `codes: ${t.tag.codes.length ? esc(t.tag.codes.join(", ")) : "none"}${t.tag.schemaId !== null ? ` (schema ${t.tag.schemaId})` : ""}`,
    "",
    `• ${esc(t.tag.note)}`,
    ...t.notes.map((n) => `• ${esc(n)}`),
    "",
    `<a href="${celoscanTx(t.hash)}">Celoscan</a>`,
  ];
  return lines.join("\n");
}

export function tagCheckSummary(t: TagCheck): string {
  return `${short(t.hash)}: ${t.found ? (t.tag.codes.length ? `codes ${t.tag.codes.join(",")}` : t.submittedByFacilitator ? "x402 settlement" : "no tag") : "not found"}${t.inWindow ? "" : " (outside window)"}`;
}

export function auditHtml(r: AuditReport, publicUrl?: string): string {
  const m = r.metrics;
  const lines = [
    `<b>Audit of</b> <code>${esc(r.payTo)}</code>${r.tag ? ` · tag <code>${esc(r.tag)}</code>` : ""}`,
    `window ${r.window.start.slice(0, 10)} → ${r.window.end.slice(0, 16)}Z`,
    `scanned ${r.scanned.uniqueTxs} txs (${r.scanned.transfers} token transfers, ${r.scanned.nativeTxs} native)${r.scanned.capped ? " (capped)" : ""}; inspected ${r.scanned.counterpartiesInspected}/${r.scanned.counterpartiesTotal} counterparties`,
    "",
    `<b>Attribution</b>`,
    `attributed: <b>${m.attributedTxs}</b> (${m.x402Txs} x402 settlements, ${m.taggedTxs} tagged) · invisible to the board: ${m.unattributedTxs} txs, $${m.unattributedUsd.toFixed(2)}${m.unknownAttributionTxs ? ` · unclassified: ${m.unknownAttributionTxs}` : ""}`,
    "",
    `<b>Track 2 signals</b>`,
    `verified users: <b>${m.verifiedUsers}</b> · returning (2+ days): <b>${m.returning}</b> · verified &amp; returning: <b>${m.verifiedReturning}</b>`,
    `signers/authorisers: ${m.signers} · all counterparties: ${m.allCounterparties} · contracts: ${m.contracts} · fresh wallets: ${m.fresh} · funded by you: ${m.fundedByProject}${m.unverifiedCounterparties ? ` · <b>not verified: ${m.unverifiedCounterparties}</b>` : ""}`,
    "",
    `<b>Track 1 signals</b>`,
    `gross: $${m.grossUsd.toFixed(2)} · independent: $${m.independentUsd.toFixed(2)} · signer gate: ${m.signerGate.toFixed(2)} (${m.verifiedSigners}/20) · <b>adjusted: $${m.adjustedUsd.toFixed(2)}</b>`,
    "",
    `<b>Stablecoin bounty</b>`,
    `x402 settlements: ${m.x402Txs} · named stablecoins: ${m.stablecoins.length ? esc(m.stablecoins.join(", ")) : "none"} · USA₮ over x402: ${yn(m.usatOverX402)}`,
    `your own txs tagged: ${m.taggedOwnTxs} · untagged: ${m.untaggedOwnTxs}`,
    "",
    `<b>What would change your rank</b>`,
    ...r.hints.map((h) => `• ${esc(h)}`),
  ];
  const top = r.counterparties.slice(0, 8);
  if (top.length) {
    lines.push("", "<b>Top counterparties</b>");
    for (const c of top) {
      const v = c.verdict;
      const mark = !v ? "·" : v.verifiedUser ? "✅" : v.countsAsSigner ? "🟡" : "❌";
      lines.push(`${mark} <code>${esc(short(c.address))}</code> $${c.usd.toFixed(2)} · ${c.txs} tx · ${c.days} day${c.days === 1 ? "" : "s"}${v?.flags.length ? ` · ${esc(v.flags.join(","))}` : ""}`);
    }
  }
  if (publicUrl) lines.push("", `Full JSON: ${esc(publicUrl)}/api/audit?wallet=${esc(r.payTo)} (paid)`);
  return lines.join("\n");
}

export function auditSummary(r: AuditReport): string {
  const m = r.metrics;
  return `${short(r.payTo)}: ${m.verifiedUsers} verified, ${m.returning} returning, ${m.signers} signers, $${m.adjustedUsd.toFixed(2)} adjusted`;
}

function num(v: unknown): string {
  if (v === null || v === undefined || v === "") return "0";
  const n = Number(v);
  return Number.isFinite(n) ? (Number.isInteger(n) ? String(n) : n.toFixed(2)) : String(v);
}

export function standingHtml(tag: string, tracks: Array<{ title: string; row: Row | undefined; rows: Row[]; executedAt: string | null; source?: "dune" | "snapshot" }>): string {
  const lines = [`<b>Standing for</b> <code>${esc(tag)}</code>`];
  for (const t of tracks) {
    const when = t.executedAt ? ` <i>(${t.source === "snapshot" ? "board snapshot" : "query run"} ${esc(t.executedAt.slice(0, 16))}Z)</i>` : "";
    lines.push("", `<b>${esc(t.title)}</b>${when}`);
    if (!t.row) {
      lines.push("not on this board yet: no attributed activity, or the wallet/tag is not on your registration");
    } else {
      const project = String(col(t.row, "project") ?? "");
      const elig = String(col(t.row, "eligible") ?? "");
      const skip = new Set(["attribution tag", "project", "app", "eligible"]);
      const cells = Object.entries(t.row)
        .filter(([k]) => !skip.has(k.toLowerCase()))
        .map(([k, v]) => `${esc(k)}: <b>${esc(num(v))}</b>`);
      lines.push(`${esc(project)} · ${/^yes$/i.test(elig) ? "eligible" : "⚠️ " + esc(elig)}`, cells.join(" · "));
      const eligible = t.rows.filter(isEligible);
      const pos = eligible.findIndex((r) => r === t.row);
      if (pos >= 0) lines.push(`position among eligible: ${pos + 1} of ${eligible.length}`);
    }
    const leaders = t.rows.filter(isEligible).slice(0, 3).map((r) => esc(String(col(r, "project") ?? "?")));
    if (leaders.length) lines.push(`eligible leaders: ${leaders.join(", ")}`);
  }
  lines.push("", "Board: https://dune.com/celo/agents-at-work-hackathon");
  return lines.join("\n");
}

export function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}
