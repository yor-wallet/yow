import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

type CardProps = HTMLAttributes<HTMLDivElement> & {
  /** `surface` (default), `glass`, `gradient` (gradient border), `premium` (dark premium gradient). */
  tone?: 'surface' | 'glass' | 'gradient' | 'premium';
  interactive?: boolean;
  padded?: boolean;
};

const tones = {
  surface: 'bg-surface border border-border shadow-card',
  glass: 'glass shadow-card',
  gradient: 'gradient-border shadow-card',
  premium: 'bg-gradient-premium border border-border text-white shadow-float',
} as const;

export function Card({ tone = 'surface', interactive, padded = true, className, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-card',
        tones[tone],
        padded && 'p-4 sm:p-5',
        interactive &&
          'transition-[transform,box-shadow,border-color] duration-(--dur-card) ease-premium hover:-translate-y-0.5 hover:border-border-strong hover:shadow-glow-blue',
        className,
      )}
      {...rest}
    />
  );
}
