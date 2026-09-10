import { describe, expect, it } from "vitest";
import { signerGate, RULES } from "../src/core/audit.js";
import { LOOKBACK_START, WINDOW_END, WINDOW_START, WINDOW_START_BLOCK, usdFor } from "../src/core/chain.js";

describe("signer gate", () => {
  it("matches the four points read off the live board", () => {
    // AbaPay 95 signers → 1.00, Deputy 9 → 0.45, BASTET/Encode 2 → 0.10, none → 0.
    expect(signerGate(95)).toBe(1);
    expect(signerGate(9)).toBeCloseTo(0.45, 5);
    expect(signerGate(2)).toBeCloseTo(0.1, 5);
    expect(signerGate(0)).toBe(0);
    expect(signerGate(20)).toBe(1);
    expect(signerGate(200)).toBe(1);
  });
});

describe("window constants", () => {
  it("covers 28 Aug 00:00 to 14 Sep 09:00 GMT with a 60-day lookback", () => {
    expect(new Date(WINDOW_START).toISOString()).toBe("2026-08-28T00:00:00.000Z");
    expect(new Date(WINDOW_END).toISOString()).toBe("2026-09-14T09:00:00.000Z");
    expect(new Date(LOOKBACK_START).toISOString()).toBe("2026-06-29T00:00:00.000Z");
    // One block per second on Celo: the cutoff block is a day after the measured 27 Aug block.
    expect(WINDOW_START_BLOCK).toBe(75_888_042 + 86_400);
  });
});

describe("usd pricing", () => {
  it("prices the three facilitator stablecoins and USA₮ at one dollar", () => {
    expect(usdFor("0xcEBA9300f2b948710d2653dD7B07f33A8B32118C", "USDC", null)).toBe(1);
    expect(usdFor("0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e", "USD₮", null)).toBe(1);
    expect(usdFor("0xd2ab3c9a02dbbab236bfec45d1d755df4267f771", "USAT", null)).toBe(1);
  });
  it("prices CELO from the explorer rate and unknown tokens as unpriced", () => {
    expect(usdFor("0x471EcE3750Da237f93B8E339c536989b8978a438", "CELO", 0.0753)).toBe(0.0753);
    expect(usdFor("0x471EcE3750Da237f93B8E339c536989b8978a438", "CELO", null)).toBeNull();
    expect(usdFor("0x1111111111111111111111111111111111111111", "WOOF", 1)).toBeNull();
  });
});

describe("rules text", () => {
  it("states the three things that decide the audit", () => {
    const all = RULES.join(" ");
    expect(all).toMatch(/before 28 Aug/);
    expect(all).toMatch(/first funded/);
    expect(all).toMatch(/USA₮ settled over x402/);
  });
});
