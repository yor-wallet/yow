import type { ReactNode } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { BackButton } from '@/components/layout/BackButton';

/** Shared frame for auth pages: sticky back header on mobile, back link + centered glass card on desktop. */
export function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div>
      <PageHeader title={title} fallbackHref="/" mobileOnly />
      <div className="page-container flex justify-center py-6 sm:py-10 lg:py-14">
        <div className="w-full max-w-md">
          <div className="mb-3 hidden lg:block">
            <BackButton fallbackHref="/" variant="text" className="-ms-3" />
          </div>
          <div className="rounded-[28px] glass p-5 shadow-float sm:p-8">
            {/* On mobile the sticky PageHeader carries the <h1>. */}
            <h1 className="mb-1.5 hidden text-3xl font-extrabold lg:block">{title}</h1>
            <p className="text-sm text-muted">{subtitle}</p>
            <div className="mt-6">{children}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
