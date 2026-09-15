import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { config, paymentsEnabled, resetConfigForTests } from "../src/config.js";
import { signChat, verifyChat } from "../src/core/ids.js";
import { Hono, type MiddlewareHandler } from "hono";

describe("signed chat tokens", () => {
  it("round-trips and rejects tampering", () => {
    const t = signChat(123456789, "salt-a");
    expect(t).toMatch(/^123456789\.[0-9a-f]{24}$/);
    expect(verifyChat(t, "salt-a")).toBe("123456789");
    expect(verifyChat(t, "salt-b")).toBeNull();
    expect(verifyChat(t.replace("123456789", "987654321"), "salt-a")).toBeNull();
    expect(verifyChat("123456789", "salt-a")).toBeNull();
    expect(verifyChat(undefined, "salt-a")).toBeNull();
    expect(verifyChat(signChat(-100200300, "s"), "s")).toBe("-100200300");
  });
});
import { paymentFromHeaders, paymentOptions, priceUsd, retryUnpaidOnFacilitatorError, routesConfig, settlementFromHeader } from "../src/core/x402.js";

const WALLET = "0x1111111111111111111111111111111111111111";

describe("x402 seller configuration", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    resetConfigForTests();
    process.env["AGENT_WALLET"] = WALLET;
    process.env["X402_API_KEY"] = "test-key-12345";
    delete process.env["PRICE_CHECK_USD"];
    delete process.env["PRICE_AUDIT_USD"];
  });
  afterEach(() => {
    process.env = { ...saved };
    resetConfigForTests();
  });

  it("offers USA₮ first, then USDC and USD₮, with their EIP-712 domains", () => {
    const opts = paymentOptions(0.05, WALLET);
    expect(opts.map((o) => o.price.extra.name)).toEqual(["Tether America USD", "USDC", "Tether USD"]);
    expect(opts.map((o) => o.price.extra.version)).toEqual(["1", "2", "1"]);
    expect(opts.every((o) => o.price.amount === "50000")).toBe(true);
    expect(opts.every((o) => o.network === "eip155:42220" && o.payTo === WALLET)).toBe(true);
  });

  it("prices checks at 5 cents and the audit at a dollar by default", () => {
    expect(priceUsd("verify")).toBe(0.05);
    expect(priceUsd("tagcheck")).toBe(0.05);
    expect(priceUsd("audit")).toBe(1);
    const routes = routesConfig() as Record<string, { accepts: Array<{ price: { amount: string } }> }>;
    expect(routes["GET /api/audit"]!.accepts[0]!.price.amount).toBe("1000000");
    expect(Object.keys(routes)).toHaveLength(6);
  });

  it("enables payments only with a wallet and a facilitator key", () => {
    expect(paymentsEnabled(config())).toBe(true);
    resetConfigForTests();
    delete process.env["X402_API_KEY"];
    expect(paymentsEnabled(config())).toBe(false);
  });
});

describe("payment header decoding", () => {
  it("reads payer, asset and amount from a v2 PAYMENT-SIGNATURE header", () => {
    const payload = {
      x402Version: 2,
      accepted: { scheme: "exact", network: "eip155:42220", asset: "0xd2ab3c9a02dbbab236bfec45d1d755df4267f771", amount: "50000", payTo: WALLET, maxTimeoutSeconds: 300, extra: {} },
      payload: { signature: "0xabc", authorization: { from: "0x2222222222222222222222222222222222222222", to: WALLET, value: "50000", validAfter: "0", validBefore: "1", nonce: "0x00" } },
    };
    const header = Buffer.from(JSON.stringify(payload)).toString("base64");
    const info = paymentFromHeaders((n) => (n === "payment-signature" ? header : undefined));
    expect(info?.payer).toBe("0x2222222222222222222222222222222222222222");
    expect(info?.assetSymbol).toBe("USA₮");
    expect(info?.amountUsd).toBeCloseTo(0.05, 6);
    expect(info?.x402Version).toBe(2);
  });

  it("returns null for a missing or malformed header", () => {
    expect(paymentFromHeaders(() => undefined)).toBeNull();
    expect(paymentFromHeaders(() => "not-base64!!")).toBeNull();
  });

  it("reads the facilitator settlement from PAYMENT-RESPONSE", () => {
    const header = Buffer.from(JSON.stringify({ success: true, transaction: "0xdeadbeef", payer: "0xABC", network: "eip155:42220" })).toString("base64");
    const s = settlementFromHeader(header);
    expect(s).toEqual({ success: true, transaction: "0xdeadbeef", payer: "0xabc", network: "eip155:42220" });
    expect(settlementFromHeader(null)).toBeNull();
  });
});

describe("facilitator start-up retry", () => {
  // A stand-in for the x402 middleware that fails its first facilitator sync, then quotes terms.
  const flaky = () => {
    let calls = 0;
    const handler: MiddlewareHandler = async (c) => (++calls === 1 ? c.json({ error: "sync failed" }, 502) : c.json({}, 402));
    return { handler, calls: () => calls };
  };
  const appWith = (mw: MiddlewareHandler) => new Hono().use("/api/*", mw).get("/api/verify", (c) => c.json({ ok: true }));

  it("asks once more when a terms request hits a start-up 502", async () => {
    const f = flaky();
    const res = await appWith(retryUnpaidOnFacilitatorError(f.handler, 0)).request("/api/verify?wallet=0x1");
    expect(res.status).toBe(402);
    expect(f.calls()).toBe(2);
  });

  it("never retries a request that carries a payment", async () => {
    const f = flaky();
    const res = await appWith(retryUnpaidOnFacilitatorError(f.handler, 0)).request("/api/verify?wallet=0x1", { headers: { "PAYMENT-SIGNATURE": "e30=" } });
    expect(res.status).toBe(502);
    expect(f.calls()).toBe(1);
  });
});
