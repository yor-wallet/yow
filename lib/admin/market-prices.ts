import 'server-only';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { assertCan, type Actor } from './actor';

/**
 * Market prices file (data/catalogue/market-prices-*.json): the public price of an authorised Omani
 * reseller for a model × capacity, the DOOM price derived from it (owner's rule: market − 10 %, rounded
 * down to 0.100 OMR) and the source. Applying it writes the DOOM price on the matching variants:
 * by default only where no price is set yet, so a price chosen by staff is never overwritten.
 * Stock is never touched; nothing is published.
 */
const item = z.object({
  productSlug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  /** null = every variant of the product (accessories sold in one size). */
  storageGb: z.number().int().positive().nullable(),
  marketBaisa: z.number().int().positive(),
  priceBaisa: z.number().int().positive(),
  source: z.string().min(1),
  note: z.string().optional(),
});

const fileSchema = z.object({
  retrievedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  discountPercent: z.number().min(0).max(50),
  sources: z.record(z.object({ name: z.string(), url: z.string().url() }).passthrough()),
  items: z.array(item).min(1),
});

export type MarketPrices = z.infer<typeof fileSchema>;

/** DOOM price for a market price: − discount, rounded DOWN to the 0.100 OMR (100 baisa). */
export function doomPrice(marketBaisa: number, discountPercent: number): number {
  return Math.floor((marketBaisa * (100 - discountPercent)) / 100 / 100) * 100;
}

export async function loadMarketPrices(file = 'market-prices-2026-11.json'): Promise<MarketPrices> {
  const raw = await fs.readFile(path.join(process.cwd(), 'data', 'catalogue', file), 'utf8');
  const doc = fileSchema.parse(JSON.parse(raw));
  for (const it of doc.items) {
    if (!doc.sources[it.source]) throw new Error(`Unknown source ${it.source}`);
    if (it.priceBaisa !== doomPrice(it.marketBaisa, doc.discountPercent)) throw new Error(`Price of ${it.productSlug} ${it.storageGb ?? ''} does not follow the rule`);
  }
  return doc;
}

export type MarketPriceResult = { variantsPriced: number; variantsKept: number; missingProducts: string[] };

export async function applyMarketPrices(actor: Actor | null | undefined, doc: MarketPrices, opts: { overwrite?: boolean } = {}): Promise<MarketPriceResult> {
  assertCan(actor, 'prices:write');
  const out: MarketPriceResult = { variantsPriced: 0, variantsKept: 0, missingProducts: [] };
  const bySlug = new Map<string, MarketPrices['items']>();
  for (const it of doc.items) bySlug.set(it.productSlug, [...(bySlug.get(it.productSlug) ?? []), it]);

  for (const [slug, items] of bySlug) {
    const product = await prisma.product.findUnique({ where: { slug }, select: { id: true, variants: { select: { id: true, storageGb: true, priceBaisa: true } } } });
    if (!product) {
      out.missingProducts.push(slug);
      continue;
    }
    const changes: { variantId: string; before: number | null; after: number }[] = [];
    for (const v of product.variants) {
      const it = items.find((i) => i.storageGb === null || i.storageGb === v.storageGb);
      if (!it) continue;
      if (v.priceBaisa !== null && !opts.overwrite) {
        out.variantsKept++;
        continue;
      }
      if (v.priceBaisa === it.priceBaisa) continue;
      changes.push({ variantId: v.id, before: v.priceBaisa, after: it.priceBaisa });
    }
    if (changes.length === 0) continue;
    await prisma.$transaction(changes.map((c) => prisma.productVariant.update({ where: { id: c.variantId }, data: { priceBaisa: c.after } })));
    out.variantsPriced += changes.length;
    await logAudit({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'catalogue.prices.market',
      entity: 'Product',
      entityId: product.id,
      after: { rule: `market - ${doc.discountPercent}%`, retrievedAt: doc.retrievedAt, changes },
      ip: null,
      userAgent: null,
    });
  }
  return out;
}
