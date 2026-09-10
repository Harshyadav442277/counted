import type { Hex } from "viem";

/**
 * "It is required" is the least useful thing a script can say about a variable the
 * caller believes they set. Name the actual failure instead, without echoing the key.
 * Accepts the key with or without the 0x prefix, and strips quotes a shell left behind.
 */
export function readKey(...names: string[]): Hex {
  const found = names.find((n) => process.env[n] !== undefined);
  if (!found) {
    const primary = names[0]!;
    throw new Error(
      `${names.join(" or ")} is not set in this shell.\n` +
        `  PowerShell:  $env:${primary} = '0x…'\n` +
        `  Bash:        export ${primary}=0x…\n` +
        `  A variable set in another window does not carry over, and PowerShell does\n` +
        `  not accept NAME=value in front of a command the way Bash does.`,
    );
  }
  const trimmed = process.env[found]!.trim().replace(/^['"]|['"]$/g, "");
  const key = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
  if (/[^0-9a-fA-Fx]/.test(key)) {
    throw new Error(`${found} is set but is not hexadecimal (${key.length} chars). Did a placeholder get pasted instead of the key?`);
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error(`${found} is set but is ${key.length} characters; a private key is 66 with the 0x prefix, 64 without.`);
  }
  return key as Hex;
}
