# SQUEEK ARENA design

Warm sawdust-and-wood palette, rounded system type, one white arena card holding three hamster wheels. Every value below comes from `src/styles.css`, `src/hamsters.tsx` and `index.html`.

## Color tokens (`:root` in `src/styles.css`)

| Token | Value | Role |
| --- | --- | --- |
| `--bg` | `#fff7ea` | page background, theme-color |
| `--surface` | `#ffffff` | arena card, stat tiles, tables, sheet |
| `--surface-2` | `#fbeedb` | lanes, hover fill, race-status strip |
| `--ink` | `#2b1d12` | text, focus ring (`--focus`) |
| `--ink-2` | `#6b5240` | secondary text, hints, table heads |
| `--line` | `#e6d3bb` | borders, dividers |
| `--accent` / `--accent-hover` | `#a3410e` / `#86340a` | primary buttons, links, picked lane outline |
| `--gold` | `#e2a42a` | winner lane outline |
| `--ok` / `--bad` | `#2f7a3a` / `#b3261e` | tx confirmed dot / errors |
| `--wheel` | `#8a6a52` | wheel strokes |

State fills: picked lane `#fde3cf`, winner lane and finished result `#fdecc4`, lane hover `#f7e3c6`. Hamster fur: Brown `#9a5b2e`, White `#f7f2ea`, Golden `#e2a42a` (`src/hamsters.tsx`). The design probe measured all text pairs at 4.5:1 or better. It flagged the accent link on the notice panel at 4.46:1, so the accent was darkened from `#b84a12` to `#a3410e`.

## Typography

- Family: `ui-rounded, "SF Pro Rounded", system-ui, …` for everything. `ui-monospace` only for addresses and tx hashes (`.mono`, 13px). No web fonts are loaded.
- Scale, 5 sizes: `--fs-1` 13px (hints, meta, tables) · `--fs-2` 15px (body, buttons) · `--fs-3` 17px (h3, lane names, brand) · `--fs-4` 22px (h2, stat values) · `--fs-5` `clamp(26px, 4.5vw, 36px)` (h1).
- Weights: 400 body, 600 labels and buttons, 700 headings. h1 letter-spacing is -0.02em. Headings use `text-wrap: balance`. Numbers use `tabular-nums` (`.num`).
- Casing: sentence case in content. All-caps appears only in the brand wordmark "SQUEEK ARENA" in the header.

## Spacing and shape

4px base: `--s-1` 4, `--s-2` 8, `--s-3` 12, `--s-4` 16, `--s-5` 24, `--s-6` 40. Radii: `--radius` 14px (arena card, sheet) and `--radius-sm` 10px (lanes, inputs, tiles). Buttons are pills (999px). The page column is 1080px max.

## Components

- **Header** (`.top`): wordmark with favicon, section links (hidden under 640px), and one Connect control.
- **Connect control and sheet** (`src/wallet/ConnectSheet.tsx`): EIP-6963 wallets by name and icon, then Coinbase Wallet. On phones without an injected wallet: "Open in MetaMask / Coinbase Wallet / Phantom", then Coinbase Smart Wallet. Rows are 48px. Closes by backdrop, Escape or ×, and focus returns to Connect. Connected, it shows `0x1234…abcd · Disconnect`. On the wrong network it shows `Switch to Sepolia`.
- **Arena card** (`.arena`): round title, countdown, pool total, an optional result strip, three lanes, the bet form, the round panel and the transaction list.
- **Lane** (`.lane`): a radio input styled as a card, with an animated `HamsterWheel` SVG, name, live race time, pool, share and payout multiple, and your stake. States: rest, hover, picked (accent outline), focus-visible (ink ring), winner (gold outline and "· winner").
- **HamsterWheel**: the ring rotates at 5s/turn while idle and 0.7s while racing. The hamster bobs. During a race, each wheel stops when that hamster's onchain time runs out. The replay plays at 3x speed.
- **Bet form**: amount input with SQK unit and Max, inline validation (number, 0.01 minimum, balance), and one primary button that reads "Approve N SQK" and then "Bet on <hamster>". The reason it is disabled is shown under it.
- **Round panel** (`.panel`): a divider and then the next action for the last round: Start the race (`lock`), Reveal the race (`settle`), Claim or Refund. Before deployment: Deploy the arena contract.
- **Tx list** (`.txs`): label, status dot (pending, confirmed or failed), status text, Etherscan link to the hash, and the error line.
- **Profile**: full address, a stat grid (SQK, ETH for gas, bets, wins, wagered, won), and a history table with per-round Claim buttons.
- **Leaderboard**: top 20 by SQK won, read from `playersPage`.
- **Fairness**: numbered steps, a facts grid (contract, token, network, fee), and the randomness limitation.

## Motion

Only `transform` and colors animate (150ms ease, buttons scale to 0.98 when pressed). Under `prefers-reduced-motion: reduce` the wheel animations stop, smooth scrolling turns off, and the race replay jumps to the final times.

## Responsive behavior

- **Under 640px:** nav links hidden; header compact; the connect sheet becomes a bottom sheet with safe-area padding; the arena padding is 12px. The three lanes stay side by side, so all three wheels and the bet form are on the first screen at 390.
- **Under 360px:** the wordmark text hides (the icon stays) and lane padding tightens. 320 has no horizontal scroll (probe).
- **900px and up:** the arena becomes a two-column grid. The bar, result strip and lanes span both columns. The bet form sits left and the round panel and tx list sit right. Stats show 3 columns and facts show 2.
- Tables scroll horizontally inside `.table-wrap` when they are narrower than their content.
