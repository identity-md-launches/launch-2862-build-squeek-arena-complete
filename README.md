# SQUEEK ARENA

Pick your hamster. Place your SQK. Win the race.

A three-hamster racing and betting dapp on Ethereum Sepolia (chain ID 11155111). Brown, White and Golden race in 5-minute rounds and players bet Squeek (SQK). The `SqueekArena` contract holds every bet in escrow, derives the race from a future block hash, and pays the whole pool to the winner's backers. It has no owner and charges no fee.

## Status: what works, what is still to do

- **Token verified.** `0x6872bfa5ccc3e9e440c6c16e5ffdabb8dba4cc76` on Sepolia returns name `Squeek`, symbol `SQK`, decimals `18` (read with `eth_call`). SqueekChain's docs (`docs.squeekchain.com/developers/token/`) list this address as the immutable Sepolia SqueekToken, a standard ERC-20 with permit. No other token is used and none was created.
- **Contract built and tested.** 14 Foundry unit tests pass. A fork test also passed against the **real SQK token** on a local anvil fork of Sepolia: deploy through the deterministic factory, approve, bet, lock, settle, claim, then a second claim that reverts.
- **Contract NOT deployed on Sepolia yet.** This machine has no funded Sepolia account, and the job did not get a deployer key (this repo will never ask for one). The address is still fixed: `SqueekArena` deploys through Arachnid's deterministic deployment proxy (`0x4e59b44847b379578588920ca78fbf26c0b4956c`, which exists on Sepolia), so its address is set by the committed init code and salt alone:
  **`0x7b323e55617e7f7a7a41e5172d70ad25f462c329`**.
  Until code is at that address, the site says so and offers a **Deploy the arena contract** button. Anyone with Sepolia ETH can deploy from a connected wallet, and the deployer gets no special rights. You can also deploy from a terminal:
  ```sh
  cast send --rpc-url https://ethereum-sepolia-rpc.publicnode.com --account <your-keystore> \
    0x4e59b44847b379578588920ca78fbf26c0b4956c \
    "$(node -e "const a=require('./src/contract/arena.json');console.log(a.salt+a.initCode.slice(2))")"
  ```
- **Live Sepolia transactions not run.** For the same reason, no real Sepolia transaction hashes exist yet. Wallet transaction flows were checked by typecheck and the fork test only. No browser wallet was driven against a live chain.
- **Hosting.** Publishing is handled outside this repo: the committed `dist/` is the static export.

## How a round works

1. **Betting (5 minutes).** `bet(hamster, amount)` pulls SQK with `transferFrom`, after an exact-amount `approve`. Round `n` takes bets from `genesis + n*300` until `genesis + (n+1)*300`. After that, bets land in the next round.
2. **Lock.** Once betting has closed, anyone can call `lock(n)`. It sets `revealBlock = block.number + 2`, a block that does not exist yet.
3. **Settle.** Once `revealBlock` is mined, anyone can call `settle(n)`. The seed is `keccak256(blockhash(revealBlock), n, arena)`. Each hamster's time is `20000 + keccak(seed, i) % 10001` ms, drawn the same way for all three, so each wins 1/3 of races (a test checks the spread over 3,000 seeds). The longest time wins, and a tie goes to the higher 256-bit draw. If more than 256 blocks pass before settling, the hash is gone and the round refunds everyone.
4. **Claim.** Each winning backer gets `stake * totalPool / winnerPool`, with 0% fee. If nobody backed the winner, everyone gets their full stake back. `claimed[round][player]` blocks a second claim, and `claim` has a reentrancy guard.
5. **No admin.** There is no owner, no pause, no upgrade and no withdraw function. Nobody can move escrowed SQK except through `claim`.

Randomness limit: block-hash randomness is the strongest source a contract can read without an oracle. The validator that proposes the reveal block could skip it, which costs them that block's reward. Chainlink VRF would remove this, but it needs a funded subscription that only the requester can create. Rounding dust of a few wei per payout stays in the contract.

## Layout

- `src/`: Vite + React + TypeScript site (wagmi 3, viem 2).
  - `config.ts`: chain, RPCs, addresses, connectors.
  - `Arena.tsx`: race, bet form, lock/settle/claim panel.
  - `Player.tsx`: profile, history, leaderboard.
  - `wallet/`: connect sheet, EIP-6963 + Coinbase + open-in-wallet links.
- `src/contract/arena.json`, `src/contract/arenaAbi.ts`: generated ABI, init code, salt and CREATE2 address.
- `contracts/`: Foundry project. `src/SqueekArena.sol`, `test/SqueekArena.t.sol` (no forge-std; it uses a minimal cheatcode interface), `script/export.mjs`.
- `dist/`: the committed production export (relative URLs, `base: "./"`).
- `DESIGN.md`: design tokens and components. `artifacts/validation.md`: review and check results.

## Install, preview, rebuild

```sh
npm ci                # install exact dependencies from package-lock.json
npm run dev           # local dev server
npm run build         # tsc --noEmit + vite build -> dist/
npm run preview       # serve dist/ locally
npm run typecheck     # tsc --noEmit only
```

Contracts (needs Foundry):

```sh
npm run contracts:test     # forge test --root contracts
npm run contracts:export   # rebuild + rewrite src/contract/arena.json and arenaAbi.ts
```

`contracts:export` regenerates the init code. Any change to the contract source or compiler settings changes the CREATE2 address. Rebuild the site afterwards.

## Checks run (this delivery)

| Command | Result |
| --- | --- |
| `forge test --root contracts` | 14 passed, 0 failed |
| Fork e2e on anvil fork of Sepolia with real SQK (scratch script) | deploy at computed address OK; bets 30 + 10 SQK; lock, settle (times 26.155 / 22.013 / 25.772 s, Brown won); winner claimed 40 SQK; loser claim reverted; double claim reverted `AlreadyClaimed`; arena balance 0 afterwards |
| `npm run build` (includes `tsc --noEmit`) | passes; JS bundle about 650 kB (195 kB gzip) |
| design probe `taste.mjs` | 16/16 checks pass at 320/390/1440 |
| Playwright interaction script at `/sub/` subpath, 390 and 1440 | 24/24 pass: connect sheet opens, Escape closes, focus returns, hamster selection, deploy state, no page errors, no 404s, no overflow |

Details and limitations are in `artifacts/validation.md`.

## References

- SqueekChain docs: https://docs.squeekchain.com (token page lists the Sepolia SQK address)
- SqueekChain API: https://api.squeekchain.com/v1. Read-only, not used by this site. The bare `/v1` path answered `{"error":"not_found"}` when probed.
- Sepolia explorer: https://sepolia.etherscan.io
