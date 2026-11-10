'use client';

import { Moon, Sun } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import { useTheme } from './ThemeProvider';

/** `onDark`: for the always-dark mobile header band (white icon on translucent hover). */
export function ThemeToggle({ className, tone = 'auto' }: { className?: string; tone?: 'auto' | 'onDark' }) {
  const { theme, toggle } = useTheme();
  const t = useTranslations('common.theme');
  const label = theme === 'dark' ? t('toLight') : t('toDark');
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      data-testid="theme-toggle"
      className={cn(
        'grid size-11 place-items-center rounded-xl transition-colors duration-(--dur-btn)',
        tone === 'onDark' ? 'text-white hover:bg-white/10' : 'text-fg hover:bg-surface-2',
        className,
      )}
    >
      {theme === 'dark' ? <Sun size={20} aria-hidden="true" /> : <Moon size={20} aria-hidden="true" />}
    </button>
  );
}
