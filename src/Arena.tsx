import { useEffect, useRef, useState } from "react";
import { useAccount, useReadContract, useWriteContract, useSendTransaction } from "wagmi";
import { formatUnits, parseUnits, concatHex } from "viem";
import { ARENA, CHAIN_ID, EXPLORER, SQK } from "./config";
import { HAMSTERS, HamsterWheel, type HamsterId } from "./hamsters";
import { useArena, type RoundData } from "./useArena";
import { TxList, useTxs } from "./txs";
import { short } from "./wallet/ConnectSheet";

export const fmt = (v: bigint | undefined, dp = 2) => {
  if (v === undefined) return "…";
  const n = Number(formatUnits(v, 18));
  return n.toLocaleString("en-US", { maximumFractionDigits: n !== 0 && n < 1 ? 4 : dp });
};
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const reduceMotion = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Race replay speed: the onchain times are 20 to 30 seconds; the replay runs them at 3x. */
const SPEED = 3;

function useRaceReplay(last: RoundData | undefined) {
  const raced = last && (last.status === 2 || (last.status === 3 && last.refundReason === 1));
  const [elapsed, setElapsed] = useState<number | null>(null); // ms of race time shown
  const playedFor = useRef<number | null>(null);
  const raf = useRef(0);

  const play = () => {
    if (!last || !raced) return;
    cancelAnimationFrame(raf.current);
    const max = Math.max(...last.timesMs);
    if (reduceMotion()) {
      setElapsed(max);
      return;
    }
    const start = performance.now();
    const tick = () => {
      const t = (performance.now() - start) * SPEED;
      setElapsed(Math.min(t, max));
      if (t < max) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  };

  useEffect(() => {
    if (!last || !raced || playedFor.current === last.id) return;
    playedFor.current = last.id;
    const key = `squeek-arena:seen:${ARENA.address}:${last.id}`;
    if (localStorage.getItem(key)) {
      setElapsed(Math.max(...last.timesMs));
    } else {
      localStorage.setItem(key, "1");
      play();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [last?.id, raced]);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const done = !!last && elapsed !== null && elapsed >= Math.max(...last.timesMs);
  return { raced: !!raced, elapsed, done, play };
}

function DeployPanel({ onDeployed }: { onDeployed: () => void }) {
  const { isConnected, chainId } = useAccount();
  const { sendTransactionAsync } = useSendTransaction();
  const { run } = useTxs();
  const ready = isConnected && chainId === CHAIN_ID;
  return (
    <div className="panel panel--notice">
      <h3>The arena contract is not on Sepolia yet</h3>
      <p>
        SqueekArena has a fixed address, <a className="mono" href={`${EXPLORER}/address/${ARENA.address}`} target="_blank" rel="noreferrer">{short(ARENA.address)}</a>,
        set by its code alone. Anyone with Sepolia ETH can put it there in one transaction. Deploying gives no special rights: the
        contract has no owner.
      </p>
      <button
        className="btn btn--primary"
        disabled={!ready}
        onClick={async () => {
          const ok = await run("Deploy the arena contract", () =>
            sendTransactionAsync({ to: ARENA.factory, data: concatHex([ARENA.salt, ARENA.initCode]), chainId: CHAIN_ID }),
          );
          if (ok) onDeployed();
        }}
      >
        Deploy the arena contract
      </button>
      {!ready && <p className="hint">Connect a wallet on Sepolia to deploy.</p>}
    </div>
  );
}

export function Arena() {
  const a = useArena();
  const { address, isConnected, chainId } = useAccount();
  const onSepolia = isConnected && chainId === CHAIN_ID;
  const { writeContractAsync } = useWriteContract();
  const { run } = useTxs();
  const [pick, setPick] = useState<HamsterId | null>(null);
  const [amount, setAmount] = useState("");
  const replay = useRaceReplay(a.last);

  const balance = useReadContract({
    address: SQK.address, abi: SQK.abi, functionName: "balanceOf", args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 12000 },
  });
  const allowance = useReadContract({
    address: SQK.address, abi: SQK.abi, functionName: "allowance", args: address ? [address, ARENA.address] : undefined,
    query: { enabled: !!address && a.deployed, refetchInterval: 12000 },
  });
  const myStakes = useReadContract({
    address: ARENA.address, abi: ARENA.abi, functionName: "stakesOf",
    args: address && a.currentId !== undefined ? [BigInt(a.currentId), address] : undefined,
    query: { enabled: !!address && a.deployed && a.currentId !== undefined, refetchInterval: 12000 },
  });
  const lastClaimable = useReadContract({
    address: ARENA.address, abi: ARENA.abi, functionName: "claimable",
    args: address && a.last ? [BigInt(a.last.id), address] : undefined,
    query: { enabled: !!address && !!a.last && a.last.status >= 2, refetchInterval: 12000 },
  });

  let wei: bigint | null = null;
  try {
    wei = amount.trim() ? parseUnits(amount.trim(), 18) : null;
  } catch {
    wei = null;
  }
  const amountError =
    amount.trim() && wei === null ? "Enter a number, like 25 or 2.5." :
    wei !== null && wei < 10n ** 16n ? "The smallest bet is 0.01 SQK." :
    wei !== null && balance.data !== undefined && wei > balance.data ? "That is more SQK than this wallet holds." : null;

  const needsApproval = wei !== null && allowance.data !== undefined && allowance.data < wei;
  const secondsLeft = a.current ? Math.max(0, a.current.closesAt - a.now) : undefined;
  const closingSoon = secondsLeft !== undefined && secondsLeft <= 15;
  const pools = a.current?.pools ?? [0n, 0n, 0n];
  const total = a.current?.totalPool ?? 0n;

  const refreshAll = () => {
    a.refetch();
    balance.refetch();
    allowance.refetch();
    myStakes.refetch();
    lastClaimable.refetch();
  };

  const approve = async () => {
    if (wei === null) return;
    await run(`Approve ${fmt(wei)} SQK`, () =>
      writeContractAsync({ address: SQK.address, abi: SQK.abi, functionName: "approve", args: [ARENA.address, wei!], chainId: CHAIN_ID }),
    );
    allowance.refetch();
  };
  const placeBet = async () => {
    if (wei === null || pick === null) return;
    const ok = await run(`Bet ${fmt(wei)} SQK on ${HAMSTERS[pick].name}`, () =>
      writeContractAsync({ address: ARENA.address, abi: ARENA.abi, functionName: "bet", args: [pick, wei!], chainId: CHAIN_ID }),
    );
    if (ok) setAmount("");
    refreshAll();
  };
  const roundAction = async (fn: "lock" | "settle" | "claim", label: string) => {
    if (!a.last) return;
    await run(label, () =>
      writeContractAsync({ address: ARENA.address, abi: ARENA.abi, functionName: fn, args: [BigInt(a.last!.id)], chainId: CHAIN_ID }),
    );
    refreshAll();
  };

  const last = a.last;
  const laneState = (i: number): "idle" | "run" | "stop" => {
    if (replay.raced && replay.elapsed !== null && last && !replay.done) return replay.elapsed < last.timesMs[i] ? "run" : "stop";
    return "idle";
  };
  const showTimes = replay.raced && replay.elapsed !== null && last;

  let betBlocker: string | null = null;
  if (!a.deployed) betBlocker = "Betting opens once the arena contract is deployed.";
  else if (!isConnected) betBlocker = "Connect a wallet to bet.";
  else if (!onSepolia) betBlocker = "Switch your wallet to Sepolia to bet.";
  else if (pick === null) betBlocker = "Pick a hamster first.";
  else if (closingSoon) betBlocker = "Betting is about to close. Your bet would land in the next round.";

  return (
    <section className="arena" aria-labelledby="arena-title">
      <div className="arena__bar">
        <h2 id="arena-title">{a.currentId !== undefined ? `Round ${a.currentId}` : "Live race"}</h2>
        <p className="arena__clock" aria-live="off">
          {a.deployed && secondsLeft !== undefined ? (
            <>Betting closes in <strong className="num">{clock(secondsLeft)}</strong></>
          ) : a.loadingCode ? "Reading Sepolia…" : a.codeError ? "Could not reach Sepolia. Retrying." : "Not deployed yet"}
        </p>
        <p className="arena__pool">Pool <strong className="num">{fmt(total)} SQK</strong></p>
      </div>

      {showTimes && last && (
        <div className={`result ${replay.done ? "result--done" : ""}`} role="status">
          {replay.done ? (
            <>
              <strong>{HAMSTERS[last.winner].name} wins round {last.id}</strong> after running {(last.timesMs[last.winner] / 1000).toFixed(3)} s.{" "}
              {last.status === 2
                ? `Its backers split ${fmt(last.totalPool)} SQK.`
                : "Nobody backed it, so every bet is refunded."}
            </>
          ) : (
            <>Round {last.id} is racing. The hamster that keeps running longest wins.</>
          )}
          {replay.done && !reduceMotion() && (
            <button className="btn btn--link" onClick={replay.play}>Replay race</button>
          )}
        </div>
      )}

      <fieldset className="lanes">
        <legend className="sr-only">Pick a hamster</legend>
        {HAMSTERS.map((h) => {
          const share = total > 0n ? Number((pools[h.id] * 1000n) / total) / 10 : 0;
          const mult = pools[h.id] > 0n ? Number((total * 100n) / pools[h.id]) / 100 : null;
          const mine = myStakes.data?.[h.id] ?? 0n;
          const isWinner = showTimes && replay.done && last?.winner === h.id;
          return (
            <label key={h.id} className={`lane ${pick === h.id ? "lane--picked" : ""} ${isWinner ? "lane--winner" : ""}`}>
              <input type="radio" name="hamster" value={h.id} checked={pick === h.id} onChange={() => setPick(h.id as HamsterId)} className="sr-only" />
              <HamsterWheel id={h.id as HamsterId} state={laneState(h.id)} />
              <span className="lane__name">{h.name}{isWinner ? " · winner" : ""}</span>
              {showTimes && last ? (
                <span className="lane__time num">{(Math.min(replay.elapsed!, last.timesMs[h.id]) / 1000).toFixed(2)} s</span>
              ) : null}
              <span className="lane__pool num">{fmt(pools[h.id])} SQK</span>
              <span className="lane__meta num">{share}% of pool{mult ? ` · pays ${mult}x` : ""}</span>
              {mine > 0n && <span className="lane__mine num">Your bet {fmt(mine)}</span>}
            </label>
          );
        })}
      </fieldset>

      {!a.deployed && !a.loadingCode ? (
        <DeployPanel onDeployed={() => a.refetchCode()} />
      ) : (
        <form
          className="bet"
          onSubmit={(e) => {
            e.preventDefault();
            if (needsApproval) approve();
            else placeBet();
          }}
        >
          <div className="bet__field">
            <label htmlFor="amount">Bet amount</label>
            <div className="bet__input">
              <input
                id="amount" inputMode="decimal" autoComplete="off" placeholder="10" value={amount}
                onChange={(e) => setAmount(e.target.value.replace(",", "."))}
                aria-invalid={!!amountError} aria-describedby="amount-help"
              />
              <span className="bet__unit">SQK</span>
              {balance.data !== undefined && balance.data > 0n && (
                <button type="button" className="btn btn--small" onClick={() => setAmount(formatUnits(balance.data!, 18))}>Max</button>
              )}
            </div>
            <p id="amount-help" className={amountError ? "hint hint--error" : "hint"}>
              {amountError ?? (isConnected ? `Balance ${fmt(balance.data)} SQK` : "Bets go into the contract's escrow until the race settles.")}
            </p>
          </div>
          <button className="btn btn--primary btn--wide" type="submit" disabled={!!betBlocker || wei === null || !!amountError}>
            {needsApproval && wei !== null ? `Approve ${fmt(wei)} SQK` : pick !== null ? `Bet on ${HAMSTERS[pick].name}` : "Place bet"}
          </button>
          {betBlocker && <p className="hint">{betBlocker}</p>}
          {needsApproval && !betBlocker && <p className="hint">Step 1 of 2: allow the arena to take exactly this amount. Then place the bet.</p>}
        </form>
      )}

      {a.deployed && last && <RoundPanel r={last} block={a.block} claimable={lastClaimable.data} canSend={onSepolia} onAction={roundAction} />}
      <TxList />
    </section>
  );
}

function RoundPanel({ r, block, claimable, canSend, onAction }: {
  r: RoundData; block?: bigint; claimable?: bigint; canSend: boolean;
  onAction: (fn: "lock" | "settle" | "claim", label: string) => void;
}) {
  let body: React.ReactNode = null;
  if (r.status === 0) {
    body = (
      <>
        <p>Betting on round {r.id} has closed with {fmt(r.totalPool)} SQK in the pool. Starting the race commits it to a block that does not exist yet.</p>
        <button className="btn" disabled={!canSend} onClick={() => onAction("lock", `Start race ${r.id}`)}>Start the race</button>
      </>
    );
  } else if (r.status === 1) {
    const waiting = block !== undefined && block <= r.revealBlock;
    const expired = block !== undefined && block > r.revealBlock + 256n;
    body = (
      <>
        <p>
          {waiting
            ? `Round ${r.id} is waiting for Sepolia block ${r.revealBlock}. Its hash decides the race.`
            : expired
              ? `Round ${r.id} was not revealed within 256 blocks. Revealing now refunds every bet.`
              : `Block ${r.revealBlock} is mined. Reveal the race to see who ran longest.`}
        </p>
        <button className="btn" disabled={!canSend || waiting} onClick={() => onAction("settle", `Reveal race ${r.id}`)}>
          {expired ? "Refund this round" : "Reveal the race"}
        </button>
      </>
    );
  } else if (claimable && claimable > 0n) {
    body = (
      <>
        <p>{r.status === 2 ? `You won ${fmt(claimable)} SQK in round ${r.id}.` : `Round ${r.id} is refunding. ${fmt(claimable)} SQK is yours to take back.`}</p>
        <button className="btn btn--primary" disabled={!canSend} onClick={() => onAction("claim", `Claim round ${r.id}`)}>
          {r.status === 2 ? `Claim ${fmt(claimable)} SQK` : `Refund ${fmt(claimable)} SQK`}
        </button>
      </>
    );
  } else if (r.status === 3 && r.refundReason === 2) {
    body = <p>Round {r.id} could not be revealed in time, so every bet is refundable from your profile.</p>;
  }
  if (!body) return null;
  return (
    <div className="panel">
      {body}
      {!canSend && <p className="hint">Anyone can do this from a wallet on Sepolia.</p>}
    </div>
  );
}
