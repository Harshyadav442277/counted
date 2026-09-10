import type { Hex } from "viem";

/**
 * "It is required" is the least useful thing a script can say about a variable the
 * caller believes they set. Name the actual failure instead, and never echo the key.
 * Accepts the key with or without the 0x prefix, and strips quotes a shell left behind.
 */
export function readKey(...names: string[]): Hex {
  const found = names.find((n) => process.env[n] !== undefined);
  if (!found) {
    const primary = names[0]!;
    throw new Error(
      [
        `${names.join(" or ")} is not set.`,
        `  Easiest, once: add a line to counted/.env, which these scripts read and git ignores.`,
        `      ${primary}=0x<64 hex characters>`,
        `  Or for a single command:`,
        `      PowerShell:  $env:${primary} = '0x...'`,
        `      Bash:        export ${primary}=0x...`,
        `  A variable set in another window does not carry over, and PowerShell does not`,
        `  accept NAME=value in front of a command the way Bash does.`,
      ].join("\n"),
    );
  }
  const trimmed = process.env[found]!.trim().replace(/^['"]|['"]$/g, "");
  const key = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
  if (/[^0-9a-fA-Fx]/.test(key)) {
    throw new Error(
      [
        `${found} is set but is not hexadecimal (${key.length} characters).`,
        `  A private key is 0x followed by 64 characters, each of them 0-9 or a-f.`,
        `  Yours contains something else, so a placeholder or a line of instructions was`,
        `  pasted where the key should be. Paste the key itself, with nothing around it.`,
      ].join("\n"),
    );
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error(
      [
        `${found} is set but is ${key.length} characters.`,
        `  A private key is 66 with the 0x prefix, or 64 without it.`,
        `  A wallet address is 42 and will not work here.`,
      ].join("\n"),
    );
  }
  return key as Hex;
}
