'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, LayoutGrid } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { localize } from '@/lib/localized';
import type { NavCategory } from '@/lib/nav';
import { CategoryIcon } from '@/components/ui/CategoryIcon';
import { cn } from '@/lib/cn';

/**
 * Desktop categories bar with mega-menu dropdowns (hover with intent delay, click,
 * keyboard: Enter/Space/ArrowDown open, Escape closes). Data comes from the DB.
 */
export function MegaMenu({ categories }: { categories: NavCategory[] }) {
  const t = useTranslations('nav');
  const locale = useLocale();
  const pathname = usePathname();
  const [openId, setOpenId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navRef = useRef<HTMLElement>(null);
  const baseId = useId();

  useEffect(() => setOpenId(null), [pathname]);

  useEffect(() => {
    if (!openId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const id = openId;
        setOpenId(null);
        document.getElementById(`${baseId}-trigger-${id}`)?.focus();
      }
    };
    const onDown = (e: MouseEvent) => {
      if (!navRef.current?.contains(e.target as Node)) setOpenId(null);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [openId, baseId]);

  const hoverOpen = (id: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpenId(id), 120);
  };
  const hoverClose = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpenId(null), 160);
  };

  // "All categories" panel shows every top-level category with its children.
  const items: { id: string; label: string; icon: string | null; href: string; groups: NavCategory[] }[] = [
    { id: 'all', label: t('allCategories'), icon: null, href: '/categories', groups: categories },
    ...categories.map((c) => ({ id: c.id, label: localize(c.name, locale), icon: c.icon, href: `/category/${c.slug}`, groups: [c] })),
  ];

  return (
    <nav ref={navRef} aria-label={t('categoryMenu')} className="relative">
      <ul className="flex items-center gap-1">
        {items.map((item) => {
          const open = openId === item.id;
          const panelId = `${baseId}-panel-${item.id}`;
          return (
            <li key={item.id} onMouseEnter={() => hoverOpen(item.id)} onMouseLeave={hoverClose}>
              <button
                id={`${baseId}-trigger-${item.id}`}
                type="button"
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => setOpenId(open ? null : item.id)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setOpenId(item.id);
                    setTimeout(() => document.querySelector<HTMLElement>(`#${CSS.escape(panelId)} a`)?.focus(), 0);
                  }
                }}
                className={cn(
                  'inline-flex h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold transition-colors duration-(--dur-btn)',
                  open ? 'bg-surface-2 text-fg' : 'text-muted hover:bg-surface-2 hover:text-fg',
                  item.id === 'all' && 'text-fg',
                )}
              >
                {item.id === 'all' ? <LayoutGrid size={18} aria-hidden="true" className="text-cyan" /> : <CategoryIcon name={item.icon} size={17} />}
                {item.label}
                <ChevronDown size={16} aria-hidden="true" className={cn('transition-transform duration-(--dur-btn)', open && 'rotate-180')} />
              </button>
              <div
                id={panelId}
                hidden={!open}
                className="absolute inset-x-0 top-full z-50 pt-2"
                onMouseEnter={() => hoverOpen(item.id)}
                onMouseLeave={hoverClose}
              >
                <div className="animate-fade-in rounded-card border border-border bg-surface p-5 shadow-float">
                  <div className={cn('grid gap-6', item.groups.length > 1 ? 'grid-cols-4' : 'grid-cols-1')}>
                    {item.groups.map((group) => (
                      <div key={group.id} className="min-w-0">
                        <Link
                          href={`/category/${group.slug}`}
                          className="mb-2 inline-flex min-h-11 items-center gap-2 rounded-lg font-bold text-fg hover:text-accent"
                        >
                          <span className="grid size-8 place-items-center rounded-lg bg-gradient-premium text-cyan">
                            <CategoryIcon name={group.icon} size={16} />
                          </span>
                          {item.groups.length > 1 ? localize(group.name, locale) : t('viewAllIn', { name: localize(group.name, locale) })}
                        </Link>
                        <ul className={cn('grid gap-0.5', item.groups.length === 1 && 'grid-cols-4 gap-x-6')}>
                          {group.children.map((child) => (
                            <li key={child.id}>
                              <Link
                                href={`/category/${child.slug}`}
                                className="flex min-h-10 items-center rounded-lg px-2 text-sm text-muted transition-colors duration-(--dur-btn) hover:bg-surface-2 hover:text-fg"
                              >
                                {localize(child.name, locale)}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
