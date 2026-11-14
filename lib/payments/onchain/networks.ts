import { evmHex, isValidEvmAddress, isValidTronAddress, tronHex } from './address';

/**
 * Networks on which DOOM accepts USDT sent straight to the shop's own wallet addresses (no processor).
 * Only public receiving addresses are configured — never a private key, which the site never needs.
 *
 *   CRYPTO_ADDRESS_TRON   Tron (TRC20)             base58, starts with T
 *   CRYPTO_ADDRESS_BSC    BNB Smart Chain (BEP20)  0x…, EIP-55 checksum REQUIRED
 *   CRYPTO_ADDRESS_ETH    Ethereum (ERC20)         0x…, EIP-55 checksum REQUIRED
 *   CRYPTO_RPC_BSC / CRYPTO_RPC_ETH   optional, comma-separated JSON-RPC URLs (default: three independent public nodes, two must agree)
 *   CRYPTO_TRONGRID_URL / CRYPTO_TRONGRID_KEY   optional Tron API base URL and API key
 *
 * An address that fails its checksum is treated as NOT configured: money is never sent to a mistyped address.
 */
export type NetworkId = 'TRON' | 'BSC' | 'ETH';
export const NETWORK_IDS: readonly NetworkId[] = ['TRON', 'BSC', 'ETH'];

export type NetworkDef = {
  id: NetworkId;
  /** Standard name customers know. */
  standard: 'TRC20' | 'BEP20' | 'ERC20';
  kind: 'evm' | 'tron';
  envAddress: string;
  /** The official Tether (USDT) token contract on that network. */
  usdt: { contract: string; decimals: number };
  /** Blocks on top of the one holding the transfer (EVM only; Tron uses the solidified, irreversible state). */
  confirmations: number;
  rpcEnv?: string;
  rpcDefaults?: readonly string[];
};

export const NETWORKS: Record<NetworkId, NetworkDef> = {
  TRON: { id: 'TRON', standard: 'TRC20', kind: 'tron', envAddress: 'CRYPTO_ADDRESS_TRON', usdt: { contract: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', decimals: 6 }, confirmations: 19 },
  BSC: {
    id: 'BSC',
    standard: 'BEP20',
    kind: 'evm',
    envAddress: 'CRYPTO_ADDRESS_BSC',
    usdt: { contract: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 },
    confirmations: 15,
    rpcEnv: 'CRYPTO_RPC_BSC',
    rpcDefaults: ['https://bsc-dataseed.binance.org', 'https://1rpc.io/bnb', 'https://bsc-dataseed1.bnbchain.org'],
  },
  ETH: {
    id: 'ETH',
    standard: 'ERC20',
    kind: 'evm',
    envAddress: 'CRYPTO_ADDRESS_ETH',
    usdt: { contract: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
    confirmations: 12,
    rpcEnv: 'CRYPTO_RPC_ETH',
    rpcDefaults: ['https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org', 'https://1rpc.io/eth'],
  },
};

type Env = Record<string, string | undefined>;

/** The configured, checksum-valid receiving address of a network, or null. */
export function receivingAddress(id: NetworkId, env: Env = process.env): string | null {
  const def = NETWORKS[id];
  const raw = env[def.envAddress]?.trim();
  if (!raw) return null;
  const ok = def.kind === 'tron' ? isValidTronAddress(raw) : isValidEvmAddress(raw);
  if (!ok) {
    console.error(`[crypto] ${def.envAddress} is not a valid address (checksum) — the ${id} network is switched off`);
    return null;
  }
  return raw;
}

/** Networks ready to receive payments, in display order. */
export function configuredNetworks(env: Env = process.env): { id: NetworkId; address: string }[] {
  return NETWORK_IDS.flatMap((id) => {
    const address = receivingAddress(id, env);
    return address ? [{ id, address }] : [];
  });
}

export function rpcUrls(id: NetworkId, env: Env = process.env): string[] {
  const def = NETWORKS[id];
  const custom = def.rpcEnv ? env[def.rpcEnv]?.split(',').map((s) => s.trim()).filter((s) => /^https:\/\//.test(s)) : [];
  return custom && custom.length > 0 ? custom : [...(def.rpcDefaults ?? [])];
}

/** 20-byte lowercase hex of an address on that network (for comparing with log topics). */
export function addressHex(id: NetworkId, address: string): string {
  return NETWORKS[id].kind === 'tron' ? (tronHex(address) ?? '') : evmHex(address);
}

/** Masked form for screens that only need to confirm WHICH address is configured: `0xcc77…8608`. */
export function maskAddress(address: string): string {
  return address.length <= 14 ? address : `${address.slice(0, 6)}…${address.slice(-4)}`;
}
