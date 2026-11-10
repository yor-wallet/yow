import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

const SIZES = { sm: 'size-9 rounded-xl', md: 'size-11 rounded-xl', lg: 'size-12 rounded-2xl' } as const;
const ICON = { sm: 16, md: 20, lg: 24 } as const;
const TONES = {
  // Light theme: tinted tile + AA blue icon. Dark theme: premium night tile with a cyan neon icon.
  blue: 'bg-blue/10 text-accent ring-1 ring-inset ring-blue/15 dark:bg-gradient-premium dark:text-cyan dark:ring-cyan/20 dark:neon-box',
  orange: 'bg-orange/10 text-orange ring-1 ring-inset ring-orange/20 dark:bg-gradient-premium dark:text-amber dark:ring-amber/25',
  success: 'bg-success/10 text-success ring-1 ring-inset ring-success/20',
  error: 'bg-error/10 text-error ring-1 ring-inset ring-error/20',
  amber: 'bg-amber/15 text-orange ring-1 ring-inset ring-amber/30 dark:text-amber',
  muted: 'bg-surface-2 text-muted',
} as const;

export type IconTileTone = keyof typeof TONES;

/** Theme-aware icon tile used at the start of cards, list rows and section titles. */
export function IconTile({
  icon: Icon,
  size = 'md',
  tone = 'blue',
  className,
  children,
}: {
  icon: LucideIcon;
  size?: keyof typeof SIZES;
  tone?: IconTileTone;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <span className={cn('relative grid shrink-0 place-items-center', SIZES[size], TONES[tone], className)}>
      <Icon size={ICON[size]} aria-hidden="true" />
      {children}
    </span>
  );
}
