import { tronHex } from './address';
import { matchesExpected } from './amount';
import { NETWORKS, addressHex, rpcUrls, type NetworkDef, type NetworkId } from './networks';

/**
 * Proves, from the blockchain itself, that a transaction paid THIS payment: the official USDT contract,
 * sent to OUR address, for the expected amount (to the 4th decimal), in the payment's time window, and
 * final enough to be irreversible. The browser's word is never trusted; nothing is credited on `confirmed`
 * unless every one of those checks passes. Only public chain data is read.
 */
const TRANSFER_TOPIC = 'ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

export type VerifyInput = {
  network: NetworkId;
  txHash: string;
  /** The receiving address that was shown to the customer. */
  toAddress: string;
  /** Expected amount in micro-USDT. */
  expectedMicro: number;
  /** The transaction must have been mined inside [notBefore, notAfter]. */
  notBefore: Date;
  notAfter: Date;
};

export type MismatchReason = 'wrong_recipient' | 'wrong_token' | 'wrong_amount' | 'too_early' | 'too_late';

export type VerifyResult =
  | { state: 'not_found' }
  | { state: 'failed' }
  | { state: 'mismatch'; reason: MismatchReason; receivedMicro?: number }
  /** Right transfer, not final yet. */
  | { state: 'pending'; receivedMicro: number; confirmations: number; required: number; blockTime: Date }
  | { state: 'confirmed'; receivedMicro: number; confirmations: number; required: number; blockTime: Date }
  /** Node unreachable or nodes disagree: try again later, never credit. */
  | { state: 'unavailable' };

/** Transaction hash in the canonical form of the network, or null. */
export function normalizeTxHash(network: NetworkId, raw: string): string | null {
  const s = raw.trim().toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{64}$/.test(s)) return null;
  return NETWORKS[network].kind === 'evm' ? `0x${s}` : s;
}

async function postJson(url: string, body: unknown, headers: Record<string, string> = {}, timeoutMs = 8_000): Promise<unknown> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: ctl.signal,
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Token units → micro-USDT (floor). */
const toMicro = (units: bigint, decimals: number): number => Number(decimals >= 6 ? units / 10n ** BigInt(decimals - 6) : units * 10n ** BigInt(6 - decimals));

function judgeWindow(blockTime: Date, input: VerifyInput): MismatchReason | null {
  if (blockTime.getTime() < input.notBefore.getTime()) return 'too_early';
  if (blockTime.getTime() > input.notAfter.getTime()) return 'too_late';
  return null;
}

// ---------------------------------------------------------------- EVM (BNB Smart Chain, Ethereum)
type RpcReceipt = { status?: string; blockNumber?: string; logs?: { address?: string; topics?: string[]; data?: string }[] } | null;

async function rpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const json = (await postJson(url, { jsonrpc: '2.0', id: 1, method, params })) as { result?: T; error?: { message?: string } };
  if (json.error) throw new Error(json.error.message ?? 'rpc error');
  return json.result as T;
}

async function verifyEvmOn(url: string, def: NetworkDef, input: VerifyInput): Promise<VerifyResult> {
  const receipt = await rpc<RpcReceipt>(url, 'eth_getTransactionReceipt', [input.txHash]);
  if (!receipt || !receipt.blockNumber) return { state: 'not_found' }; // unknown or still in the mempool
  if (receipt.status !== '0x1') return { state: 'failed' };

  const token = def.usdt.contract.toLowerCase();
  const to = addressHex(def.id, input.toAddress);
  let received = 0n;
  let otherTokenToUs = false;
  for (const log of receipt.logs ?? []) {
    const topics = log.topics ?? [];
    if (topics.length !== 3 || topics[0]!.replace(/^0x/, '').toLowerCase() !== TRANSFER_TOPIC) continue;
    if (topics[2]!.slice(-40).toLowerCase() !== to) continue;
    if ((log.address ?? '').toLowerCase() !== token) {
      otherTokenToUs = true;
      continue;
    }
    if (!/^0x[0-9a-fA-F]{64}$/.test(log.data ?? '')) continue;
    received += BigInt(log.data!);
  }
  if (received === 0n) return { state: 'mismatch', reason: otherTokenToUs ? 'wrong_token' : 'wrong_recipient' };
  const receivedMicro = toMicro(received, def.usdt.decimals);
  if (!matchesExpected(receivedMicro, input.expectedMicro)) return { state: 'mismatch', reason: 'wrong_amount', receivedMicro };

  const block = await rpc<{ timestamp?: string } | null>(url, 'eth_getBlockByNumber', [receipt.blockNumber, false]);
  if (!block?.timestamp) return { state: 'unavailable' };
  const blockTime = new Date(Number(BigInt(block.timestamp)) * 1000);
  const outside = judgeWindow(blockTime, input);
  if (outside) return { state: 'mismatch', reason: outside, receivedMicro };

  const head = BigInt(await rpc<string>(url, 'eth_blockNumber', []));
  const confirmations = Number(head - BigInt(receipt.blockNumber) + 1n);
  const base = { receivedMicro, confirmations, required: def.confirmations, blockTime };
  return confirmations >= def.confirmations ? { state: 'confirmed', ...base } : { state: 'pending', ...base };
}

/**
 * Several independent nodes must tell the SAME story. `quorum` nodes have to agree before anything is
 * believed (one faulty, blocked or lagging node changes nothing); without a quorum the answer is
 * "ask again later", never "paid".
 */
export function combine(results: VerifyResult[], quorum: number): VerifyResult {
  const answers = results.filter((r) => r.state !== 'unavailable');
  if (answers.length < quorum) return { state: 'unavailable' };
  const present = answers.filter((r): r is Extract<VerifyResult, { state: 'pending' | 'confirmed' }> => r.state === 'pending' || r.state === 'confirmed');
  const absent = answers.filter((r) => r.state !== 'pending' && r.state !== 'confirmed');
  if (present.length >= quorum && present.length > absent.length) {
    if (new Set(present.map((r) => r.receivedMicro)).size !== 1) return { state: 'unavailable' };
    const weakest = present.reduce((a, b) => (a.confirmations <= b.confirmations ? a : b));
    // Final only when a quorum says final; the weakest confirmation count is reported.
    const finals = present.filter((r) => r.state === 'confirmed').length;
    return finals >= quorum ? { ...weakest, state: 'confirmed' } : { ...weakest, state: 'pending' };
  }
  if (absent.length >= quorum && absent.length > present.length) {
    const byState = new Map<string, VerifyResult[]>();
    for (const r of absent) byState.set(r.state, [...(byState.get(r.state) ?? []), r]);
    for (const group of byState.values()) if (group.length >= quorum) return group[0]!;
  }
  return { state: 'unavailable' };
}

// ---------------------------------------------------------------- Tron
type TronInfo = {
  id?: string;
  result?: string;
  blockTimeStamp?: number;
  receipt?: { result?: string };
  log?: { address?: string; topics?: string[]; data?: string }[];
};

async function verifyTron(input: VerifyInput): Promise<VerifyResult> {
  const def = NETWORKS.TRON;
  const base = (process.env.CRYPTO_TRONGRID_URL?.trim() || 'https://api.trongrid.io').replace(/\/+$/, '');
  const key = process.env.CRYPTO_TRONGRID_KEY?.trim();
  const headers: Record<string, string> = key ? { 'TRON-PRO-API-KEY': key } : {};
  // The solidity node only knows irreversible transactions; the full node also knows the very recent ones.
  let info = (await postJson(`${base}/walletsolidity/gettransactioninfobyid`, { value: input.txHash }, headers)) as TronInfo;
  const solid = !!info?.id;
  if (!solid) info = (await postJson(`${base}/wallet/gettransactioninfobyid`, { value: input.txHash }, headers)) as TronInfo;
  if (!info?.id) return { state: 'not_found' };
  if (info.result === 'FAILED' || (info.receipt?.result !== undefined && info.receipt.result !== 'SUCCESS')) return { state: 'failed' };

  const token = tronHex(def.usdt.contract)!;
  const to = addressHex('TRON', input.toAddress);
  let received = 0n;
  let otherTokenToUs = false;
  for (const log of info.log ?? []) {
    const topics = log.topics ?? [];
    if (topics.length !== 3 || topics[0]!.toLowerCase() !== TRANSFER_TOPIC) continue;
    if (topics[2]!.slice(-40).toLowerCase() !== to) continue;
    const contract = (log.address ?? '').toLowerCase().replace(/^41(?=[0-9a-f]{40}$)/, '');
    if (contract !== token) {
      otherTokenToUs = true;
      continue;
    }
    if (!/^[0-9a-fA-F]{64}$/.test(log.data ?? '')) continue;
    received += BigInt(`0x${log.data}`);
  }
  if (received === 0n) return { state: 'mismatch', reason: otherTokenToUs ? 'wrong_token' : 'wrong_recipient' };
  const receivedMicro = toMicro(received, def.usdt.decimals);
  if (!matchesExpected(receivedMicro, input.expectedMicro)) return { state: 'mismatch', reason: 'wrong_amount', receivedMicro };
  if (typeof info.blockTimeStamp !== 'number') return { state: 'unavailable' };
  const blockTime = new Date(info.blockTimeStamp);
  const outside = judgeWindow(blockTime, input);
  if (outside) return { state: 'mismatch', reason: outside, receivedMicro };
  const out = { receivedMicro, confirmations: solid ? def.confirmations : 0, required: def.confirmations, blockTime };
  return solid ? { state: 'confirmed', ...out } : { state: 'pending', ...out };
}

const safe = async (fn: () => Promise<VerifyResult>): Promise<VerifyResult> => {
  try {
    return await fn();
  } catch (err) {
    console.error('[crypto] node query failed:', err instanceof Error ? err.message : err);
    return { state: 'unavailable' };
  }
};

export async function verifyTransfer(input: VerifyInput): Promise<VerifyResult> {
  const def = NETWORKS[input.network];
  if (def.kind === 'tron') return safe(() => verifyTron(input));
  const urls = rpcUrls(input.network);
  return combine(await Promise.all(urls.map((u) => safe(() => verifyEvmOn(u, def, input)))), Math.min(2, urls.length));
}
