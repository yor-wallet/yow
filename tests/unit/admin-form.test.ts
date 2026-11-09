/** FormData → raw input of the admin schemas: empty means absent, numbers never silently become 0. */
import { describe, expect, it } from 'vitest';
import { indexesOf, intOrNull, lines, productFormToRaw, variantFormToRaw } from '@/lib/admin/form';
import { productInputSchema, variantInputSchema } from '@/lib/admin/products';

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.append(k, v);
  return fd;
}

describe('admin form helpers', () => {
  it('reads integers strictly and lines without blanks', () => {
    expect(intOrNull(form({ n: '12' }), 'n')).toBe(12);
    expect(intOrNull(form({ n: '' }), 'n')).toBeNull();
    expect(intOrNull(form({}), 'n')).toBeNull();
    expect(Number.isNaN(intOrNull(form({ n: '12.5' }), 'n'))).toBe(true);
    expect(Number.isNaN(intOrNull(form({ n: 'abc' }), 'n'))).toBe(true);
    expect(lines(form({ h: ' one \r\n\r\n two\nthree  ' }), 'h')).toEqual(['one', 'two', 'three']);
    expect(indexesOf(form({ 'specs.2.key': 'a', 'specs.0.key': 'b', 'specs.0.label.en': 'c', 'other.1.key': 'd' }), 'specs')).toEqual([0, 2]);
  });

  it('builds a valid product input and turns empty boxes into "absent"', () => {
    const raw = productFormToRaw(
      form({
        sku: 'e2e-1',
        slug: '',
        'name.en': 'Phone',
        'name.ar': '',
        'name.fr': '',
        'description.en': 'Nice',
        'highlights.en': 'Fast\n\nLight',
        model: '  ',
        brandId: '',
        categoryId: 'cat1',
        warrantyMonths: '12',
        weightGrams: '',
        'specs.0.key': 'color',
        'specs.0.label.en': 'Colour',
        'specs.0.value.en': 'Blue',
        'specs.1.key': '',
        'specs.1.label.en': '',
        isSellable: 'on',
      }),
    );
    expect(raw).toMatchObject({ slug: undefined, brandId: null, model: null, weightGrams: null, warrantyMonths: 12, isSellable: true, isFeatured: false, expressEligible: false });
    expect((raw.specs as unknown[]).length).toBe(1); // the untouched second row is ignored
    const parsed = productInputSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.sku).toBe('E2E-1'); // upper-cased by the schema
      expect(parsed.data.highlights.en).toEqual(['Fast', 'Light']);
      expect(parsed.data.brandId).toBeNull();
    }
  });

  it('reports a missing name, a missing category and a bad number with codes the UI can translate', () => {
    const parsed = productInputSchema.safeParse(productFormToRaw(form({ sku: 'X1', categoryId: '', warrantyMonths: 'abc' })));
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const byPath = Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message]));
      expect(byPath.name).toBe('required');
      expect(byPath.categoryId).toBe('required');
      expect(byPath.warrantyMonths).toBe('invalid');
    }
  });

  it('keeps prices as text for the OMR parser and never invents stock', () => {
    const ok = variantInputSchema.safeParse(variantFormToRaw(form({ productId: 'p1', sku: 'v-1', price: '129.5', compareAt: '', cost: '', stock: '7', isActive: 'on', sort: '3' })));
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data).toMatchObject({ sku: 'V-1', price: 129_500, compareAt: null, cost: null, stock: 7, isActive: true, isDefault: false, sort: 3 });

    const noStock = variantInputSchema.safeParse(variantFormToRaw(form({ productId: 'p1', sku: 'v-1', stock: '' })));
    expect(noStock.success).toBe(false);
    if (!noStock.success) expect(noStock.error.issues.find((i) => i.path[0] === 'stock')?.message).toBe('required');

    const badPrice = variantInputSchema.safeParse(variantFormToRaw(form({ productId: 'p1', sku: 'v-1', stock: '1', price: '12.3456' })));
    expect(badPrice.success).toBe(false);
    if (!badPrice.success) expect(badPrice.error.issues.find((i) => i.path[0] === 'price')?.message).toBe('amount_invalid');
  });
});
