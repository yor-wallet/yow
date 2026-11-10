'use client';

import { useActionState, useEffect, useRef, useTransition } from 'react';
import { LogOut, Monitor, Smartphone, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { PasswordInput } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { Badge } from '@/components/ui/Badge';
import { Modal, useHistoryModal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { useValidationMessage } from '@/components/ui/useValidationMessage';
import {
  changePasswordAction,
  requestAccountDeletionAction,
  revokeOtherSessionsAction,
  revokeSessionAction,
  type PasswordFormState,
} from '@/app/[locale]/account/security/actions';

export function ChangePasswordForm() {
  const t = useTranslations('account.security');
  const vm = useValidationMessage();
  const { toast } = useToast();
  const [state, action] = useActionState(changePasswordAction, { status: 'idle' } as PasswordFormState);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.status === 'ok') {
      ref.current?.reset();
      toast({ title: t('passwordChanged'), variant: 'success' });
    }
  }, [state, t, toast]);
  const err = (f: string) => {
    const code = state.fieldErrors?.[f]?.[0];
    if (code === 'wrong_password' || code === 'password_same') return t(`errors.${code}`);
    return vm(code);
  };
  return (
    <form ref={ref} action={action} className="grid grid-cols-1 gap-4" data-testid="password-form" noValidate>
      <PasswordInput name="currentPassword" label={t('currentPassword')} autoComplete="current-password" required showLabel={t('show')} hideLabel={t('hide')} error={err('currentPassword')} />
      <PasswordInput
        name="newPassword"
        label={t('newPassword')}
        hint={t('newPasswordHint')}
        autoComplete="new-password"
        required
        showLabel={t('show')}
        hideLabel={t('hide')}
        error={err('newPassword')}
      />
      <PasswordInput name="confirmPassword" label={t('confirmPassword')} autoComplete="new-password" required showLabel={t('show')} hideLabel={t('hide')} error={err('confirmPassword')} />
      {state.status === 'error' && (state.error === 'rate_limited' || state.error === 'generic') ? (
        <p role="alert" className="text-sm font-medium text-error">
          {t(`errors.${state.error}`)}
        </p>
      ) : null}
      <div className="flex justify-end">
        <SubmitButton data-testid="password-submit">{t('changePassword')}</SubmitButton>
      </div>
    </form>
  );
}

export type SessionView = { id: string; device: string; mobile: boolean; ip: string | null; lastActive: string; signedIn: string; current: boolean };

export function SessionList({ sessions }: { sessions: SessionView[] }) {
  const t = useTranslations('account.security');
  const router = useRouter();
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const others = sessions.filter((s) => !s.current);
  const revoke = (id: string) =>
    start(async () => {
      const res = await revokeSessionAction(id);
      toast({ title: res.ok ? t('revoked') : t('errors.generic'), variant: res.ok ? 'success' : 'error' });
      router.refresh();
    });
  const revokeOthers = () =>
    start(async () => {
      const res = await revokeOtherSessionsAction();
      toast({ title: res.ok ? t('revokedOthers', { count: res.count }) : t('errors.generic'), variant: res.ok ? 'success' : 'error' });
      router.refresh();
    });
  return (
    <div>
      <ul className="flex flex-col gap-2.5" data-testid="session-list">
        {sessions.map((s) => {
          const Icon = s.mobile ? Smartphone : Monitor;
          return (
            <li key={s.id} className="flex min-w-0 flex-wrap items-center gap-3 rounded-2xl border border-border bg-surface/70 p-3.5" data-testid="session-item">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-premium text-cyan">
                <Icon size={18} aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-semibold">
                  <span className="min-w-0 break-words">{s.device}</span>
                  {s.current ? <Badge variant="success">{t('thisDevice')}</Badge> : null}
                </p>
                <p className="text-xs text-muted">
                  {t('lastActive', { date: s.lastActive })} · {t('signedIn', { date: s.signedIn })}
                  {s.ip ? (
                    <>
                      {' · '}
                      <span dir="ltr">{t('ip', { ip: s.ip })}</span>
                    </>
                  ) : null}
                </p>
              </div>
              {!s.current ? (
                <Button variant="ghost" size="sm" onClick={() => revoke(s.id)} disabled={pending} leadingIcon={<LogOut size={16} aria-hidden="true" className="flip-rtl" />}>
                  {t('revoke')}
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {others.length ? (
        <Button variant="outline" size="sm" className="mt-3" onClick={revokeOthers} loading={pending} data-testid="sessions-revoke-others">
          {t('revokeOthers')}
        </Button>
      ) : (
        <p className="mt-3 text-sm text-muted">{t('noOtherSessions')}</p>
      )}
    </div>
  );
}

export function DeletionRequest({ pendingNumber }: { pendingNumber: string | null }) {
  const t = useTranslations('account.security');
  const tc = useTranslations('common.actions');
  const modal = useHistoryModal('delete-account');
  const router = useRouter();
  const { toast } = useToast();
  const [pending, start] = useTransition();
  if (pendingNumber) {
    return (
      <div className="rounded-xl border border-amber/50 bg-amber/10 p-3 text-sm" role="status" data-testid="deletion-pending">
        <p>{t('deletionPending', { number: pendingNumber })}</p>
        <Link href={`/account/support/${pendingNumber}`} className="mt-1 inline-flex min-h-11 items-center font-semibold text-accent underline-offset-4 hover:underline">
          {t('deletionView')}
        </Link>
      </div>
    );
  }
  const confirm = () =>
    start(async () => {
      const res = await requestAccountDeletionAction();
      toast({ title: res.ok ? t('deletionRequested') : t('errors.generic'), variant: res.ok ? 'success' : 'error' });
      modal.closeThen(() => router.refresh());
    });
  return (
    <>
      <Button variant="danger" onClick={modal.open} leadingIcon={<Trash2 size={18} aria-hidden="true" />} data-testid="deletion-request">
        {t('deletionButton')}
      </Button>
      <Modal
        {...modal.props}
        title={t('deletionConfirmTitle')}
        description={t('deletionConfirmText')}
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={modal.close} disabled={pending}>
              {tc('cancel')}
            </Button>
            <Button variant="danger" onClick={confirm} loading={pending} data-testid="deletion-confirm">
              {t('deletionConfirm')}
            </Button>
          </div>
        }
      />
    </>
  );
}
