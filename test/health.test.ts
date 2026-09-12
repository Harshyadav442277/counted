import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The health contract, pinned because a status code is what an uptime check reads.
 * A service that is quoting and settling payments is up; an in-memory ledger or a
 * missing Dune key is degradation to report, not a reason to answer 503.
 */
const WALLET = "0x1111111111111111111111111111111111111111";

interface Health {
  ok: boolean;
  degraded: string[];
  payments: boolean;
  ledger: string;
  ledgerDurable: boolean;
}

async function health(): Promise<{ status: number; body: Health }> {
  vi.resetModules();
  const { app } = await import("../src/app.js");
  const res = await app.request("/api/health");
  return { status: res.status, body: (await res.json()) as Health };
}

describe("/api/health", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env["AGENT_WALLET"] = WALLET;
    process.env["X402_API_KEY"] = "test-key-12345";
    process.env["HASH_SALT"] = "test-salt-not-the-default";
    delete process.env["BLOB_READ_WRITE_TOKEN"];
    delete process.env["TELEGRAM_BOT_TOKEN"];
  });
  afterEach(() => {
    process.env = { ...saved };
    vi.resetModules();
  });

  it("answers 200 when payments work, and names what is degraded", async () => {
    const { status, body } = await health();
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.payments).toBe(true);
    expect(body.ledger).toBe("memory");
    expect(body.ledgerDurable).toBe(false);
    expect(body.degraded.join(" ")).toContain("BLOB_READ_WRITE_TOKEN");
    expect(body.degraded.join(" ")).toContain("no snapshot is uploaded");
  });

  it("answers 503 only when the service cannot take a payment", async () => {
    delete process.env["X402_API_KEY"];
    const { status, body } = await health();
    expect(status).toBe(503);
    expect(body.ok).toBe(false);
    expect(body.payments).toBe(false);
  });
});
