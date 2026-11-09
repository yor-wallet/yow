'use client';

import { useState } from 'react';
import { Inbox } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Price } from '@/components/ui/Price';
import { Skeleton, SkeletonText } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input, PasswordInput, Checkbox } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Modal, useHistoryModal } from '@/components/ui/Modal';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Tabs } from '@/components/ui/Tabs';
import { Stepper } from '@/components/ui/Stepper';
import { Spinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { Reveal } from '@/components/ui/Reveal';
import { Logo } from '@/components/ui/Logo';

/* Internal gallery — demo values only (never shown to customers). */
export function UiKitDemo() {
  const modal = useHistoryModal('kit-modal');
  const sheet = useHistoryModal('kit-sheet');
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  return (
    <div className="page-container mt-6 grid grid-cols-1 gap-6 pb-10 lg:mt-8">
      <Card>
        <h2 className="mb-4 font-bold">Logo</h2>
        <div className="flex flex-wrap items-center gap-6">
          <Logo height={40} />
          <Logo variant="emblem" height={48} />
          <span className="rounded-xl bg-night p-3">
            <Logo surface="dark" height={32} />
          </span>
          <span className="rounded-xl bg-snow p-3">
            <Logo surface="light" height={32} />
          </span>
        </div>
      </Card>

      <Card>
        <h2 className="mb-4 font-bold">Buttons</h2>
        <div className="flex flex-wrap gap-3">
          <Button>Primary</Button>
          <Button variant="accent">Accent</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button
            loading={loading}
            onClick={() => {
              setLoading(true);
              setTimeout(() => setLoading(false), 1200);
            }}
          >
            Loading state
          </Button>
          <Spinner label="Loading" />
        </div>
      </Card>

      <Card>
        <h2 className="mb-4 font-bold">Badges & prices</h2>
        <div className="flex flex-wrap items-center gap-3">
          <Badge>Neutral</Badge>
          <Badge variant="info">Info</Badge>
          <Badge variant="success">Success</Badge>
          <Badge variant="warning">Warning</Badge>
          <Badge variant="error">Error</Badge>
          <Badge variant="primary">Primary</Badge>
          <Badge variant="secondary">Secondary</Badge>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-6" data-testid="kit-prices">
          <Price baisa={null} />
          <Price baisa={1_234_500} compareAtBaisa={1_399_000} showSavings size="lg" />
        </div>
      </Card>

      <Card>
        <h2 className="mb-4 font-bold">Form controls</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Input label="Input" placeholder="Placeholder" hint="Helper text" />
          <Input label="With error" error="This field is required." required />
          <PasswordInput label="Password" showLabel="Show" hideLabel="Hide" />
          <Select label="Select" defaultValue="" placeholder="Choose…">
            <option value="a">Option A</option>
            <option value="b">Option B</option>
          </Select>
          <Textarea label="Textarea" containerClassName="md:col-span-2" />
          <Checkbox label="Checkbox" />
        </div>
      </Card>

      <Card>
        <h2 className="mb-4 font-bold">Overlays & feedback</h2>
        <div className="flex flex-wrap gap-3">
          <Button onClick={modal.open} data-testid="open-modal">
            Open modal
          </Button>
          <Button variant="secondary" onClick={sheet.open} data-testid="open-sheet">
            Open bottom sheet
          </Button>
          <Button variant="ghost" onClick={() => toast({ title: 'Saved', description: 'Toast example', variant: 'success' })}>
            Toast
          </Button>
        </div>
      </Card>

      <Card>
        <h2 className="mb-4 font-bold">Tabs & stepper</h2>
        <Tabs
          label="Demo tabs"
          items={[
            { id: 'one', label: 'Specifications', content: <SkeletonText lines={3} /> },
            { id: 'two', label: 'Delivery', content: <Skeleton className="h-24" /> },
            { id: 'three', label: 'Reviews', content: <p className="text-muted">Third panel</p> },
          ]}
        />
        <Stepper className="mt-6" steps={['Cart', 'Address', 'Delivery', 'Payment']} current={1} />
      </Card>

      <Reveal>
        <EmptyState icon={<Inbox size={26} />} title="Empty state" description="Shown instead of fake data." />
      </Reveal>

      <Modal
        {...modal.props}
        title="Modal title"
        description="Back button closes this dialog first."
        footer={
          <>
            <Button variant="ghost" onClick={modal.close}>
              Cancel
            </Button>
            <Button onClick={modal.close}>Confirm</Button>
          </>
        }
      >
        <p className="text-muted">Modal body with internal scroll when content is long.</p>
      </Modal>

      <BottomSheet {...sheet.props} title="Bottom sheet">
        <div className="grid grid-cols-1 gap-3">
          <Input label="Field inside sheet" />
          <SkeletonText lines={6} />
        </div>
      </BottomSheet>
    </div>
  );
}
