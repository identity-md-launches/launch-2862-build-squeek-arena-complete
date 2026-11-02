import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ARENA, EXPLORER, SQK, config } from "./config";
import { ConnectSheet } from "./wallet/ConnectSheet";
import { Arena } from "./Arena";
import { Leaderboard, Profile } from "./Player";
import { TxProvider } from "./txs";
import "./styles.css";

const queryClient = new QueryClient();

function App() {
  return (
    <>
      <header className="top">
        <a className="brand" href="#arena" aria-label="SQUEEK ARENA home">
          <img src="./favicon.svg" width={28} height={28} alt="" />
          <span>SQUEEK ARENA</span>
        </a>
        <nav className="nav" aria-label="Sections">
          <a href="#profile">Profile</a>
          <a href="#leaderboard">Leaderboard</a>
          <a href="#fairness">Fairness</a>
        </nav>
        <ConnectSheet />
      </header>
      <main id="arena">
        <div className="intro">
          <h1>Pick your hamster. Place your SQK. Win the race.</h1>
          <p>Brown, White and Golden race every 5 minutes on Sepolia, and the winner's backers split the whole pool.</p>
        </div>
        <Arena />
        <div id="profile"><Profile /></div>
        <div id="leaderboard"><Leaderboard /></div>
        <section id="fairness" className="section" aria-labelledby="fair-title">
          <h2 id="fair-title">How the race stays fair</h2>
          <ol className="steps">
            <li><strong>Bets go into escrow.</strong> SQK moves into the SqueekArena contract and can only leave through a winner's claim or a refund.</li>
            <li><strong>Betting closes on the clock.</strong> Each round takes bets for 5 minutes. After that, bets land in the next round.</li>
            <li><strong>The result comes from a future block.</strong> Starting the race fixes a Sepolia block 2 blocks ahead. Its hash, unknown when betting closed, seeds three running times between 20 and 30 seconds.</li>
            <li><strong>Equal odds, longest run wins.</strong> Each hamster's time is drawn the same way, so each wins one race in three. Ties go to the higher 256-bit draw.</li>
            <li><strong>Winners split the whole pool.</strong> No fee: backers of the winner share 100% of the pool by stake. If nobody backed the winner, everyone is refunded.</li>
            <li><strong>Nobody can change it.</strong> The contract has no owner, admin, pause or upgrade. If a race is not revealed within 256 blocks, the round refunds everyone.</li>
          </ol>
          <dl className="facts">
            <div><dt>Arena contract</dt><dd><a className="mono" href={`${EXPLORER}/address/${ARENA.address}`} target="_blank" rel="noreferrer">{ARENA.address}</a></dd></div>
            <div><dt>Squeek (SQK) token</dt><dd><a className="mono" href={`${EXPLORER}/token/${SQK.address}`} target="_blank" rel="noreferrer">{SQK.address}</a></dd></div>
            <div><dt>Network</dt><dd>Ethereum Sepolia, chain ID 11155111</dd></div>
            <div><dt>Fee</dt><dd>0%</dd></div>
          </dl>
          <p className="muted small">
            Block-hash randomness is the strongest source a contract can read without an oracle. Its known limit: the validator proposing
            the reveal block could skip it, giving up that block's reward. On a testnet with test tokens that trade-off is accepted.
          </p>
        </section>
      </main>
      <footer className="foot">
        <p>SQUEEK ARENA runs on Squeek (SQK), the token of <a href="https://docs.squeekchain.com" target="_blank" rel="noreferrer">SqueekChain</a>. Testnet only: SQK on Sepolia has no market value.</p>
      </footer>
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <TxProvider>
          <App />
        </TxProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
);
