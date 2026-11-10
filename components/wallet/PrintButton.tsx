'use client';

import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/Button';

export function PrintButton({ label }: { label: string }) {
  return (
    <Button type="button" variant="primary" onClick={() => window.print()} leadingIcon={<Printer size={18} aria-hidden="true" />} data-testid="receipt-print">
      {label}
    </Button>
  );
}
