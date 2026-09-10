import { verifyTx } from "@celo/attribution-tags";
import { createPublicClient, http, type Hex } from "viem";
import { celo } from "viem/chains";

/** Decode the ERC-8021 suffix on a Celo mainnet transaction: `npm run tag:verify -- 0x…` */
const hash = process.argv[2] as Hex | undefined;
if (!hash || !/^0x[0-9a-fA-F]{64}$/.test(hash)) {
  console.error("usage: npm run tag:verify -- <txHash>");
  process.exit(2);
}
const client = createPublicClient({ chain: celo, transport: http(process.env["RPC_URL"] ?? "https://forno.celo.org") });
const decoded = await verifyTx({ client, hash });
if (!decoded) {
  console.log("no ERC-8021 suffix on this transaction");
  process.exit(1);
}
console.log(JSON.stringify(decoded, null, 2));
const expected = process.env["ATTRIBUTION_TAG"];
if (expected) console.log(decoded.codes.includes(expected) ? `✓ contains ${expected}` : `✗ does not contain ${expected}`);
