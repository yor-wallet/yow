'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { useHistoryModal } from '@/components/ui/useHistoryModal';
import { useToast } from '@/components/ui/Toast';
import { useRouter } from '@/i18n/navigation';
import { cancelOrderAction } from '@/app/[locale]/orders/actions';

/** Cancel an unpaid order after an explicit confirmation (Back closes the dialog first). */
export function CancelOrderButton({ number }: { number: string }) {
  const t = useTranslations('orders.detail');
  const router = useRouter();
  const { toast } = useToast();
  const modal = useHistoryModal('cancel-order');
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);

  const confirm = () =>
    start(async () => {
      const res = await cancelOrderAction(number);
      if (res.ok) {
        modal.closeThen(() => {
          toast({ title: t('cancelled'), variant: 'success' });
          router.refresh();
        });
      } else {
        setFailed(true);
      }
    });

  return (
    <>
      <Button type="button" variant="outline" onClick={modal.open} data-testid="cancel-order">
        {t('cancel')}
      </Button>
      <Modal
        {...modal.props}
        title={t('cancelTitle')}
        description={t('cancelText')}
        footer={
          <div className="flex flex-wrap justify-end gap-3">
            <Button type="button" variant="ghost" onClick={modal.close}>
              {t('cancelKeep')}
            </Button>
            <Button type="button" variant="danger" loading={pending} onClick={confirm} data-testid="confirm-cancel">
              {t('cancelConfirm')}
            </Button>
          </div>
        }
      >
        {failed ? (
          <p role="alert" className="text-sm font-medium text-error">
            {t('cancelFailed')}
          </p>
        ) : null}
      </Modal>
    </>
  );
}
