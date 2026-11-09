import { cn } from '@/lib/cn';

/** Accessible spinner. Pass `label` when it is the only content (otherwise it is decorative). */
export function Spinner({ className, label, size = 18 }: { className?: string; label?: string; size?: number }) {
  return (
    <span role={label ? 'status' : undefined} className={cn('inline-flex items-center', className)}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        className="animate-spin motion-reduce:animate-[spin_1.5s_linear_infinite]"
      >
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  );
}
