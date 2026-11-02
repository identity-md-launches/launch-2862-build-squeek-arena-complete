import { useEffect, useRef, useState } from "react";
import { useAccount, useConnect, useDisconnect, useSwitchChain, type Connector } from "wagmi";
import { getAddress } from "viem";
import { WALLET_ICONS } from "./wallet-icons";
import { OPEN_IN, isMobileBrowser } from "./open-in";
import { CHAIN_ID, chain } from "../config";

export const short = (a: string) => {
  const c = getAddress(a);
  return `${c.slice(0, 6)}…${c.slice(-4)}`;
};

/** The connect control and its sheet: the site's own type and colors, the network's structure. */
export function ConnectSheet() {
  const mobile = isMobileBrowser();
  const { address, isConnected, chainId } = useAccount();
  const { connectors, connect, isPending, variables, error, reset } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: switching } = useSwitchChain();
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const sheet = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    addEventListener("keydown", onKey);
    sheet.current?.querySelector<HTMLElement>("button, a")?.focus();
    return () => {
      removeEventListener("keydown", onKey);
      opener.current?.focus();
    };
  }, [open]);
  useEffect(() => {
    if (isConnected) setOpen(false);
  }, [isConnected]);

  // EIP-6963 names each installed extension; wagmi's generic injected row is only for a browser
  // where discovery found nothing, and then it is called what it is.
  const named = connectors.some((c) => c.type === "injected" && c.id !== "injected");
  const listed = [...connectors.filter((c) => c.type === "injected"), ...connectors.filter((c) => c.type !== "injected")].filter(
    (c) => !(c.id === "injected" && named),
  );
  const label = (c: Connector) =>
    c.id === "injected" ? "Browser wallet" : c.id === "coinbaseWalletSDK" && mobile ? "Coinbase Smart Wallet" : c.name;
  const icon = (c: Connector) => c.icon ?? WALLET_ICONS[c.id];

  if (isConnected && address) {
    if (chainId !== CHAIN_ID) {
      return (
        <button className="btn btn--primary" onClick={() => switchChain({ chainId: CHAIN_ID })} disabled={switching}>
          {switching ? "Switching…" : `Switch to ${chain.name}`}
        </button>
      );
    }
    return (
      <button className="btn btn--ghost" onClick={() => disconnect()} title="Disconnect this wallet">
        <span className="mono">{short(address)}</span> · Disconnect
      </button>
    );
  }
  return (
    <>
      <button
        ref={opener}
        className="btn btn--primary"
        onClick={() => {
          reset();
          setOpen(true);
        }}
      >
        Connect
      </button>
      {open && (
        <div className="sheet-bg" onClick={() => setOpen(false)}>
          <div ref={sheet} className="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-head">
              <h2 id="sheet-title">Connect a wallet</h2>
              <button className="x" aria-label="Close" onClick={() => setOpen(false)}>
                ×
              </button>
            </div>
            {mobile &&
              OPEN_IN.map((w) => (
                <a key={w.id} className="row" href={w.href(location.href)}>
                  <span className="ic">{WALLET_ICONS[w.id] && <img width={28} height={28} src={WALLET_ICONS[w.id]} alt="" />}</span>
                  <span>Open in {w.name}</span>
                </a>
              ))}
            {listed
              .filter((c) => !mobile || c.type !== "injected")
              .map((c) => (
                <button key={c.uid} className="row" onClick={() => connect({ connector: c })} disabled={isPending}>
                  <span className="ic">{icon(c) ? <img width={28} height={28} src={icon(c)} alt="" /> : null}</span>
                  <span>
                    {label(c)}
                    {isPending && variables?.connector === c ? " · opening…" : ""}
                  </span>
                </button>
              ))}
            {error && <p className="note note--error">{error.message.split("\n")[0]}</p>}
            <p className="note">Your wallet signs every transaction. This site never asks for a private key or seed phrase.</p>
          </div>
        </div>
      )}
    </>
  );
}
