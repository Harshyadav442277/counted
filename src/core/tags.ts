import { fromDataSuffix, toDataSuffix, type DecodedSuffix } from "@celo/attribution-tags";
import type { Hex } from "viem";
import { config } from "../config.js";

/**
 * ERC-8021 attribution tags. Celo credits a hackathon project only for transactions
 * whose calldata ends with the assigned `celo_…` code; there is no backfill.
 */
export function decodeTag(input: string | null | undefined): DecodedSuffix | null {
  if (!input || input === "0x" || input.length < 40) return null;
  try {
    return fromDataSuffix(input as Hex);
  } catch {
    return null;
  }
}

/** The suffix to append to every transaction this project sends itself. */
export function ourDataSuffix(): Hex | undefined {
  const tag = config().ATTRIBUTION_TAG;
  return tag ? (toDataSuffix(tag) as Hex) : undefined;
}

export interface TagVerdict {
  codes: string[];
  schemaId: number | null;
  /** True when the code the caller expected is present. Null when none was expected. */
  hasExpected: boolean | null;
  expected: string | null;
  note: string;
}

export function judgeTag(decoded: DecodedSuffix | null, expected: string | null): TagVerdict {
  const exp = expected?.trim().toLowerCase() ?? null;
  if (!decoded) {
    return {
      codes: [],
      schemaId: null,
      hasExpected: exp ? false : null,
      expected: exp,
      note: "No ERC-8021 suffix in the calldata. This transaction is not attributed to any project. A tag cannot be added after sending.",
    };
  }
  const has = exp ? decoded.codes.map((c) => c.toLowerCase()).includes(exp) : null;
  const note = has === false
    ? `Tagged, but with ${decoded.codes.join(", ")} rather than ${exp}. Only the assigned code is credited.`
    : has
      ? `Tagged with the assigned code. This transaction is attributed to ${exp}.`
      : `Tagged with ${decoded.codes.join(", ")}.`;
  return { codes: decoded.codes, schemaId: decoded.schemaId, hasExpected: has, expected: exp, note };
}
