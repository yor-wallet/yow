import { cn } from '@/lib/cn';

/**
 * Decorative HUD corner brackets. Place inside a `relative` container:
 * `<div className="relative"><HudCorners />…</div>`. Colour follows `text-*` (default cyan).
 */
export function HudCorners({ className, size = 14 }: { className?: string; size?: number }) {
  const s = { width: size, height: size };
  const base = 'absolute border-current';
  return (
    <span aria-hidden="true" className={cn('pointer-events-none absolute inset-0 text-cyan/70', className)}>
      <span className={cn(base, 'start-0 top-0 rounded-ss-[10px] border-s-2 border-t-2')} style={s} />
      <span className={cn(base, 'end-0 top-0 rounded-se-[10px] border-e-2 border-t-2')} style={s} />
      <span className={cn(base, 'bottom-0 start-0 rounded-es-[10px] border-b-2 border-s-2')} style={s} />
      <span className={cn(base, 'bottom-0 end-0 rounded-ee-[10px] border-b-2 border-e-2')} style={s} />
    </span>
  );
}
