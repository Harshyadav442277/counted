import { x402Client, x402HTTPClient, wrapFetchWithPayment } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { toClientEvmSigner } from "@x402/evm";
import { createPublicClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { readKey } from "./env.js";
import { NETWORK, TOKENS, tokenByAddress } from "../src/core/chain.js";

/**
 * Pay one of Counted's own routes from a wallet, end to end, and print the
 * settlement. Proves the pipe before anyone else is asked to pay.
 *
 *   TEST_PRIVATE_KEY=0x… TARGET_URL=https://… npm run buy:test -- verify 0xWallet
 *   TEST_PRIVATE_KEY=0x… TARGET_URL=https://… npm run buy:test -- tagcheck 0xTxHash
 *   npm run buy:test -- verify 0xWallet --dry-run   # sign locally, send nothing
 *
 * Self-payments from the project's own wallets are excluded from scoring by design;
 * use a separate test wallet, and log it in the Evidence table.
 *
 * Why the client is configured by hand: the x402 SDK ships a default-asset table,
 * and on Celo that table is USDC only. With the defaults a client offered USA₮, USDC
 * and USD₮ drops the two it does not know, signs a USDC authorisation from a wallet
 * that may hold none, and gets a 402 back that looks like a broken service. So the
 * accepted assets are opted in, and a policy keeps only the ones this wallet can pay.
 */
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const [tool = "verify", subject = ""] = args.filter((a) => !a.startsWith("--"));
const pk = readKey("TEST_PRIVATE_KEY", "AGENT_PRIVATE_KEY");
// TARGET_URL first, because PUBLIC_URL in a local .env says where the *dev server*
// thinks it lives, and a local run with ALLOW_UNPAID answers 200 with no payment at
// all. That is a false pass: rule B5 says nothing is proven without a mainnet hash.
const base = (process.env["TARGET_URL"] ?? process.env["PUBLIC_URL"] ?? "http://localhost:3000").replace(/\/+$/, "");
if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(base) && process.env["ALLOW_LOCAL_TARGET"] !== "yes") {
  throw new Error(
    [
      `Refusing to run the settlement test against ${base}.`,
      `  A local server can answer without settling anything, so a pass here proves nothing.`,
      `  Point it at the deployed service instead:`,
      `      PowerShell:  $env:TARGET_URL = 'https://counted-gamma.vercel.app'`,
      `  Set ALLOW_LOCAL_TARGET=yes only to exercise the plumbing, never to claim a result.`,
    ].join(String.fromCharCode(10)),
  );
}
const rpc = process.env["RPC_URL"] ?? "https://forno.celo.org";

const account = privateKeyToAccount(pk);
const publicClient = createPublicClient({ chain: celo, transport: http(rpc) });

const ACCEPTED = ["USAT", "USDC", "USDT"] as const;
const erc20 = parseAbi(["function balanceOf(address owner) view returns (uint256)"]);
const balances = new Map<string, bigint>();
for (const k of ACCEPTED) {
  const t = TOKENS[k]!;
  const raw = await publicClient.readContract({ address: t.address, abi: erc20, functionName: "balanceOf", args: [account.address] });
  balances.set(t.address.toLowerCase(), raw);
}
const human = (k: string, raw: bigint) => `${Number(raw) / 10 ** TOKENS[k]!.decimals} ${TOKENS[k]!.symbol}`;
console.log(`funds:  ${ACCEPTED.map((k) => human(k, balances.get(TOKENS[k]!.address.toLowerCase()) ?? 0n)).join(" - ")}`);
if ([...balances.values()].every((b) => b === 0n)) {
  throw new Error(
    [
      `${account.address} holds none of the assets this service accepts.`,
      `  An x402 client cannot sign a payment it has no balance for, so the request would`,
      `  come back as a 402 challenge that never gets answered, which looks like a failure`,
      `  of the service rather than an empty wallet.`,
      `  Fund it with about 0.20 of USA-T, USDC or USD-T on Celo mainnet first. From the`,
      `  agent wallet that is:`,
      `      npm run send -- ${account.address} 0.20 USAT --yes`,
    ].join(String.fromCharCode(10)),
  );
}

// A local account already signs typed data; the SDK composes the signer from it.
const signer = toClientEvmSigner(account, publicClient);
const client = new x402Client()
  .register(NETWORK, new ExactEvmScheme(signer))
  // Opt the two non-default assets in, and lift the $1 USD cap the SDK puts on
  // default assets so the $1 audit can be paid in USDC too.
  .setSpendControls({ allowedAssets: ACCEPTED.map((k) => ({ network: NETWORK, asset: TOKENS[k]!.address })), maxAmountPerPayment: false })
  // Keep only what this wallet can actually pay; the server lists USA₮ first, so a
  // wallet holding USA₮ settles the "both rails" way.
  .registerPolicy((_v, reqs) => reqs.filter((r) => (balances.get(String(r.asset).toLowerCase()) ?? 0n) >= BigInt(String(r.amount))));

const param = tool === "tagcheck" ? "tx" : "wallet";
const url = `${base}/api/${tool}?${param}=${encodeURIComponent(subject)}`;
console.log(`target: ${base}`);
console.log(`payer:  ${account.address}`);
console.log(`GET ${url}`);

if (dryRun) {
  const httpClient = new x402HTTPClient(client);
  const res = await fetch(url, { headers: { accept: "application/json" } });
  console.log(`status: ${res.status} (dry run: nothing is sent back)`);
  if (res.status !== 402) process.exit(0);
  const text = await res.text();
  const required = httpClient.getPaymentRequiredResponse((n) => res.headers.get(n), text ? JSON.parse(text) : undefined);
  console.log(`offered: ${required.accepts.map((a) => `${tokenByAddress(String(a.asset))?.symbol ?? a.asset} ${a.amount}`).join(", ")}`);
  const payload = (await client.createPaymentPayload(required)) as { accepted?: { asset?: string; amount?: string } };
  const chosen = payload.accepted;
  console.log(`would pay: ${tokenByAddress(String(chosen?.asset))?.symbol ?? chosen?.asset} ${chosen?.amount} from ${account.address}`);
  process.exit(0);
}

const fetchWithPay = wrapFetchWithPayment(fetch, client);
const res = await fetchWithPay(url, { headers: { accept: "application/json" } });
console.log(`status: ${res.status}`);
if (res.status === 402) {
  console.log("");
  console.log("No payment was made: the service asked for one and the client did not complete it.");
  console.log("A 402 here is the challenge, not a settlement. Check the balances above cover the");
  console.log("price, and that the wallet holds one of the exact assets the 402 lists.");
}
const pr = res.headers.get("PAYMENT-RESPONSE");
if (pr) {
  const settlement = JSON.parse(Buffer.from(pr, "base64").toString("utf8")) as { success?: boolean; transaction?: string; payer?: string; network?: string };
  console.log(`settlement: ${JSON.stringify(settlement)}`);
  if (settlement.transaction) console.log(`https://celoscan.io/tx/${settlement.transaction}`);
}
console.log(JSON.stringify(await res.json().catch(() => null), null, 2).slice(0, 3000));
