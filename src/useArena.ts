import { useEffect, useMemo, useState } from "react";
import { useBlockNumber, useBytecode, useReadContract, useReadContracts } from "wagmi";
import { ARENA, ROUND_LENGTH } from "./config";

export type RoundData = {
  id: number;
  totalPool: bigint;
  pools: readonly [bigint, bigint, bigint];
  revealBlock: bigint;
  status: number; // 0 open, 1 locked, 2 settled, 3 refunding
  winner: number;
  refundReason: number;
  timesMs: readonly [number, number, number];
  seed: `0x${string}`;
  closesAt: number;
};

const LOOKBACK = 6;

export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function toRound(id: number, closesAt: number, r: readonly unknown[]): RoundData {
  return {
    id,
    totalPool: r[0] as bigint,
    pools: r[1] as readonly [bigint, bigint, bigint],
    revealBlock: BigInt(r[2] as bigint | number),
    status: Number(r[3]),
    winner: Number(r[4]),
    refundReason: Number(r[5]),
    timesMs: (r[6] as readonly number[]).map(Number) as unknown as readonly [number, number, number],
    seed: r[7] as `0x${string}`,
    closesAt,
  };
}

/** Everything the arena screen reads from SqueekArena, refreshed every few seconds. */
export function useArena() {
  const code = useBytecode({ address: ARENA.address, query: { refetchInterval: (q) => (q.state.data ? false : 15000) } });
  const deployed = !!code.data && code.data !== "0x";
  const genesisQ = useReadContract({ address: ARENA.address, abi: ARENA.abi, functionName: "genesis", query: { enabled: deployed } });
  const genesis = genesisQ.data !== undefined ? Number(genesisQ.data) : undefined;
  const now = useNow();
  const block = useBlockNumber({ watch: { enabled: deployed, pollingInterval: 6000 } });

  const currentId = genesis !== undefined ? Math.max(0, Math.floor((now - genesis) / ROUND_LENGTH)) : undefined;
  const ids = useMemo(() => {
    if (currentId === undefined) return [];
    const out: number[] = [];
    for (let i = currentId; i >= Math.max(0, currentId - LOOKBACK); i--) out.push(i);
    return out;
  }, [currentId]);

  const roundsQ = useReadContracts({
    contracts: ids.map((id) => ({ address: ARENA.address, abi: ARENA.abi, functionName: "getRound" as const, args: [BigInt(id)] as const })),
    query: { enabled: deployed && ids.length > 0, refetchInterval: 6000 },
  });

  const rounds: RoundData[] = useMemo(() => {
    if (!roundsQ.data || genesis === undefined) return [];
    return roundsQ.data.flatMap((res, i) =>
      res.status === "success" ? [toRound(ids[i], genesis + (ids[i] + 1) * ROUND_LENGTH, res.result as readonly unknown[])] : [],
    );
  }, [roundsQ.data, ids, genesis]);

  const current = rounds.find((r) => r.id === currentId);
  // The latest finished round that had bets: the one whose race the arena shows.
  const last = rounds.find((r) => r.id !== currentId && r.totalPool > 0n);

  return {
    loadingCode: code.isLoading,
    codeError: code.isError,
    deployed,
    refetchCode: code.refetch,
    genesis,
    now,
    currentId,
    current,
    last,
    block: block.data,
    refetch: roundsQ.refetch,
  };
}
