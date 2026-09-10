import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

/**
 * Generate a throwaway wallet for the end-to-end payment test: `npm run wallet:new`.
 *
 * This wallet is funded by us, so it counts as neither a user nor volume under rule A3.
 * Add it to the Evidence log in GAPS.md the moment it exists, not afterwards, and give
 * it only what the test spends. It is not a place to keep anything.
 */
const key = generatePrivateKey();
const account = privateKeyToAccount(key);

console.log(`address:     ${account.address}`);
console.log(`private key: ${key}`);
console.log("");
console.log("Next: send it ~0.20 USA\u20ae, add a row to the Evidence log in GAPS.md, then");
console.log(`  TEST_PRIVATE_KEY=${key.slice(0, 6)}\u2026 PUBLIC_URL=https://counted-gamma.vercel.app npm run buy:test -- verify 0x\u2026`);
