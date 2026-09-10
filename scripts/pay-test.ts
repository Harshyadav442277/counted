import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { toClientEvmSigner } from "@x402/evm";
import { createPublicClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";

/**
 * Pay one of Counted's own routes from a wallet, end to end, and print the
 * settlement. Proves the pipe before anyone else is asked to pay.
 *
 *   TEST_PRIVATE_KEY=0x… PUBLIC_URL=https://… npm run buy:test -- verify 0xWallet
 *   TEST_PRIVATE_KEY=0x… PUBLIC_URL=https://… npm run buy:test -- tagcheck 0xTxHash
 *
 * Self-payments from the project's own wallets are excluded from scoring by design;
 * use a separate test wallet, and log it in the Evidence table.
 */
const [tool = "verify", subject = ""] = process.argv.slice(2);
const pk = (process.env["TEST_PRIVATE_KEY"] ?? process.env["AGENT_PRIVATE_KEY"] ?? "").replace(/^(0x)?/, "0x") as Hex;
if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) throw new Error("TEST_PRIVATE_KEY is required");
const base = (process.env["PUBLIC_URL"] ?? "http://localhost:3000").replace(/\/+$/, "");
const rpc = process.env["RPC_URL"] ?? "https://forno.celo.org";

const account = privateKeyToAccount(pk);
const publicClient = createPublicClient({ chain: celo, transport: http(rpc) });
// A local account already signs typed data; the SDK composes the signer from it.
const signer = toClientEvmSigner(account, publicClient);
const client = new x402Client().register("eip155:42220", new ExactEvmScheme(signer));
const fetchWithPay = wrapFetchWithPayment(fetch, client);

const param = tool === "tagcheck" ? "tx" : "wallet";
const url = `${base}/api/${tool}?${param}=${encodeURIComponent(subject)}`;
console.log(`payer: ${account.address}`);
console.log(`GET ${url}`);
const res = await fetchWithPay(url, { headers: { accept: "application/json" } });
console.log(`status: ${res.status}`);
const pr = res.headers.get("PAYMENT-RESPONSE");
if (pr) {
  const settlement = JSON.parse(Buffer.from(pr, "base64").toString("utf8")) as { success?: boolean; transaction?: string; payer?: string; network?: string };
  console.log(`settlement: ${JSON.stringify(settlement)}`);
  if (settlement.transaction) console.log(`https://celoscan.io/tx/${settlement.transaction}`);
}
console.log(JSON.stringify(await res.json().catch(() => null), null, 2).slice(0, 3000));
