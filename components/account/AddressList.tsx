'use client';

import { useState, useTransition } from 'react';
import { MapPin, Pencil, Phone, Star, Trash2, Navigation } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { Badge } from '@/components/ui/Badge';
import { Button, buttonClasses } from '@/components/ui/Button';
import { Modal, useHistoryModal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { localize } from '@/lib/localized';
import { deleteAddressAction, setDefaultAddressAction, type SavedAddress } from './address-actions';

/** Address book cards with set-default and delete (history-backed confirm modal). */
export function AddressList({ addresses }: { addresses: SavedAddress[] }) {
  const t = useTranslations('account.addresses');
  const locale = useLocale();
  const router = useRouter();
  const { toast } = useToast();
  const modal = useHistoryModal('delete-address');
  const [target, setTarget] = useState<SavedAddress | null>(null);
  const [pending, start] = useTransition();

  const makeDefault = (id: string) =>
    start(async () => {
      const res = await setDefaultAddressAction(id);
      toast({ title: res.ok ? t('defaultSet') : t('actionFailed'), variant: res.ok ? 'success' : 'error' });
      router.refresh();
    });

  const confirmDelete = () =>
    start(async () => {
      if (!target) return;
      const res = await deleteAddressAction(target.id);
      toast({ title: res.ok ? t('deleted') : t('actionFailed'), variant: res.ok ? 'success' : 'error' });
      modal.closeThen(() => router.refresh());
    });

  return (
    <>
      <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3" data-testid="address-list">
        {addresses.map((a) => (
          <li key={a.id} className="flex min-w-0 flex-col rounded-card border border-border bg-surface p-4 shadow-card sm:p-5" data-testid="address-card">
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-premium text-cyan">
                  <MapPin size={18} aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="truncate font-semibold">{a.label || a.recipientName}</p>
                  {a.label ? <p className="truncate text-sm text-muted">{a.recipientName}</p> : null}
                </div>
              </div>
              {a.isDefault ? (
                <Badge variant="primary" className="shrink-0">
                  {t('default')}
                </Badge>
              ) : null}
            </div>
            <address className="mt-3 flex-1 text-sm not-italic leading-relaxed text-muted">
              <span className="block text-fg">
                {a.building}
                {a.street ? `, ${a.street}` : ''}
              </span>
              <span className="block">
                {a.area}, {localize(a.wilayaName, locale)}, {localize(a.governorateName, locale)}
              </span>
              <span className="mt-1 flex items-center gap-1.5">
                <Phone size={14} aria-hidden="true" />
                <span dir="ltr">{a.phone}</span>
              </span>
              {a.lat != null && a.lng != null ? (
                <span className="mt-1 flex items-center gap-1.5 text-success">
                  <Navigation size={14} aria-hidden="true" />
                  {t('gps')}
                </span>
              ) : null}
            </address>
            <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-3">
              <Link href={`/account/addresses/${a.id}`} className={buttonClasses({ variant: 'outline', size: 'sm' })}>
                <Pencil size={16} aria-hidden="true" />
                {t('edit')}
              </Link>
              {!a.isDefault ? (
                <Button variant="ghost" size="sm" onClick={() => makeDefault(a.id)} disabled={pending} leadingIcon={<Star size={16} aria-hidden="true" />}>
                  {t('makeDefault')}
                </Button>
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                className="ms-auto text-error"
                onClick={() => {
                  setTarget(a);
                  modal.open();
                }}
                leadingIcon={<Trash2 size={16} aria-hidden="true" />}
                data-testid="address-delete"
              >
                {t('delete')}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <Modal
        {...modal.props}
        title={t('deleteTitle')}
        description={t('deleteText')}
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={modal.close} disabled={pending}>
              {t('form.cancel')}
            </Button>
            <Button variant="danger" onClick={confirmDelete} loading={pending} data-testid="address-delete-confirm">
              {t('deleteConfirm')}
            </Button>
          </div>
        }
      >
        {target ? (
          <p className="text-sm">
            <span className="font-semibold">{target.label || target.recipientName}</span> — {target.area}, {localize(target.wilayaName, locale)}
          </p>
        ) : null}
      </Modal>
    </>
  );
}
