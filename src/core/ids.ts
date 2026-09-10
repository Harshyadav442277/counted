import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

/** Identifiers are stored salted; Telegram ids and IPs never reach the ledger. */
export function hashId(kind: string, raw: string, salt: string): string {
  return createHash("sha256").update(`${salt}|${kind}|${raw}`).digest("hex").slice(0, 32);
}

export function newId(): string {
  return randomUUID();
}

export function secretsMatch(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function bearer(header: string | undefined): string | undefined {
  const m = header?.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim();
}
