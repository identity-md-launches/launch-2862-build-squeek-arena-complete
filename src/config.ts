import { createConfig, fallback, http } from "wagmi";
import { coinbaseWallet, injected } from "wagmi/connectors";
import { sepolia } from "viem/chains";
import { erc20Abi, type Address, type Hex } from "viem";
import arena from "./contract/arena.json";
import { arenaAbi } from "./contract/arenaAbi";

export const SITE_NAME = "SQUEEK ARENA";
export const SITE_DESCRIPTION = "Pick your hamster. Place your SQK. Win the race. Three-hamster races on Sepolia, paid out by a contract with no admin.";

export const chain = sepolia;
export const CHAIN_ID = 11155111 as const;

/** Public Sepolia RPCs. publicnode first; viem's default Sepolia RPC as a fallback. */
export const PUBLIC_RPC_URL = "https://ethereum-sepolia-rpc.publicnode.com";
export const EXPLORER = "https://sepolia.etherscan.io";

/** Squeek (SQK), verified on Sepolia: name "Squeek", symbol "SQK", 18 decimals, immutable ERC-20. */
export const SQK = {
  address: "0x6872bfa5ccc3e9e440c6c16e5ffdabb8dba4cc76" as Address,
  decimals: 18,
  symbol: "SQK",
  abi: erc20Abi,
} as const;

/**
 * SqueekArena lives at a fixed CREATE2 address: Arachnid's deterministic deployment proxy, a fixed
 * salt and the compiled init code (constructor argument: the SQK address) decide it. Anyone can
 * deploy it there; whoever does gains no rights, because the contract has no owner.
 */
export const ARENA = {
  address: arena.address as Address,
  factory: arena.factory as Address,
  salt: arena.salt as Hex,
  initCode: arena.initCode as Hex,
  abi: arenaAbi,
} as const;

export const ROUND_LENGTH = 300;

export const config = createConfig({
  chains: [chain],
  // EIP-6963 discovery lists every installed extension under its own name
  multiInjectedProviderDiscovery: true,
  connectors: [injected(), coinbaseWallet({ appName: SITE_NAME })],
  transports: { [chain.id]: fallback([http(PUBLIC_RPC_URL), http()]) },
});

declare module "wagmi" {
  interface Register {
    config: typeof config;
  }
}
