# Counted

**Does your Celo activity actually count?** Counted runs the Agents at Work
leaderboard's own audit on any wallet, transaction or project, and settles each check
in USA₮ (or USDC / USD₮) over x402 on Celo mainnet.

Built for the [Celo Agents at Work Hackathon](https://celoplatform.notion.site/Agents-at-Work-Hackathon-3c1d5cb803de81139de7f4f3d09e55dc)
(28 Aug – 21 Sep 2026). **Provenance:** this repo is a port of our open-source
x402 + MCP + Telegram rail from [telegraph-morse](https://github.com/Harshyadav442277/telegraph-morse)
(Telegraph Hackathon, Sep 2026). The Celo work, the audit engine, the seller side of
x402, fee abstraction and the pay page are the commits in this repository.

## The problem it solves

The published scoring queries only count counterparties that are **independent**
(not your wallets, not first funded by you) and that **existed on Celo before
28 August**. Fresh wallets you onboard count as signers, never as verified users.
None of that is visible on a block explorer, so builders guess and lose prizes to a
wiring mistake. Counted reproduces the audit from public explorer data:

| Check | What it answers | Price |
|---|---|---|
| `verify` | Does this wallet count as a verified user? Pre-28-Aug history, 60-day lookback, first funder, contract, own-wallet flags, with reasons. | $0.05 |
| `tagcheck` | Is the assigned ERC-8021 attribution tag in this transaction, and is it inside the counting window? | $0.05 |
| `audit` | Full pre-submission audit of a payTo wallet: every counterparty classified, verified and returning users, signer gate, adjusted volume, stablecoin and x402 flags, and what would change your rank. | $1.00 |
| `standing` | Your live row on the three published Dune queries, with position among eligible projects. | free |
| `rules` | The scoring rules in plain words. | free |

The organisers' Dune queries are the only authority. This is the same test, run early
enough to act on.

## Three ways to pay

1. **Agents with `@celo/buy`** (gas sponsored, no CELO needed):
   ```bash
   npx --yes @celo/buy@0.5.0 curl --max-amount 0.05 --token USDT "https://counted-gamma.vercel.app/api/verify?wallet=0xYOURWALLET"
   ```
2. **Any x402 v2 client**: `GET /api/verify?wallet=0x…`, `GET /api/tagcheck?tx=0x…`,
   `GET /api/audit?wallet=0x…&tag=celo_…`. The 402 lists USA₮, USDC and USD₮ on
   `eip155:42220`; the facilitator is `https://api.x402.celo.org`.
3. **A browser wallet**: open `/pay?tool=verify&subject=0x…`. MetaMask or Rabby signs an
   EIP-3009 authorisation; the facilitator settles it. USA₮ is the default asset.

Pay from the wallet you used before 28 August: that is the one that counts as a
verified user, for you and for us. Need USA₮? Verify once in the
[Self app](https://self.xyz) and claim from the
[Google Cloud faucet](https://cloud.google.com/application/web3/faucet/celo/mainnet).

## Telegram and MCP

- Telegram: `/standing celo_…` is free; `/verify`, `/tagcheck` and `/audit` hand out a
  pay link and post the result back into the chat once the facilitator settles.
- MCP (Streamable HTTP): `claude mcp add --transport http counted https://counted-gamma.vercel.app/mcp`.
  Tools: `counted_rules`, `counted_standing`, `counted_how_to_pay` (free);
  `counted_verify`, `counted_tagcheck`, `counted_audit` (paid; pass `payment`, a base64
  x402 v2 PaymentPayload, or receive the 402 terms and a `buy` one-liner).

## Run it

```bash
npm install
cp .env.example .env      # AGENT_WALLET + X402_API_KEY enable payments
npm run dev               # http://localhost:3000
npm test                  # unit tests
npm run typecheck
```

Deploy: Vercel, framework "Other". `vercel.json` routes everything to `api/index.ts`.
Set the `.env.example` names in the project settings, then
`POST /admin/telegram/webhook` with `Authorization: Bearer $ADMIN_TOKEN` once.

## Scripts (the only places a private key is used)

| Script | What it does |
|---|---|
| `npm run register:8004` | Mints the ERC-8004 agent identity on Celo mainnet, gas paid in USA₮ via fee abstraction, calldata tagged with `ATTRIBUTION_TAG`. Prints the Agent ID and the 8004scan URL. |
| `npm run tag:verify -- 0xTX` | Decodes the ERC-8021 suffix on a transaction. |
| `npm run buy:test -- verify 0xWALLET` | Pays one of our own routes from a test wallet with an x402 client and prints the settlement. |

## How the audit works

- **Pre-existing history**: the explorer is asked for the wallet's newest token
  transfer and transaction before block 75,974,442 (28 Aug 00:00 UTC). Anything inside
  the 60 days before that makes the wallet verified; older activity is reported but
  flagged.
- **First funder**: for wallets born inside the window, the earliest inbound transfer;
  for old wallets, the earliest transaction via Celoscan when a key is configured.
- **Own wallets and contracts**: a project's own wallets are never its users; contracts
  are not users.
- **Signer gate**: adjusted volume = independent volume × min(1, verified signers / 20),
  which fits every point on the live board (95 → 1.00, 9 → 0.45, 2 → 0.10).
- **Track 2 signals**: verified users, returning users (2+ distinct UTC days), distinct
  signers and EIP-3009 authorisers.
- **Stablecoin bounty**: named stablecoins (USA₮, cNGN, wFIAT) and x402 settlements,
  with the USA₮-over-x402 "both rails" flag.

Sources: the [live board and its SQL](https://dune.com/celo/agents-at-work-hackathon),
the [portal rules](https://celobuilders.xyz/hackathons/agents-at-work/rules).

## Evidence

Every call is in the public ledger (`/ledger`, `/api/ledger`) with the payer, the asset
and the settlement hash. The ledger lives in Neon Postgres (`DATABASE_URL`) or, as
deployed, in a Vercel Blob store (`BLOB_READ_WRITE_TOKEN`), one immutable object per
call, so nothing is lost on a cold start. Nothing is mocked; self-payments from the project's own
wallets are excluded from scoring by design and are labelled as tests.

## Licence

MIT.
