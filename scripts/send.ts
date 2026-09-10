import { toDataSuffix, verifyTx } from "@celo/attribution-tags";
import { createPublicClient, createWalletClient, formatUnits, http, parseAbi, parseUnits, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { readKey } from "./env.js";
import { TOKENS } from "../src/core/chain.js";

/**
 * Move a stablecoin out of the agent wallet while paying gas in that same stablecoin,
 * so a wallet holding no CELO can still transact. Same fee-abstraction path the
 * ERC-8004 mint used.
 *
 *   AGENT_PRIVATE_KEY=0x… npm run send -- 0xRecipient 0.20 USAT --yes
 *
 * Optional: ATTRIBUTION_TAG (adds the ERC-8021 suffix), FEE_CURRENCY ("none" pays gas
 * in CELO), RPC_URL. Without --yes it prints the plan and sends nothing.
 *
 * Anything this funds is a wallet we funded: it counts as neither a user nor volume
 * under rule A3, and it gets a row in the Evidence log in GAPS.md when it is created.
 */
const erc20 = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
]);

const [toRaw = "", amountRaw = "", symbolRaw = "USAT", ...flags] = process.argv.slice(2);
const confirmed = flags.includes("--yes") || process.env["SEND_CONFIRM"] === "yes";

const token = TOKENS[symbolRaw.toUpperCase()];
if (!token) throw new Error(`unknown token ${symbolRaw}; try ${Object.keys(TOKENS).join(", ")}`);
if (!/^0x[0-9a-fA-F]{40}$/.test(toRaw)) throw new Error("usage: npm run send -- 0xRecipient <amount> [TOKEN] --yes");
if (!/^\d+(\.\d+)?$/.test(amountRaw)) throw new Error("amount must be a plain decimal, e.g. 0.20");

const pk = readKey("AGENT_PRIVATE_KEY");
const tag = process.env["ATTRIBUTION_TAG"]?.trim() ?? "";
const feeRaw = process.env["FEE_CURRENCY"]?.trim() ?? token.feeCurrencyAdapter ?? "none";
const feeCurrency = feeRaw.toLowerCase() === "none" ? undefined : (feeRaw as Address);

const account = privateKeyToAccount(pk);
const to = toRaw as Address;
const amount = parseUnits(amountRaw, token.decimals);
const rpc = process.env["RPC_URL"] ?? "https://forno.celo.org";
const publicClient = createPublicClient({ chain: celo, transport: http(rpc) });
const wallet = createWalletClient({ account, chain: celo, transport: http(rpc) });

const balance = await publicClient.readContract({ address: token.address, abi: erc20, functionName: "balanceOf", args: [account.address] });
console.log(`from:    ${account.address}`);
console.log(`to:      ${to}`);
console.log(`amount:  ${amountRaw} ${token.symbol}  (balance ${formatUnits(balance, token.decimals)})`);
console.log(`gas in:  ${feeCurrency ? `${token.symbol} via adapter ${feeCurrency}` : "CELO"}`);
console.log(`tag:     ${tag || "(none: set ATTRIBUTION_TAG to attribute this transfer)"}`);
if (balance < amount) throw new Error(`insufficient ${token.symbol}: have ${formatUnits(balance, token.decimals)}, sending ${amountRaw}`);
if (!confirmed) {
  console.log("\nDry run. Nothing sent. Re-run with --yes to send it.");
  process.exit(0);
}

const dataSuffix = tag ? (toDataSuffix(tag) as Hex) : undefined;
const { request } = await publicClient.simulateContract({
  account,
  address: token.address,
  abi: erc20,
  functionName: "transfer",
  args: [to, amount],
  ...(dataSuffix ? { dataSuffix } : {}),
  ...(feeCurrency ? { feeCurrency } : {}),
});
const hash = await wallet.writeContract(request);
console.log(`\nsent: https://celoscan.io/tx/${hash}`);
const receipt = await publicClient.waitForTransactionReceipt({ hash });
console.log(`status: ${receipt.status} · block ${receipt.blockNumber} · gas used ${receipt.gasUsed}`);

if (tag) {
  const decoded = await verifyTx({ client: publicClient, hash });
  const ok = decoded?.codes.includes(tag);
  console.log(`tag check: ${decoded ? decoded.codes.join(", ") : "NO TAG FOUND"} ${ok ? "\u2713" : "\u2717"}`);
}
