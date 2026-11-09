import { defineAgent } from '../framework';
import { AGENT_INTERVALS } from '../schedule';
import { localizedMissing, nameOf, top } from '../util';

/**
 * 2 · Catalogue — quality of ACTIVE products: missing images, empty specs, missing
 * translations (name/description in ar/en/fr) and active products without any price.
 */
export default defineAgent({
  key: 'catalogue',
  number: 2,
  nameKey: 'catalogue',
  scopes: ['product', 'productVariant', 'productImage'],
  schedule: { everyMinutes: AGENT_INTERVALS.catalogue },
  async run(ctx) {
    const products = await ctx.db.product.findMany({
      where: { status: 'ACTIVE' },
      select: {
        id: true,
        slug: true,
        sku: true,
        name: true,
        description: true,
        specs: true,
        _count: { select: { images: true } },
        variants: { where: { isActive: true }, select: { id: true, priceBaisa: true } },
      },
      take: 5000,
    });
    ctx.metric('activeProducts', products.length);

    const item = (p: (typeof products)[number], extra: Record<string, unknown> = {}) => ({ id: p.id, sku: p.sku, slug: p.slug, name: nameOf(p.name), ...extra });
    const noImages = products.filter((p) => p._count.images === 0);
    const noSpecs = products.filter((p) => !Array.isArray(p.specs) || p.specs.length === 0);
    const missingTr = products
      .map((p) => ({ p, missing: [...new Set([...localizedMissing(p.name), ...(p.description ? localizedMissing(p.description) : ['ar', 'en', 'fr'])])] }))
      .filter((x) => x.missing.length > 0);
    const noPrice = products.filter((p) => !p.variants.some((v) => v.priceBaisa != null));

    if (noPrice.length) {
      ctx.propose({
        severity: 'HIGH',
        titleKey: 'catalogue.noPrice',
        params: { count: noPrice.length },
        title: `${noPrice.length} active product(s) have no priced variant`,
        details: { items: top(noPrice.map((p) => item(p))) },
        fingerprint: 'no-price',
      });
    }
    if (noImages.length) {
      ctx.propose({
        severity: 'MEDIUM',
        titleKey: 'catalogue.noImages',
        params: { count: noImages.length },
        title: `${noImages.length} active product(s) have no image`,
        details: { items: top(noImages.map((p) => item(p))) },
        fingerprint: 'no-images',
      });
    }
    if (noSpecs.length) {
      ctx.propose({
        severity: 'LOW',
        titleKey: 'catalogue.noSpecs',
        params: { count: noSpecs.length },
        title: `${noSpecs.length} active product(s) have no specifications`,
        details: { items: top(noSpecs.map((p) => item(p))) },
        fingerprint: 'no-specs',
      });
    }
    if (missingTr.length) {
      ctx.propose({
        severity: 'LOW',
        titleKey: 'catalogue.missingTranslations',
        params: { count: missingTr.length },
        title: `${missingTr.length} active product(s) miss translations`,
        details: { items: top(missingTr.map((x) => item(x.p, { missing: x.missing }))) },
        fingerprint: 'missing-translations',
      });
    }
    ctx.metric('issues', noImages.length + noSpecs.length + missingTr.length + noPrice.length);
  },
});
