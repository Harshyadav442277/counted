import { toDataSuffix, verifyTx } from "@celo/attribution-tags";
import { createPublicClient, createWalletClient, decodeEventLog, http, parseAbi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";

/**
 * Mint the ERC-8004 agent identity on Celo mainnet, paying gas in USA₮ through fee
 * abstraction and tagging the transaction with the assigned attribution code.
 *
 *   AGENT_PRIVATE_KEY=0x… ATTRIBUTION_TAG=celo_… npm run register:8004
 *
 * Optional: AGENT_URI (defaults to the raw agent.json in this repo), FEE_CURRENCY
 * (adapter address; "none" pays gas in CELO), RPC_URL.
 */
const IDENTITY: Address = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";
const USAT_ADAPTER: Address = "0x0357EE22278c922e1D36cFe6b899269b161880C4";
const abi = parseAbi([
  "function register(string agentURI) returns (uint256)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
]);

function env(name: string, fallback?: string): string {
  const v = process.env[name]?.trim();
  if (v) return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`${name} is required`);
}

const pk = env("AGENT_PRIVATE_KEY").replace(/^(0x)?/, "0x") as Hex;
const tag = env("ATTRIBUTION_TAG", "");
const uri = env("AGENT_URI", "https://raw.githubusercontent.com/Harshyadav442277/counted/main/public/agent.json");
const feeCurrencyRaw = env("FEE_CURRENCY", USAT_ADAPTER);
const feeCurrency = feeCurrencyRaw.toLowerCase() === "none" ? undefined : (feeCurrencyRaw as Address);
const rpc = env("RPC_URL", "https://forno.celo.org");

const account = privateKeyToAccount(pk);
const publicClient = createPublicClient({ chain: celo, transport: http(rpc) });
const wallet = createWalletClient({ account, chain: celo, transport: http(rpc) });

console.log(`owner: ${account.address}`);
console.log(`agentURI: ${uri}`);
console.log(`tag: ${tag || "(none: set ATTRIBUTION_TAG so this mint is attributed)"}`);
console.log(`gas in: ${feeCurrency ? `fee currency ${feeCurrency}` : "CELO"}`);

const dataSuffix = tag ? (toDataSuffix(tag) as Hex) : undefined;
const { request } = await publicClient.simulateContract({
  account,
  address: IDENTITY,
  abi,
  functionName: "register",
  args: [uri],
  ...(dataSuffix ? { dataSuffix } : {}),
  ...(feeCurrency ? { feeCurrency } : {}),
});
const hash = await wallet.writeContract(request);
console.log(`sent: https://celoscan.io/tx/${hash}`);
const receipt = await publicClient.waitForTransactionReceipt({ hash });
console.log(`status: ${receipt.status} · block ${receipt.blockNumber}`);

let agentId: bigint | null = null;
for (const log of receipt.logs) {
  if (log.address.toLowerCase() !== IDENTITY.toLowerCase()) continue;
  try {
    const ev = decodeEventLog({ abi, data: log.data, topics: log.topics });
    if (ev.eventName === "Registered") agentId = ev.args.agentId;
    if (ev.eventName === "Transfer" && agentId === null) agentId = ev.args.tokenId;
  } catch {
    /* other events */
  }
}
if (agentId === null) throw new Error("no Registered/Transfer event found; check the receipt on Celoscan");
console.log(`\nERC-8004 Agent ID: ${agentId}`);
console.log(`8004scan: https://8004scan.io/agents/celo/${agentId}`);
console.log(`Celoscan NFT: https://celoscan.io/nft/${IDENTITY.toLowerCase()}/${agentId}`);
console.log(`Agent identifier: eip155:42220:${IDENTITY}#${agentId}`);

if (tag) {
  const decoded = await verifyTx({ client: publicClient, hash });
  console.log(`tag check: ${decoded ? decoded.codes.join(", ") : "NO TAG FOUND"} ${decoded?.codes.includes(tag) ? "✓" : "✗"}`);
}
console.log("\nNext: add the registrations[] entry to public/agent.json, commit, and paste the 8004scan URL into the celobuilders.xyz registration.");
