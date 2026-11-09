import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The admin layout draws the shell for staff only and does not redirect by itself, so each page MUST guard
 * itself with `requireAdmin(permission, '/its/path')`. A page without it would be readable by anyone.
 */
const ADMIN_DIR = path.resolve(__dirname, '../../app/[locale]/admin');

function pages(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return pages(full);
    return e.name === 'page.tsx' ? [full] : [];
  });
}

describe('admin pages', () => {
  const files = pages(ADMIN_DIR);

  it('finds the admin pages', () => {
    expect(files.length).toBeGreaterThanOrEqual(6);
  });

  it.each(files.map((f) => [path.relative(ADMIN_DIR, f), f]))('%s guards itself with requireAdmin', (_name, file) => {
    const src = fs.readFileSync(file, 'utf8');
    expect(src).toMatch(/await requireAdmin\(\s*'[a-z]+:[a-z]+'\s*,/);
  });

  it('server actions only run mutations (RBAC lives in defineMutation) or are guarded explicitly', () => {
    const actions = fs.readFileSync(path.join(ADMIN_DIR, 'products/actions.ts'), 'utf8');
    // Every action goes through runAdminAction(mutation, …) or the image action, which calls the guarded addProductImage(actor, …).
    const exported = [...actions.matchAll(/export async function (\w+)/g)].map((m) => m[1]);
    expect(exported.length).toBeGreaterThanOrEqual(7);
    for (const name of exported) {
      const body = actions.slice(actions.indexOf(`export async function ${name}`));
      const end = body.indexOf('\nexport async function', 10);
      const fn = end === -1 ? body : body.slice(0, end);
      expect(fn, name).toMatch(/runAdminAction\(|addProductImage\(/);
    }
  });
});
