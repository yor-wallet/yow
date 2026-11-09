'use client';

import { Moon, Sun } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import { useTheme } from './ThemeProvider';

export function ThemeToggle({ className }: { className?: string }) {
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
        'grid size-11 place-items-center rounded-xl text-fg transition-colors duration-(--dur-btn) hover:bg-surface-2',
        className,
      )}
    >
      {theme === 'dark' ? <Sun size={20} aria-hidden="true" /> : <Moon size={20} aria-hidden="true" />}
    </button>
  );
}
