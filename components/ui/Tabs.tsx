'use client';

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type TabItem = { id: string; label: ReactNode; content: ReactNode; disabled?: boolean };

/**
 * Accessible tabs (WAI-ARIA): roving tabindex, Arrow keys follow reading direction
 * (mirrored in RTL), Home/End. Controlled (`value` + `onChange`) or uncontrolled.
 * The tab list scrolls horizontally on small screens (marked data-scroll-x).
 */
export function Tabs({
  items,
  value,
  defaultValue,
  onChange,
  label,
  className,
}: {
  items: TabItem[];
  value?: string;
  defaultValue?: string;
  onChange?: (id: string) => void;
  label: string;
  className?: string;
}) {
  const baseId = useId();
  const [internal, setInternal] = useState(defaultValue ?? items[0]?.id);
  const active = value ?? internal;
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  const select = (id: string) => {
    if (value === undefined) setInternal(id);
    onChange?.(id);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const enabled = items.filter((i) => !i.disabled);
    const idx = enabled.findIndex((i) => i.id === active);
    if (idx < 0) return;
    const rtl = getComputedStyle(e.currentTarget).direction === 'rtl';
    let next: number | null = null;
    if (e.key === 'ArrowRight') next = rtl ? idx - 1 : idx + 1;
    else if (e.key === 'ArrowLeft') next = rtl ? idx + 1 : idx - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = enabled.length - 1;
    if (next === null) return;
    e.preventDefault();
    const target = enabled[(next + enabled.length) % enabled.length]!;
    select(target.id);
    refs.current[target.id]?.focus();
  };

  return (
    <div className={cn('min-w-0', className)}>
      <div
        role="tablist"
        aria-label={label}
        onKeyDown={onKeyDown}
        data-scroll-x
        className="scrollbar-none flex gap-1 overflow-x-auto rounded-2xl border border-border bg-surface p-1"
      >
        {items.map((item) => {
          const selected = item.id === active;
          return (
            <button
              key={item.id}
              ref={(el) => {
                refs.current[item.id] = el;
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${item.id}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${item.id}`}
              tabIndex={selected ? 0 : -1}
              disabled={item.disabled}
              onClick={() => select(item.id)}
              className={cn(
                'min-h-11 shrink-0 rounded-xl px-4 text-sm font-semibold transition-colors duration-(--dur-btn)',
                selected ? 'bg-gradient-primary text-on-accent shadow-glow-blue' : 'text-muted hover:bg-surface-2 hover:text-fg',
                'disabled:opacity-50',
              )}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      {items.map((item) => (
        <div
          key={item.id}
          role="tabpanel"
          id={`${baseId}-panel-${item.id}`}
          aria-labelledby={`${baseId}-tab-${item.id}`}
          hidden={item.id !== active}
          tabIndex={0}
          className="mt-4 focus-visible:outline-offset-4"
        >
          {item.id === active ? item.content : null}
        </div>
      ))}
    </div>
  );
}
