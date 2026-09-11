import { describe, expect, it } from "vitest";
import { BlobLedger, type BlobClient } from "../src/core/ledger/blob.js";
import type { CallRow } from "../src/core/ledger/types.js";

/**
 * The Blob ledger against a fake store: every row is its own object, a cold start
 * reads them all back in time order, and a duplicate id is written once.
 */
function row(id: string, at: string, paid = false, payer: string | null = null): CallRow {
  return { id, at, channel: "api", tool: "verify", subject: "0xabc", paid, payer, asset: paid ? "USA₮" : null, amountUsd: paid ? 0.05 : null, settlementTx: paid ? id : null, status: "ok", summary: "ok", durationMs: 10 };
}

function fakeStore(initial: CallRow[] = []) {
  const objects = new Map<string, string>();
  for (const r of initial) objects.set(BlobLedger.pathFor(r), JSON.stringify(r));
  const client: BlobClient = {
    put: (async (pathname: string, body: string) => {
      if (objects.has(pathname)) throw new Error("exists");
      objects.set(pathname, body);
      return { url: `https://store/${pathname}`, downloadUrl: "", pathname, contentType: "application/json", contentDisposition: "" };
    }) as unknown as BlobClient["put"],
    list: (async () => ({
      blobs: [...objects.keys()].sort().reverse().map((pathname) => ({ url: `https://store/${pathname}`, downloadUrl: "", pathname, size: 1, uploadedAt: new Date() })),
      cursor: undefined,
      hasMore: false,
    })) as unknown as BlobClient["list"],
    fetch: (async (url: string) => {
      const body = objects.get(String(url).replace("https://store/", ""));
      return new Response(body ?? "", { status: body ? 200 : 404 });
    }) as unknown as typeof fetch,
  };
  return { client, objects };
}

describe("blob ledger", () => {
  it("reads rows back in time order after a cold start", async () => {
    const seeded = [row("b", "2026-09-12T10:00:00.000Z", true, "0xp1"), row("a", "2026-09-11T09:00:00.000Z", true, "0xp1"), row("c", "2026-09-12T11:00:00.000Z")];
    const { client } = fakeStore(seeded);
    const ledger = new BlobLedger(client);
    await ledger.init();
    expect((await ledger.recent(10)).map((r) => r.id)).toEqual(["c", "b", "a"]);
    const stats = await ledger.stats();
    expect(stats.calls).toBe(3);
    expect(stats.paidCalls).toBe(2);
    expect(stats.payers).toBe(1);
    expect(await ledger.payers()).toEqual([{ payer: "0xp1", days: 2, calls: 2, firstAt: "2026-09-11T09:00:00.000Z" }]);
  });

  it("writes one object per call and never the same id twice", async () => {
    const { client, objects } = fakeStore();
    const ledger = new BlobLedger(client);
    const r = row("0xhash", "2026-09-11T12:00:00.000Z", true, "0xp2");
    await ledger.record(r);
    await ledger.record(r);
    expect(objects.size).toBe(1);
    expect([...objects.keys()][0]).toBe("calls/2026-09-11T12-00-00-000Z-0xhash.json");
    expect((await ledger.recent(5))[0]?.settlementTx).toBe("0xhash");
  });

  it("survives an unreadable object", async () => {
    const { client, objects } = fakeStore([row("ok", "2026-09-11T12:00:00.000Z")]);
    objects.set("calls/2026-09-11T13-00-00-000Z-junk.json", "not json");
    const ledger = new BlobLedger(client);
    expect((await ledger.stats()).calls).toBe(1);
  });
});
