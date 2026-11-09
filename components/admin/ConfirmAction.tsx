'use client';

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import { Button, type ButtonProps } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { useHistoryModal } from '@/components/ui/useHistoryModal';
import type { ActionState } from '@/lib/admin/action';
import { useAdminAction } from './useAdminAction';

/**
 * A destructive admin action behind an explicit confirmation dialog (Back closes the dialog first).
 * `fields` become hidden inputs of the form sent to `action`.
 */
export function ConfirmAction({
  action,
  fields,
  label,
  title,
  text,
  confirmLabel,
  testId,
  variant = 'outline',
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  fields: Record<string, string>;
  label: string;
  title: string;
  text?: string;
  confirmLabel: string;
  testId: string;
  variant?: ButtonProps['variant'];
}) {
  const t = useTranslations('common.actions');
  const formId = useId();
  const modal = useHistoryModal();
  const { formAction, pending } = useAdminAction(action, { onSuccess: () => modal.close() });
  return (
    <>
      <Button type="button" variant={variant} size="sm" onClick={modal.open} data-testid={testId}>
        {label}
      </Button>
      <Modal
        {...modal.props}
        title={title}
        description={text}
        footer={
          <div className="flex flex-wrap justify-end gap-3">
            <Button type="button" variant="ghost" onClick={modal.close}>
              {t('cancel')}
            </Button>
            <Button type="submit" form={formId} variant="danger" loading={pending} data-testid={`${testId}-confirm`}>
              {confirmLabel}
            </Button>
          </div>
        }
      >
        <form id={formId} action={formAction}>
          {Object.entries(fields).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
        </form>
      </Modal>
    </>
  );
}
