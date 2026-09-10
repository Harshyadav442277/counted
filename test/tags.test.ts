import { toDataSuffix } from "@celo/attribution-tags";
import { describe, expect, it } from "vitest";
import { decodeTag, judgeTag } from "../src/core/tags.js";

/**
 * Real calldata from Celo mainnet tx 0x2b8608af…a9f6 (AbaPay `payBillFor`, 9 Sep 2026):
 * the ERC-8021 suffix carries celo_9d71588659ec, schema 0, then the 8021 marker.
 */
const REAL_INPUT =
  "0x7ffa4e5b0000000000000000000000007d7b82d74bae31fc11d14217b1f2d16436bb473600000000000000000000000048065fbbe25f71c9282ddf5e1cd6d6a887483d5e00000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000e0000000000000000000000000000000000000000000000000000000000001238300000000000000000000000000000000000000000000000000000000000000036d746e0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000b303831363838313138323100000000000000000000000000000000000000000063656c6f5f396437313538383635396563110080218021802180218021802180218021";

describe("attribution tag decoding", () => {
  it("decodes the code from real tagged calldata", () => {
    const d = decodeTag(REAL_INPUT);
    expect(d?.codes).toEqual(["celo_9d71588659ec"]);
    expect(d?.schemaId).toBe(0);
  });

  it("round-trips a suffix built with the official library", () => {
    const suffix = toDataSuffix("celo_abcdef012345");
    const d = decodeTag(`0xa9059cbb${"00".repeat(64)}${suffix.slice(2)}`);
    expect(d?.codes).toEqual(["celo_abcdef012345"]);
  });

  it("returns null for untagged or empty calldata", () => {
    expect(decodeTag("0x")).toBeNull();
    expect(decodeTag(null)).toBeNull();
    expect(decodeTag(`0xa9059cbb${"00".repeat(64)}`)).toBeNull();
  });
});

describe("tag verdicts", () => {
  it("credits only the assigned code", () => {
    const d = decodeTag(REAL_INPUT);
    expect(judgeTag(d, "celo_9d71588659ec").hasExpected).toBe(true);
    expect(judgeTag(d, "CELO_9D71588659EC").hasExpected).toBe(true);
    const wrong = judgeTag(d, "celo_000000000000");
    expect(wrong.hasExpected).toBe(false);
    expect(wrong.note).toMatch(/Only the assigned code is credited/);
  });

  it("explains an untagged transaction without inventing a code", () => {
    const v = judgeTag(null, "celo_9d71588659ec");
    expect(v.codes).toEqual([]);
    expect(v.hasExpected).toBe(false);
    expect(v.note).toMatch(/cannot be added after sending/);
    expect(judgeTag(null, null).hasExpected).toBeNull();
  });
});
