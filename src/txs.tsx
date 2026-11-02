import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { usePublicClient } from "wagmi";
import type { Hex } from "viem";
import { EXPLORER } from "./config";

export type Tx = { id: number; label: string; hash?: Hex; status: "signing" | "pending" | "confirmed" | "failed"; error?: string };

type Ctx = { txs: Tx[]; run: (label: string, send: () => Promise<Hex>) => Promise<boolean> };
const TxContext = createContext<Ctx>({ txs: [], run: async () => false });

let nextId = 1;

/** Plain-language reason from a viem/wallet error. */
export function reason(e: unknown): string {
  const err = e as { shortMessage?: string; message?: string; details?: string };
  const msg = err.shortMessage || err.message || "Something went wrong";
  if (/reject|denied/i.test(msg)) return "You rejected the request in your wallet.";
  return msg.split("\n")[0];
}

export function TxProvider({ children }: { children: ReactNode }) {
  const [txs, setTxs] = useState<Tx[]>([]);
  const client = usePublicClient();
  const patch = (id: number, p: Partial<Tx>) => setTxs((all) => all.map((t) => (t.id === id ? { ...t, ...p } : t)));

  const run = useCallback(
    async (label: string, send: () => Promise<Hex>) => {
      const id = nextId++;
      setTxs((all) => [{ id, label, status: "signing" as const }, ...all].slice(0, 8));
      try {
        const hash = await send();
        patch(id, { hash, status: "pending" });
        const receipt = await client!.waitForTransactionReceipt({ hash });
        const ok = receipt.status === "success";
        patch(id, { status: ok ? "confirmed" : "failed", error: ok ? undefined : "The transaction reverted onchain." });
        return ok;
      } catch (e) {
        patch(id, { status: "failed", error: reason(e) });
        return false;
      }
    },
    [client],
  );

  return <TxContext.Provider value={{ txs, run }}>{children}</TxContext.Provider>;
}

export const useTxs = () => useContext(TxContext);

const STATUS_TEXT: Record<Tx["status"], string> = {
  signing: "Waiting for your wallet",
  pending: "Pending on Sepolia",
  confirmed: "Confirmed",
  failed: "Failed",
};

export function TxList() {
  const { txs } = useTxs();
  if (!txs.length) return null;
  return (
    <ul className="txs" aria-live="polite">
      {txs.map((t) => (
        <li key={t.id} className={`tx tx--${t.status}`}>
          <span className="tx__dot" aria-hidden="true" />
          <span className="tx__label">{t.label}</span>
          <span className="tx__status">{STATUS_TEXT[t.status]}</span>
          {t.hash && (
            <a className="mono tx__hash" href={`${EXPLORER}/tx/${t.hash}`} target="_blank" rel="noreferrer">
              {t.hash.slice(0, 10)}…{t.hash.slice(-6)}
            </a>
          )}
          {t.error && <span className="tx__error">{t.error}</span>}
        </li>
      ))}
    </ul>
  );
}
