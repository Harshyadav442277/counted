import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

/**
 * A Telegram chat id travels through the pay page as a signed token, so a result can
 * only be posted into the chat that asked for it. Nobody can point a paid result at
 * someone else's chat by editing a URL.
 */
export function signChat(chatId: string | number, salt: string): string {
  const id = String(chatId);
  return `${id}.${createHmac("sha256", salt).update(`chat|${id}`).digest("hex").slice(0, 24)}`;
}

export function verifyChat(token: string | undefined, salt: string): string | null {
  const m = token?.match(/^(-?\d{3,20})\.([0-9a-f]{24})$/);
  if (!m) return null;
  const expected = signChat(m[1]!, salt).split(".")[1]!;
  return secretsMatch(m[2], expected) ? m[1]! : null;
}

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
