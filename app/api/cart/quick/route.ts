import { apiHandler, json } from '@/lib/http';
import { asLocale } from '@/i18n/routing';
import { getCartView } from '@/lib/cart';

/**
 * Quick-cart drawer data (specification §3): only what the drawer shows. Private to the visitor (cart cookie
 * or session): never cached by a shared cache (`json()` sends no-store).
 */
export const GET = apiHandler(async (req) => {
  const locale = asLocale(new URL(req.url).searchParams.get('locale'));
  const cart = await getCartView(locale);
  return json({
    lines: cart.lines.map((l) => ({
      itemId: l.itemId,
      slug: l.slug,
      name: l.name,
      variantLabel: l.variantLabel,
      image: l.image,
      qty: l.allowedQty,
      max: Math.max(1, Math.min(l.available, 10)),
      unitPriceBaisa: l.unitPriceBaisa,
      lineTotalBaisa: l.lineTotalBaisa,
      state: l.state,
    })),
    totals: { subtotalBaisa: cart.totals.subtotalBaisa, discountBaisa: cart.totals.discountBaisa, totalBaisa: cart.totals.totalBaisa, itemCount: cart.totals.itemCount, checkoutReady: cart.totals.checkoutReady },
  });
});
