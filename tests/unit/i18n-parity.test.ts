import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { NAMESPACES } from '@/i18n/namespaces';
import { locales } from '@/i18n/routing';

const ROOT = path.resolve(__dirname, '../../messages');

function load(locale: string, ns: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(ROOT, locale, `${ns}.json`), 'utf8')) as Record<string, unknown>;
}

/** Flatten nested keys: { a: { b: 'x' } } → ['a.b'] */
function keys(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' && !Array.isArray(v) ? keys(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

function placeholders(value: string): string[] {
  // top-level ICU argument names: {name}, {count, plural, ...}
  const out = new Set<string>();
  let depth = 0;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c === '{') {
      if (depth === 0) {
        const m = /^\{\s*([A-Za-z_][\w]*)/.exec(value.slice(i));
        if (m?.[1]) out.add(m[1]);
      }
      depth++;
    } else if (c === '}') depth--;
  }
  return [...out].sort();
}

function get(obj: Record<string, unknown>, dotted: string): unknown {
  return dotted.split('.').reduce<unknown>((acc, k) => (acc as Record<string, unknown> | undefined)?.[k], obj);
}

describe('i18n message files', () => {
  it('has a file for every namespace in every locale (and nothing else)', () => {
    for (const locale of locales) {
      for (const ns of NAMESPACES) {
        expect(existsSync(path.join(ROOT, locale, `${ns}.json`)), `${locale}/${ns}.json`).toBe(true);
      }
      const files = readdirSync(path.join(ROOT, locale)).filter((f) => f.endsWith('.json'));
      expect(files.sort()).toEqual(NAMESPACES.map((n) => `${n}.json`).sort());
    }
  });

  for (const ns of NAMESPACES) {
    it(`"${ns}": en, ar and fr define exactly the same keys`, () => {
      const en = keys(load('en', ns)).sort();
      for (const other of ['ar', 'fr']) {
        const ok = keys(load(other, ns)).sort();
        const missing = en.filter((k) => !ok.includes(k));
        const extra = ok.filter((k) => !en.includes(k));
        expect(missing, `keys in en/${ns} missing from ${other}/${ns}`).toEqual([]);
        expect(extra, `keys in ${other}/${ns} missing from en/${ns}`).toEqual([]);
      }
    });

    it(`"${ns}": placeholders match across locales and no value is empty`, () => {
      const en = load('en', ns);
      for (const key of keys(en)) {
        const enValue = get(en, key);
        expect(typeof enValue === 'string' && enValue.trim().length > 0, `en/${ns}:${key} empty`).toBe(true);
        for (const other of ['ar', 'fr']) {
          const v = get(load(other, ns), key);
          expect(typeof v === 'string' && v.trim().length > 0, `${other}/${ns}:${key} empty`).toBe(true);
          expect(placeholders(v as string), `${other}/${ns}:${key} placeholders`).toEqual(placeholders(enValue as string));
        }
      }
    });
  }

  it('Arabic copy is written in Arabic script (not transliterated)', () => {
    for (const ns of NAMESPACES) {
      const ar = load('ar', ns);
      for (const key of keys(ar)) {
        const v = String(get(ar, key));
        // Brand names / pure placeholders may be Latin; real sentences must contain Arabic letters.
        if (v.split(/\s+/).length >= 3 && !/^[\s{}A-Za-z0-9|,.()/-]*$/.test(v.replace(/DOOM|BTC|ETH|USDT|USDC|AES-256-GCM|OMR/g, ''))) {
          expect(v, `ar/${ns}:${key}`).toMatch(/[\u0600-\u06FF]/);
        }
      }
    }
  });
});
