import { useAccount, useBalance, useBytecode, useReadContract, useReadContracts, useWriteContract } from "wagmi";
import { formatUnits, getAddress } from "viem";
import { ARENA, CHAIN_ID, EXPLORER, ROUND_LENGTH, SQK } from "./config";
import { HAMSTERS } from "./hamsters";
import { fmt } from "./Arena";
import { toRound } from "./useArena";
import { useTxs } from "./txs";
import { short } from "./wallet/ConnectSheet";

const STATUS = ["Betting", "Racing", "Finished", "Refunding"];

function useDeployed() {
  const code = useBytecode({ address: ARENA.address });
  return !!code.data && code.data !== "0x";
}

export function Profile() {
  const { address, chainId } = useAccount();
  const deployed = useDeployed();
  const { writeContractAsync } = useWriteContract();
  const { run } = useTxs();
  const sqk = useReadContract({
    address: SQK.address, abi: SQK.abi, functionName: "balanceOf", args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 12000 },
  });
  const eth = useBalance({ address, chainId: CHAIN_ID, query: { enabled: !!address } });
  const stats = useReadContract({
    address: ARENA.address, abi: ARENA.abi, functionName: "stats", args: address ? [address] : undefined,
    query: { enabled: !!address && deployed, refetchInterval: 15000 },
  });
  const roundIds = useReadContract({
    address: ARENA.address, abi: ARENA.abi, functionName: "roundsOf", args: address ? [address] : undefined,
    query: { enabled: !!address && deployed, refetchInterval: 15000 },
  });
  const genesis = useReadContract({ address: ARENA.address, abi: ARENA.abi, functionName: "genesis", query: { enabled: deployed } });
  const ids = [...(roundIds.data ?? [])].reverse().slice(0, 20);
  const rows = useReadContracts({
    contracts: ids.flatMap((id) => [
      { address: ARENA.address, abi: ARENA.abi, functionName: "getRound" as const, args: [id] as const },
      { address: ARENA.address, abi: ARENA.abi, functionName: "stakesOf" as const, args: [id, address!] as const },
      { address: ARENA.address, abi: ARENA.abi, functionName: "claimable" as const, args: [id, address!] as const },
      { address: ARENA.address, abi: ARENA.abi, functionName: "claimed" as const, args: [id, address!] as const },
    ]),
    query: { enabled: !!address && ids.length > 0, refetchInterval: 15000 },
  });

  if (!address) {
    return (
      <section className="section" aria-labelledby="profile-title">
        <h2 id="profile-title">Your profile</h2>
        <p className="muted">Connect a wallet to see your SQK balance, your bets and anything you can claim.</p>
      </section>
    );
  }

  const s = stats.data as readonly [bigint, bigint, bigint, number, number] | undefined;
  const g = genesis.data !== undefined ? Number(genesis.data) : 0;

  return (
    <section className="section" aria-labelledby="profile-title">
      <h2 id="profile-title">Your profile</h2>
      <p className="muted">
        <a className="mono" href={`${EXPLORER}/address/${address}`} target="_blank" rel="noreferrer">{getAddress(address)}</a>
        {chainId !== CHAIN_ID && " · on another network, switch to Sepolia to bet"}
      </p>
      <dl className="stats">
        <div><dt>SQK balance</dt><dd className="num">{fmt(sqk.data)}</dd></div>
        <div><dt>Sepolia ETH for gas</dt><dd className="num">{eth.data ? Number(formatUnits(eth.data.value, 18)).toFixed(4) : "…"}</dd></div>
        <div><dt>Bets placed</dt><dd className="num">{s ? s[3] : deployed ? "…" : 0}</dd></div>
        <div><dt>Races won</dt><dd className="num">{s ? s[4] : deployed ? "…" : 0}</dd></div>
        <div><dt>SQK wagered</dt><dd className="num">{s ? fmt(s[0]) : deployed ? "…" : "0"}</dd></div>
        <div><dt>SQK won</dt><dd className="num">{s ? fmt(s[1]) : deployed ? "…" : "0"}</dd></div>
      </dl>

      <h3>Betting history</h3>
      {ids.length === 0 ? (
        <p className="muted">{deployed ? "No bets yet. Pick a hamster above to place your first." : "History appears once the arena contract is deployed."}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th scope="col">Round</th><th scope="col">Your bets</th><th scope="col">Result</th><th scope="col" className="r">Payout</th></tr>
            </thead>
            <tbody>
              {ids.map((id, i) => {
                const d = rows.data;
                const rr = d?.[i * 4];
                if (!rr || rr.status !== "success") return <tr key={String(id)}><td>{String(id)}</td><td colSpan={3} className="muted">Loading…</td></tr>;
                const r = toRound(Number(id), g + (Number(id) + 1) * ROUND_LENGTH, rr.result as readonly unknown[]);
                const stakes = (d?.[i * 4 + 1]?.result as readonly bigint[] | undefined) ?? [];
                const claimable = (d?.[i * 4 + 2]?.result as bigint | undefined) ?? 0n;
                const claimed = d?.[i * 4 + 3]?.result === true;
                const raced = r.status === 2 || (r.status === 3 && r.refundReason === 1);
                return (
                  <tr key={String(id)}>
                    <td className="num">{String(id)}</td>
                    <td>{stakes.map((v, h) => (v > 0n ? `${fmt(v)} on ${HAMSTERS[h].name}` : null)).filter(Boolean).join(", ")}</td>
                    <td>
                      {raced ? `${HAMSTERS[r.winner].name} won` : STATUS[r.status]}
                      {r.status === 3 && " · refund"}
                    </td>
                    <td className="r">
                      {claimable > 0n ? (
                        <button
                          className="btn btn--small btn--primary"
                          disabled={chainId !== CHAIN_ID}
                          onClick={async () => {
                            await run(`Claim round ${String(id)}`, () =>
                              writeContractAsync({ address: ARENA.address, abi: ARENA.abi, functionName: "claim", args: [id], chainId: CHAIN_ID }),
                            );
                            rows.refetch(); stats.refetch(); sqk.refetch();
                          }}
                        >
                          Claim {fmt(claimable)}
                        </button>
                      ) : claimed ? "Claimed" : r.status >= 2 ? "None" : "Pending"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function Leaderboard() {
  const deployed = useDeployed();
  const page = useReadContract({
    address: ARENA.address, abi: ARENA.abi, functionName: "playersPage", args: [0n, 500n],
    query: { enabled: deployed, refetchInterval: 30000 },
  });
  const data = page.data as readonly [readonly `0x${string}`[], readonly { wagered: bigint; won: bigint; refunded: bigint; bets: number; wins: number }[]] | undefined;
  const rows = data
    ? data[0].map((addr, i) => ({ addr, ...data[1][i], net: data[1][i].won + data[1][i].refunded - data[1][i].wagered }))
        .sort((x, y) => (y.won === x.won ? Number(y.wagered - x.wagered) : y.won > x.won ? 1 : -1))
        .slice(0, 20)
    : [];
  return (
    <section className="section" aria-labelledby="board-title">
      <h2 id="board-title">Leaderboard</h2>
      <p className="muted">Ranked by SQK won, read straight from the contract.</p>
      {!deployed ? (
        <p className="muted">The leaderboard fills in once the arena contract is deployed and races are run.</p>
      ) : page.isLoading ? (
        <p className="muted">Loading players…</p>
      ) : rows.length === 0 ? (
        <p className="muted">No players yet. The first bet puts you on the board.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th scope="col">#</th><th scope="col">Player</th><th scope="col" className="r">Won</th><th scope="col" className="r">Wagered</th><th scope="col" className="r">Wins</th></tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.addr}>
                  <td className="num">{i + 1}</td>
                  <td><a className="mono" href={`${EXPLORER}/address/${r.addr}`} target="_blank" rel="noreferrer">{short(r.addr)}</a></td>
                  <td className="r num">{fmt(r.won)}</td>
                  <td className="r num">{fmt(r.wagered)}</td>
                  <td className="r num">{r.wins}/{r.bets}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
