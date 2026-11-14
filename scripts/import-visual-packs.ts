/**
 * Attaches the product photos of the packs under data/catalogue (studio photos of the iPhone range
 * and the photos supplied by the owner) to their products, so the storefront shows real photos.
 *
 *   npm run catalogue:photos                        # as the first SUPERADMIN (ADMIN_EMAIL)
 *   npm run catalogue:photos -- --publish           # also publish the models sold as shown (one finish, no size to choose)
 *   npm run catalogue:photos -- --publish --system  # unattended (first deployment)
 *   npm run catalogue:photos -- --bundled           # no upload: reference the photos shipped in public/photos (no storage credentials needed)
 *
 * Idempotent: a photo already attached is never added twice. No price and no stock is ever written;
 * a published model without a price shows "price coming soon" and cannot be bought.
 * Run it after `catalogue:import`, which creates the verified models these photos belong to.
 */
import { prisma } from '@/lib/db';
import type { Actor } from '@/lib/admin/actor';
import { setProductStatus } from '@/lib/admin/products';
import { VISUAL_PACKS, importVisualPackModel, loadVisualPack } from '@/lib/admin/visual-pack-import';
import { staffActor, systemActor } from './system-actor';

try {
  process.loadEnvFile?.('.env');
} catch {
  /* no .env: rely on the environment */
}

async function main() {
  const args = process.argv.slice(2);
  const publish = args.includes('--publish');
  const system = args.includes('--system');
  const bundled = args.includes('--bundled');
  const actor: Actor | null = system ? await systemActor() : await staffActor();
  if (!actor) throw new Error('No ADMIN/SUPERADMIN user found: run `npm run db:seed` with ADMIN_EMAIL / ADMIN_PASSWORD first, or pass --system.');

  try {
    const total = { products: 0, variants: 0, images: 0, published: 0 };
    for (const def of VISUAL_PACKS) {
      const pack = await loadVisualPack(def.key);
      for (const [index, model] of pack.models.entries()) {
        const step = await importVisualPackModel(actor, def.key, index, { bundled });
        total.products += step.productCreated ? 1 : 0;
        total.variants += step.variantsCreated;
        total.images += step.imagesCreated;
        if (publish && model.single_variant) {
          const product = await prisma.product.findUnique({ where: { id: step.productId }, select: { status: true } });
          if (product?.status === 'DRAFT') {
            await setProductStatus(actor, { id: step.productId, status: 'ACTIVE' });
            total.published++;
          }
        }
      }
    }
    console.log('[photos]', JSON.stringify(total));
  } finally {
    // The system account keeps no staff role once the import is over.
    if (system) await prisma.user.update({ where: { id: actor.id }, data: { role: 'CUSTOMER' } });
  }
}

main()
  .catch((e) => {
    console.error('[photos] failed:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
