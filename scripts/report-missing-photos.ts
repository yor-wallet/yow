/**
 * Missing photos, for the store owner (owner's specification §4 and §7):
 *
 *   npm run catalogue:photos:missing     # Markdown on standard output
 *
 * A colour is "covered" when a photo is attached to one of its variants (it serves every capacity of
 * that colour, whatever the spelling of its name) or when the product has a general photo. Published
 * products come first: those are the pages where a customer reads "image not available".
 */
import { prisma } from '@/lib/db';
import { readImportMeta } from '@/lib/admin/catalogue-import';

try {
  process.loadEnvFile?.('.env');
} catch {
  /* no .env: rely on the environment */
}

const norm = (s: string | null) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

async function main() {
  const products = await prisma.product.findMany({
    orderBy: [{ brand: { name: 'asc' } }, { model: 'asc' }],
    select: {
      slug: true,
      model: true,
      name: true,
      status: true,
      importMeta: true,
      brand: { select: { name: true } },
      variants: { where: { isActive: true }, orderBy: { sort: 'asc' }, select: { color: true } },
      images: { select: { variantId: true, variant: { select: { color: true } } } },
    },
  });
  const meta = (p: (typeof products)[number]) => {
    const m = readImportMeta(p.importMeta);
    return m?.toVerify ?? m?.specsStatus ?? 'Prices and stock.';
  };
  const label = (p: (typeof products)[number]) => (p.name as { en?: string } | null)?.en ?? p.model ?? p.slug;
  const rows = products.map((p) => {
    const colours = [...new Map(p.variants.filter((v) => v.color).map((v) => [norm(v.color), v.color!])).values()];
    const general = p.images.some((i) => i.variantId === null);
    const photographed = new Set(p.images.map((i) => norm(i.variant?.color ?? null)).filter(Boolean));
    const missing = general ? [] : colours.filter((c) => !photographed.has(norm(c)));
    return { p, colours, missing, none: p.images.length === 0 };
  });

  const active = rows.filter((r) => r.p.status === 'ACTIVE');
  const complete = active.filter((r) => !r.none && r.missing.length === 0);
  const partial = active.filter((r) => !r.none && r.missing.length > 0);
  const without = active.filter((r) => r.none);
  const drafts = rows.filter((r) => r.p.status === 'DRAFT' && !r.none);

  const out: string[] = [];
  out.push(`Published products: ${active.length} — complete: ${complete.length}, some colours without photo: ${partial.length}, no photo at all: ${without.length}.`, '');
  out.push('### Published, colours without photo', '');
  if (partial.length === 0) out.push('None.');
  else {
    out.push('| Product | Colours without photo |', '|---|---|');
    for (const r of partial) out.push(`| ${label(r.p)} | ${r.missing.join(', ')} |`);
  }
  out.push('', '### Published, no photo at all', '');
  if (without.length === 0) out.push('None.');
  else {
    out.push('| Product | Colours sold |', '|---|---|');
    for (const r of without) out.push(`| ${label(r.p)} | ${r.colours.join(', ') || '—'} |`);
  }
  out.push('', '### Drafts that already have photos (not visible to customers yet)', '');
  if (drafts.length === 0) out.push('None.');
  else {
    out.push('| Product | Photos | Still to confirm |', '|---|---|---|');
    for (const r of drafts) out.push(`| ${label(r.p)} | ${r.p.images.length} | ${meta(r.p)} |`);
  }
  console.log(out.join('\n'));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
