/**
 * USDT paid straight to the shop's wallet addresses: address validation, exact amounts, the on-chain checks
 * (with the three networks' real response shapes, mocked), the node quorum, and the whole payment flow —
 * a customer's transfer pays THEIR payment once, only when final, and never anyone else's.
 * Runs against PostgreSQL (doom_test). Like the other money tests, the customers and ledger rows stay (the
 * ledger is append-only); everything is uniquely named (`onchain-…`) and balanced.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { prisma } from '@/lib/db';
import { isValidEvmAddress, isValidTronAddress, keccak256, toChecksumAddress, tronHex } from '@/lib/payments/onchain/address';
import { OFFSET_SLOTS, baseCents, expectedMicro, formatUsdt, matchesExpected } from '@/lib/payments/onchain/amount';
import { NETWORKS, configuredNetworks, maskAddress, rpcUrls } from '@/lib/payments/onchain/networks';
import { combine, normalizeTxHash, verifyTransfer, type VerifyInput, type VerifyResult } from '@/lib/payments/onchain/verify';
import { startTopUp } from '@/lib/payments/core';
import { readCryptoMeta } from '@/lib/payments/crypto-meta';
import { submitCryptoTransaction } from '@/lib/payments/crypto-submit';
import { getBalance } from '@/lib/wallet/ledger';

const TRON_SHOP = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'; // a valid Tron address (test only)
const EVM_SHOP = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'; // EIP-55 test vector (test only)
const TRANSFER = 'ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const pad64 = (h: string) => h.padStart(64, '0');

describe('addresses', () => {
  it('Keccak-256 matches the reference vectors', () => {
    expect(hex(keccak256(''))).toBe('c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
    expect(hex(keccak256('abc'))).toBe('4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45');
    expect(hex(keccak256('a'.repeat(300)))).toHaveLength(64); // more than one block
  });

  it('EVM: a configured address needs a correct EIP-55 checksum', () => {
    for (const a of ['0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed', '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359', '0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB']) expect(isValidEvmAddress(a)).toBe(true);
    expect(isValidEvmAddress('0x5aaeb6053F3E94C9b9A09f33669435E7Ef1BeAed')).toBe(false); // one letter's case changed
    expect(isValidEvmAddress(EVM_SHOP.toLowerCase())).toBe(false); // no checksum: refused for payouts…
    expect(isValidEvmAddress(EVM_SHOP.toLowerCase(), true)).toBe(true); // …fine for looking up an address found on chain
    expect(isValidEvmAddress('0x123')).toBe(false);
    expect(toChecksumAddress(EVM_SHOP.toLowerCase())).toBe(EVM_SHOP);
    // The three official USDT contracts are intact.
    expect(isValidEvmAddress(NETWORKS.ETH.usdt.contract)).toBe(true);
    expect(isValidEvmAddress(NETWORKS.BSC.usdt.contract)).toBe(true);
    expect(isValidTronAddress(NETWORKS.TRON.usdt.contract)).toBe(true);
  });

  it('Tron: base58check, version byte and length', () => {
    expect(isValidTronAddress(TRON_SHOP)).toBe(true);
    expect(tronHex(TRON_SHOP)).toBe('a614f803b6fd780986a42c78ec9c7f77e6ded13c');
    expect(isValidTronAddress(TRON_SHOP.slice(0, -1) + 'k')).toBe(false); // one character changed
    expect(isValidTronAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')).toBe(false);
    expect(isValidTronAddress('')).toBe(false);
  });

  it('configuration: an address that fails its checksum switches the network off', () => {
    expect(configuredNetworks({ CRYPTO_ADDRESS_TRON: TRON_SHOP, CRYPTO_ADDRESS_BSC: EVM_SHOP })).toEqual([
      { id: 'TRON', address: TRON_SHOP },
      { id: 'BSC', address: EVM_SHOP },
    ]);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(configuredNetworks({ CRYPTO_ADDRESS_TRON: TRON_SHOP.slice(0, -1) + 'k', CRYPTO_ADDRESS_ETH: '0x5aaeb6053F3E94C9b9A09f33669435E7Ef1BeAed' })).toEqual([]);
    spy.mockRestore();
    expect(maskAddress(EVM_SHOP)).toBe('0x5aAe…eAed');
    expect(rpcUrls('BSC', {})).toHaveLength(3);
    expect(rpcUrls('BSC', { CRYPTO_RPC_BSC: 'https://a.example, http://insecure.example , https://b.example' })).toEqual(['https://a.example', 'https://b.example']);
  });
});

describe('exact amounts', () => {
  it('converts at the Omani rial peg (1 OMR = 2.6008 USD), rounding the cents UP', () => {
    expect(baseCents(1_000)).toBe(261); // 1.000 OMR = 2.6008 USD → 2.61
    expect(baseCents(349_900)).toBe(91_002); // 910.0199 → 910.02
    expect(baseCents(5_000)).toBe(1_301); // 13.004 → 13.01
    expect(() => baseCents(0)).toThrow();
  });
  it('one amount per payment: cents + a 4-decimal slot, matched to the 4th decimal', () => {
    expect(expectedMicro(349_900, 0)).toBe(910_020_000);
    expect(expectedMicro(349_900, 37)).toBe(910_023_700);
    expect(formatUsdt(expectedMicro(349_900, 37))).toBe('910.0237');
    expect(formatUsdt(expectedMicro(1_000, 5))).toBe('2.6105');
    expect(OFFSET_SLOTS).toBe(100);
    expect(() => expectedMicro(1_000, 100)).toThrow();
    const exp = expectedMicro(1_000, 5);
    expect(matchesExpected(exp, exp)).toBe(true);
    expect(matchesExpected(exp + 99, exp)).toBe(true);
    expect(matchesExpected(exp + 100, exp)).toBe(false); // that is the next slot's amount
    expect(matchesExpected(exp - 1, exp)).toBe(false);
  });
  it('transaction ids are canonical per network', () => {
    const h = 'ab'.repeat(32);
    expect(normalizeTxHash('BSC', h)).toBe(`0x${h}`);
    expect(normalizeTxHash('ETH', `0x${h.toUpperCase()}`)).toBe(`0x${h}`);
    expect(normalizeTxHash('TRON', `0x${h}`)).toBe(h);
    expect(normalizeTxHash('TRON', 'abc')).toBeNull();
    expect(normalizeTxHash('BSC', `${h}zz`)).toBeNull();
  });
});

// ------------------------------------------------------------------ chain responses (real shapes, mocked)
const HASH = `0x${'12'.repeat(32)}`;
const T0 = new Date('2026-11-14T12:00:00Z');
const input = (over: Partial<VerifyInput> = {}): VerifyInput => ({
  network: 'BSC',
  txHash: HASH,
  toAddress: EVM_SHOP,
  expectedMicro: 38_451_700,
  notBefore: new Date(T0.getTime() - 60_000),
  notAfter: new Date(T0.getTime() + 3_600_000),
  ...over,
});

type Chain = { receipt: unknown; blockTime?: Date; head?: number };
function evmReceipt(opts: { to?: string; token?: string; units: bigint; status?: string; block?: number }) {
  return {
    status: opts.status ?? '0x1',
    blockNumber: `0x${(opts.block ?? 1000).toString(16)}`,
    logs: [
      { address: (opts.token ?? NETWORKS.BSC.usdt.contract).toLowerCase(), topics: [`0x${TRANSFER}`, `0x${pad64('abc')}`, `0x${pad64((opts.to ?? EVM_SHOP).slice(2).toLowerCase())}`], data: `0x${pad64(opts.units.toString(16))}` },
    ],
  };
}
function stubEvm(chains: Record<string, Chain | 'down'>) {
  vi.stubGlobal('fetch', async (url: string, init: { body: string }) => {
    const chain = chains[new URL(url).host] ?? chains['*'];
    if (!chain || chain === 'down') return { ok: false, status: 503, json: async () => ({}) };
    const { method } = JSON.parse(init.body) as { method: string };
    const result =
      method === 'eth_getTransactionReceipt' ? chain.receipt : method === 'eth_getBlockByNumber' ? { timestamp: `0x${Math.floor((chain.blockTime ?? T0).getTime() / 1000).toString(16)}` } : `0x${(chain.head ?? 1020).toString(16)}`;
    return { ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 1, result }) };
  });
}
const BSC_38 = 38_451_700_000_000_000_000n; // 38.4517 with 18 decimals

describe('on-chain verification — BNB Smart Chain / Ethereum', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('confirmed: official USDT, our address, exact amount, in the window, final', async () => {
    stubEvm({ '*': { receipt: evmReceipt({ units: BSC_38 }) } });
    expect(await verifyTransfer(input())).toMatchObject({ state: 'confirmed', receivedMicro: 38_451_700, confirmations: 21, required: 15 });
  });
  it('Ethereum USDT has 6 decimals', async () => {
    stubEvm({ '*': { receipt: evmReceipt({ units: 38_451_700n, token: NETWORKS.ETH.usdt.contract }) } });
    expect(await verifyTransfer(input({ network: 'ETH' }))).toMatchObject({ state: 'confirmed', receivedMicro: 38_451_700, required: 12 });
  });
  it('pending until enough blocks are on top', async () => {
    stubEvm({ '*': { receipt: evmReceipt({ units: BSC_38 }), head: 1005 } });
    expect(await verifyTransfer(input())).toMatchObject({ state: 'pending', confirmations: 6, required: 15 });
  });
  it('rejects every transfer that is not exactly this payment', async () => {
    stubEvm({ '*': { receipt: evmReceipt({ units: BSC_38, to: '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359' }) } });
    expect(await verifyTransfer(input())).toEqual({ state: 'mismatch', reason: 'wrong_recipient' });
    stubEvm({ '*': { receipt: evmReceipt({ units: BSC_38, token: '0x1111111111111111111111111111111111111111' }) } });
    expect(await verifyTransfer(input())).toEqual({ state: 'mismatch', reason: 'wrong_token' });
    stubEvm({ '*': { receipt: evmReceipt({ units: 38_460_000_000_000_000_000n }) } }); // 38.46 ≠ 38.4517
    expect(await verifyTransfer(input())).toMatchObject({ state: 'mismatch', reason: 'wrong_amount', receivedMicro: 38_460_000 });
    stubEvm({ '*': { receipt: evmReceipt({ units: 38_451_600_000_000_000_000n }) } }); // one slot below
    expect(await verifyTransfer(input())).toMatchObject({ state: 'mismatch', reason: 'wrong_amount' });
    stubEvm({ '*': { receipt: evmReceipt({ units: BSC_38 }), blockTime: new Date(T0.getTime() - 3_600_000) } }); // an old transfer to our address
    expect(await verifyTransfer(input())).toMatchObject({ state: 'mismatch', reason: 'too_early' });
    stubEvm({ '*': { receipt: evmReceipt({ units: BSC_38 }), blockTime: new Date(T0.getTime() + 7_200_000) } });
    expect(await verifyTransfer(input())).toMatchObject({ state: 'mismatch', reason: 'too_late' });
  });
  it('failed and unknown transactions', async () => {
    stubEvm({ '*': { receipt: evmReceipt({ units: BSC_38, status: '0x0' }) } });
    expect(await verifyTransfer(input())).toEqual({ state: 'failed' });
    stubEvm({ '*': { receipt: null } });
    expect(await verifyTransfer(input())).toEqual({ state: 'not_found' });
  });
  it('2 of 3 nodes must agree: one broken node changes nothing, no quorum means "ask again"', async () => {
    const [a, b, c] = rpcUrls('BSC').map((u) => new URL(u).host);
    const good: Chain = { receipt: evmReceipt({ units: BSC_38 }) };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    stubEvm({ [a!]: good, [b!]: good, [c!]: 'down' });
    expect((await verifyTransfer(input())).state).toBe('confirmed');
    stubEvm({ [a!]: good, [b!]: 'down', [c!]: 'down' });
    expect((await verifyTransfer(input())).state).toBe('unavailable');
    stubEvm({ [a!]: good, [b!]: { receipt: null }, [c!]: good }); // one node lags: the two that saw it win
    expect((await verifyTransfer(input())).state).toBe('confirmed');
    stubEvm({ [a!]: good, [b!]: { receipt: evmReceipt({ units: 38_451_650_000_000_000_000n }) }, [c!]: 'down' }); // disagree on the amount
    expect((await verifyTransfer(input())).state).toBe('unavailable');
    spy.mockRestore();
  });
  it('combine(): a lone voice is never believed', () => {
    const c = (state: 'confirmed' | 'pending', confirmations: number): VerifyResult => ({ state, receivedMicro: 1, confirmations, required: 15, blockTime: T0 });
    expect(combine([c('confirmed', 30), { state: 'unavailable' }, { state: 'unavailable' }], 2)).toEqual({ state: 'unavailable' });
    expect(combine([c('confirmed', 30), c('pending', 5), { state: 'unavailable' }], 2)).toMatchObject({ state: 'pending', confirmations: 5 });
    expect(combine([c('confirmed', 30), c('confirmed', 20), { state: 'not_found' }], 2)).toMatchObject({ state: 'confirmed', confirmations: 20 });
    expect(combine([{ state: 'not_found' }, { state: 'not_found' }, c('confirmed', 30)], 2)).toEqual({ state: 'not_found' });
    expect(combine([c('confirmed', 30)], 1)).toMatchObject({ state: 'confirmed' });
  });
});

// ------------------------------------------------------------------ Tron
const TRON_TX = 'cd'.repeat(32);
function tronInfo(opts: { to?: string; contract?: string; micro: bigint; result?: string; at?: Date }) {
  return {
    id: TRON_TX,
    blockTimeStamp: (opts.at ?? T0).getTime(),
    receipt: { result: opts.result ?? 'SUCCESS' },
    log: [
      { address: opts.contract ?? tronHex(NETWORKS.TRON.usdt.contract)!, topics: [TRANSFER, pad64('abc'), pad64(opts.to ?? tronHex(TRON_SHOP)!)], data: pad64(opts.micro.toString(16)) },
    ],
  };
}
function stubTron(handlers: { solidity?: unknown; full?: unknown }) {
  vi.stubGlobal('fetch', async (url: string) => {
    const info = url.includes('/walletsolidity/') ? handlers.solidity : handlers.full;
    return { ok: true, status: 200, json: async () => info ?? {} };
  });
}
const tronInput = (over: Partial<VerifyInput> = {}): VerifyInput => ({ network: 'TRON', txHash: TRON_TX, toAddress: TRON_SHOP, expectedMicro: 38_451_700, notBefore: new Date(T0.getTime() - 60_000), notAfter: new Date(T0.getTime() + 3_600_000), ...over });

describe('on-chain verification — Tron', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('confirmed once the solidity node knows it; pending while only the full node does', async () => {
    stubTron({ solidity: tronInfo({ micro: 38_451_700n }) });
    expect(await verifyTransfer(tronInput())).toMatchObject({ state: 'confirmed', receivedMicro: 38_451_700 });
    stubTron({ full: tronInfo({ micro: 38_451_700n }) });
    expect(await verifyTransfer(tronInput())).toMatchObject({ state: 'pending', receivedMicro: 38_451_700 });
    stubTron({});
    expect(await verifyTransfer(tronInput())).toEqual({ state: 'not_found' });
  });
  it('rejects the wrong recipient, token, amount, failed calls and out-of-window transfers', async () => {
    stubTron({ solidity: tronInfo({ micro: 38_451_700n, to: 'a'.repeat(40) }) });
    expect(await verifyTransfer(tronInput())).toEqual({ state: 'mismatch', reason: 'wrong_recipient' });
    stubTron({ solidity: tronInfo({ micro: 38_451_700n, contract: 'b'.repeat(40) }) });
    expect(await verifyTransfer(tronInput())).toEqual({ state: 'mismatch', reason: 'wrong_token' });
    stubTron({ solidity: tronInfo({ micro: 40_000_000n }) });
    expect(await verifyTransfer(tronInput())).toMatchObject({ state: 'mismatch', reason: 'wrong_amount' });
    stubTron({ solidity: tronInfo({ micro: 38_451_700n, result: 'REVERT' }) });
    expect(await verifyTransfer(tronInput())).toEqual({ state: 'failed' });
    stubTron({ solidity: tronInfo({ micro: 38_451_700n, at: new Date(T0.getTime() - 86_400_000) }) });
    expect(await verifyTransfer(tronInput())).toMatchObject({ state: 'mismatch', reason: 'too_early' });
  });
  it('an unreachable node means "ask again", never "paid"', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 429, json: async () => ({}) }));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await verifyTransfer(tronInput())).toEqual({ state: 'unavailable' });
    spy.mockRestore();
  });
});

// ------------------------------------------------------------------ the whole payment flow
const ENV_KEYS = ['CRYPTO_ADDRESS_TRON', 'CRYPTO_ADDRESS_BSC', 'CRYPTO_ADDRESS_ETH'] as const;
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const SETTINGS_KEYS = ['crypto.enabled', 'crypto.requireKyc'];
let seq = 0;
const RUN = `onchain-${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;

async function user() {
  return prisma.user.create({
    data: { email: `${RUN}-${++seq}@test.doom.local`, fullName: 'Onchain Tester', passwordHash: 'x'.repeat(60), phone: `+9687${String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0')}` },
    select: { id: true },
  });
}
const startUsdt = async (userId: string, baisa = 5_000) => {
  const r = await startTopUp(userId, 'CRYPTO', baisa, randomBytes(16).toString('hex'));
  if (r.status !== 'pending') throw new Error(`unexpected ${r.status}`);
  const intent = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: r.intentId } });
  return { intent, meta: readCryptoMeta(intent.metadata)! };
};
/** The chain says: this transaction paid `micro` to the shop (solidified). */
const chainPays = (txid: string, micro: number, at = new Date()) => stubTron({ solidity: { ...tronInfo({ micro: BigInt(micro), at }), id: txid } });

describe('the payment flow', () => {
  beforeAll(async () => {
    process.env.CRYPTO_ADDRESS_TRON = TRON_SHOP;
    delete process.env.CRYPTO_ADDRESS_BSC;
    delete process.env.CRYPTO_ADDRESS_ETH;
    await prisma.setting.deleteMany({ where: { key: { in: SETTINGS_KEYS } } });
    await prisma.setting.createMany({ data: [{ key: 'crypto.enabled', value: 1 }, { key: 'crypto.requireKyc', value: 0 }] });
  });
  afterEach(() => vi.unstubAllGlobals());
  afterAll(async () => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    await prisma.setting.deleteMany({ where: { key: { in: SETTINGS_KEYS } } });
    await prisma.$disconnect();
  });

  it('a payment gets the exact amount, the addresses shown to the customer and a one-hour window', async () => {
    const u = await user();
    const { intent, meta } = await startUsdt(u.id, 5_000);
    expect(intent.status).toBe('PENDING');
    expect(intent.providerRef).toBe(`crypto:${intent.id}`);
    expect(meta).toMatchObject({ token: 'USDT', baseCents: 1_301, addresses: { TRON: TRON_SHOP } });
    expect(meta.expectedMicro).toBe(1_301 * 10_000 + meta.slot * 100);
    expect(meta.amountUsdt).toBe(formatUsdt(meta.expectedMicro));
    // One hour to SEND; the payment then stays open a day for the customer to give the transaction id.
    expect(new Date(meta.paymentExpiresAt).getTime() - Date.now()).toBeGreaterThan(55 * 60_000);
    expect(new Date(meta.paymentExpiresAt).getTime() - Date.now()).toBeLessThan(61 * 60_000);
    expect(intent.expiresAt!.getTime() - Date.now()).toBeGreaterThan(24 * 60 * 60_000);
  });

  it('two open payments for the same price never share an amount', async () => {
    const u = await user();
    const slots = new Set<number>();
    for (let i = 0; i < 12; i++) slots.add((await startUsdt(u.id, 7_000)).meta.slot);
    expect(slots.size).toBe(12);
  }, 60_000);

  it('a matching final transfer pays the payment once: the wallet is credited, a second claim is refused', async () => {
    const u = await user();
    const { intent, meta } = await startUsdt(u.id, 5_000);
    const txid = randomBytes(32).toString('hex');
    chainPays(txid, meta.expectedMicro);
    const res = await submitCryptoTransaction({ intentId: intent.id, userId: u.id, network: 'TRON', txHash: txid });
    expect(res).toEqual({ ok: true, state: 'confirmed' });
    const paid = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: intent.id } });
    expect(paid).toMatchObject({ status: 'SUCCEEDED', confirmedAmountBaisa: 5_000, providerRef: `TRON:${txid}` });
    expect((await getBalance(u.id)).balanceBaisa).toBe(5_000);
    // The same transfer again (same payment): nothing more is credited.
    expect(await submitCryptoTransaction({ intentId: intent.id, userId: u.id, network: 'TRON', txHash: txid })).toEqual({ ok: true, state: 'confirmed' });
    expect((await getBalance(u.id)).balanceBaisa).toBe(5_000);
    // Another customer cannot claim that transaction for their own payment.
    const other = await user();
    const second = await startUsdt(other.id, 5_000);
    chainPays(txid, second.meta.expectedMicro);
    const claim = await submitCryptoTransaction({ intentId: second.intent.id, userId: other.id, network: 'TRON', txHash: txid });
    expect(claim).toEqual({ ok: false, error: 'tx_already_used' });
    expect((await getBalance(other.id)).balanceBaisa).toBe(0);
  }, 60_000);

  it("someone else's transfer (another amount) never pays this payment and is reported to finance", async () => {
    const u = await user();
    const { intent, meta } = await startUsdt(u.id, 5_000);
    const txid = randomBytes(32).toString('hex');
    chainPays(txid, meta.expectedMicro + 5_000_000); // 5 USDT more: that is somebody else's payment
    const res = await submitCryptoTransaction({ intentId: intent.id, userId: u.id, network: 'TRON', txHash: txid });
    expect(res).toMatchObject({ ok: false, error: 'wrong_amount' });
    expect((await prisma.paymentIntent.findUniqueOrThrow({ where: { id: intent.id } })).status).toBe('PENDING');
    expect((await prisma.paymentIntent.findUniqueOrThrow({ where: { id: intent.id } })).providerRef).toBe(`crypto:${intent.id}`); // nothing was bound
    expect(await prisma.agentProposal.count({ where: { agentKey: 'payments', details: { path: ['paymentIntentId'], equals: intent.id } } })).toBeGreaterThan(0);
    expect((await getBalance(u.id)).balanceBaisa).toBe(0);
  }, 60_000);

  it('a transfer that is not final yet is bound and waits; unknown ids, other customers and other networks are refused', async () => {
    const u = await user();
    const { intent, meta } = await startUsdt(u.id, 5_000);
    const txid = randomBytes(32).toString('hex');
    stubTron({ full: { ...tronInfo({ micro: BigInt(meta.expectedMicro), at: new Date() }), id: txid } }); // only the full node: not irreversible yet
    expect(await submitCryptoTransaction({ intentId: intent.id, userId: u.id, network: 'TRON', txHash: txid })).toMatchObject({ ok: true, state: 'pending' });
    const bound = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: intent.id } });
    expect(bound.status).toBe('PENDING');
    expect(bound.providerRef).toBe(`TRON:${txid}`);
    expect(readCryptoMeta(bound.metadata)?.tx).toMatchObject({ network: 'TRON', hash: txid });
    expect(bound.expiresAt!.getTime() - Date.now()).toBeGreaterThan(5 * 60 * 60_000); // time to reach finality
    // A different transaction cannot be attached while this one is pending.
    expect(await submitCryptoTransaction({ intentId: intent.id, userId: u.id, network: 'TRON', txHash: randomBytes(32).toString('hex') })).toEqual({ ok: false, error: 'already_has_transfer' });
    // Later the network finalises it: the normal refresh (poll / cron) credits the payment.
    chainPays(txid, meta.expectedMicro);
    const { refreshPaymentIntent } = await import('@/lib/payments/core');
    expect((await refreshPaymentIntent(intent.id, 'test')).status).toBe('SUCCEEDED');
    expect((await getBalance(u.id)).balanceBaisa).toBe(5_000);

    const mine = await startUsdt(u.id, 5_000);
    const stranger = await user();
    expect(await submitCryptoTransaction({ intentId: mine.intent.id, userId: stranger.id, network: 'TRON', txHash: randomBytes(32).toString('hex') })).toEqual({ ok: false, error: 'not_found' });
    expect(await submitCryptoTransaction({ intentId: mine.intent.id, userId: u.id, network: 'BSC', txHash: randomBytes(32).toString('hex') })).toEqual({ ok: false, error: 'network_unavailable' });
    expect(await submitCryptoTransaction({ intentId: mine.intent.id, userId: u.id, network: 'TRON', txHash: 'not-a-hash' })).toEqual({ ok: false, error: 'invalid_input' });
    stubTron({}); // the chain does not know it
    expect(await submitCryptoTransaction({ intentId: mine.intent.id, userId: u.id, network: 'TRON', txHash: randomBytes(32).toString('hex') })).toEqual({ ok: false, error: 'tx_not_found' });
  }, 90_000);
});
