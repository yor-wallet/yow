'use client';

import { useEffect, useId, useRef, useState, useTransition, type FormEvent } from 'react';
import { Camera, CircleAlert, PackageCheck, RotateCcw, Siren, Truck, XCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/Button';
import { Input, FieldShell, controlClasses } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Modal, useHistoryModal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { completeDeliveryAction, failDeliveryAction, reportIncidentAction, startDeliveryAction, type CourierActionResult } from '@/app/[locale]/courier/actions';
import { prepareImage, type PreparedImage } from './compress-image';
import { cn } from '@/lib/cn';

const INCIDENTS = ['DELAY', 'DAMAGE', 'ADDRESS_ISSUE', 'CUSTOMER_UNREACHABLE', 'OTP_FAILURE', 'LOST', 'OTHER'] as const;

function useErrorText() {
  const t = useTranslations('delivery');
  return (res: Extract<CourierActionResult, { ok: false }>) => {
    if (res.error === 'otp_invalid') return t('courier.attemptsLeft', { count: res.attemptsLeft ?? 0 });
    if (res.error === 'otp_locked') return t('courier.otpLocked');
    if (res.error === 'otp_expired') return t('courier.otpExpired');
    const key = `errors.${res.error}` as 'errors.generic';
    return t.has(key) ? t(key) : t('errors.generic');
  };
}

/** Best-effort position (2.5 s max) — never blocks the courier. */
function quickPosition(): Promise<{ lat?: number; lng?: number }> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve({});
    const timer = window.setTimeout(() => resolve({}), 2500);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        window.clearTimeout(timer);
        resolve({ lat: p.coords.latitude, lng: p.coords.longitude });
      },
      () => {
        window.clearTimeout(timer);
        resolve({});
      },
      { maximumAge: 60_000, timeout: 2500 },
    );
  });
}

export function StartDeliveryButton({ shipmentId }: { shipmentId: string }) {
  const t = useTranslations('delivery.courier');
  const errorText = useErrorText();
  const router = useRouter();
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const go = () =>
    start(async () => {
      const coords = await quickPosition();
      const res = await startDeliveryAction(shipmentId, coords);
      toast(res.ok ? { title: t('pickedUpDone'), variant: 'success' } : { title: errorText(res), variant: 'error' });
      router.refresh();
    });
  return (
    <Button size="lg" fullWidth onClick={go} loading={pending} leadingIcon={<Truck size={20} aria-hidden="true" />} data-testid="courier-start">
      {t('pickedUp')}
    </Button>
  );
}

export function HandoverForm({ shipmentId }: { shipmentId: string }) {
  const t = useTranslations('delivery.courier');
  const tk = useTranslations('kyc.errors');
  const errorText = useErrorText();
  const router = useRouter();
  const { toast } = useToast();
  const id = useId();
  const [otp, setOtp] = useState('');
  const [name, setName] = useState('');
  const [photo, setPhoto] = useState<PreparedImage | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [pending, start] = useTransition();
  useEffect(() => () => (photo ? URL.revokeObjectURL(photo.url) : undefined), [photo]);

  const onPhoto = async (file: File | undefined) => {
    if (!file) return;
    setPhotoError(null);
    setProcessing(true);
    try {
      const p = await prepareImage(file, { maxDimension: 1600 });
      setPhoto((prev) => {
        if (prev) URL.revokeObjectURL(prev.url);
        return p;
      });
    } catch (e) {
      const code = (e instanceof Error ? e.message : 'image_unreadable') as 'image_unreadable';
      setPhotoError(tk.has(code) ? tk(code) : tk('image_unreadable'));
    } finally {
      setProcessing(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!/^\d{6}$/.test(otp)) return setError(errorText({ ok: false, error: 'otp_format' }));
    if (name.trim().length < 2) return setError(errorText({ ok: false, error: 'receiver_required' }));
    if (!photo) return setError(errorText({ ok: false, error: 'photo_required' }));
    start(async () => {
      const coords = await quickPosition();
      const fd = new FormData();
      fd.set('shipmentId', shipmentId);
      fd.set('otp', otp);
      fd.set('receiverName', name.trim());
      fd.set('photo', new File([photo.blob], 'proof.jpg', { type: 'image/jpeg' }));
      if (coords.lat !== undefined && coords.lng !== undefined) {
        fd.set('lat', String(coords.lat));
        fd.set('lng', String(coords.lng));
      }
      const res = await completeDeliveryAction(fd);
      if (!res.ok) {
        setError(errorText(res));
        if (res.error === 'otp_invalid') setOtp('');
        router.refresh();
        return;
      }
      toast({ title: t('delivered'), variant: 'success' });
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} noValidate className="grid grid-cols-1 gap-4" data-testid="handover-form">
      <FieldShell id={`${id}-otp`} label={t('otp')} hint={t('otpHint')} required>
        <input
          id={`${id}-otp`}
          name="otp"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          dir="ltr"
          value={otp}
          onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
          className={cn(controlClasses, 'border-border text-center font-mono text-2xl font-bold tracking-[0.5em]')}
          data-testid="handover-otp"
        />
      </FieldShell>
      <Input name="receiverName" label={t('receiverName')} autoComplete="off" required value={name} onChange={(e) => setName(e.target.value)} data-testid="handover-name" />
      <div>
        <p className="text-sm font-medium">
          {t('photo')}
          <span aria-hidden="true" className="ms-0.5 text-orange">
            *
          </span>
        </p>
        <div className="mt-1.5 grid aspect-video place-items-center overflow-hidden rounded-xl border border-dashed border-border-strong bg-surface-2/50">
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element -- local blob preview
            <img src={photo.url} alt={t('photoAlt')} className="h-full w-full object-cover" />
          ) : (
            <Camera size={36} aria-hidden="true" className="text-muted/60" />
          )}
        </div>
        <p className="mt-1 text-xs text-muted">{t('photoHint')}</p>
        {photoError ? (
          <p role="alert" className="mt-1 text-sm font-medium text-error">
            {photoError}
          </p>
        ) : null}
        <label className={cn('mt-2 inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-border-strong px-4 text-sm font-semibold hover:bg-surface-2 focus-within:outline-2 focus-within:outline-ring')}>
          {photo ? <RotateCcw size={16} aria-hidden="true" /> : <Camera size={16} aria-hidden="true" />}
          {processing ? '…' : photo ? t('photoRetake') : t('photoTake')}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={(e) => {
              void onPhoto(e.target.files?.[0]);
              e.target.value = '';
            }}
            data-testid="handover-photo"
          />
        </label>
      </div>
      {error ? (
        <p role="alert" className="flex gap-2 rounded-xl border border-error/40 bg-error/10 p-3 text-sm font-medium text-error" data-testid="handover-error">
          <CircleAlert size={18} aria-hidden="true" className="mt-0.5 shrink-0" />
          {error}
        </p>
      ) : null}
      <Button type="submit" size="lg" fullWidth loading={pending} loadingLabel={t('completing')} leadingIcon={<PackageCheck size={20} aria-hidden="true" />} data-testid="handover-submit">
        {t('complete')}
      </Button>
    </form>
  );
}

export function FailDeliveryButton({ shipmentId }: { shipmentId: string }) {
  const t = useTranslations('delivery.courier');
  const tc = useTranslations('common.actions');
  const errorText = useErrorText();
  const modal = useHistoryModal('fail-delivery');
  const router = useRouter();
  const { toast } = useToast();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const confirm = () =>
    start(async () => {
      const res = await failDeliveryAction(shipmentId, reason);
      if (!res.ok) return setError(errorText(res));
      toast({ title: t('failed'), variant: 'success' });
      modal.closeThen(() => router.refresh());
    });
  return (
    <>
      <Button variant="outline" fullWidth onClick={modal.open} leadingIcon={<XCircle size={18} aria-hidden="true" />} className="text-error" data-testid="courier-fail">
        {t('fail')}
      </Button>
      <Modal
        {...modal.props}
        title={t('failTitle')}
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={modal.close} disabled={pending}>
              {tc('cancel')}
            </Button>
            <Button variant="danger" onClick={confirm} loading={pending} data-testid="courier-fail-confirm">
              {t('failConfirm')}
            </Button>
          </div>
        }
      >
        <Textarea label={t('failReason')} hint={t('failReasonHint')} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} error={error ?? undefined} />
      </Modal>
    </>
  );
}

export function IncidentForm({ shipmentId }: { shipmentId: string }) {
  const t = useTranslations('delivery');
  const errorText = useErrorText();
  const router = useRouter();
  const { toast } = useToast();
  const [type, setType] = useState<string>('DELAY');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await reportIncidentAction(shipmentId, type, description);
      if (!res.ok) return setError(errorText(res));
      setDescription('');
      toast({ title: t('courier.incidentReported'), variant: 'success' });
      router.refresh();
    });
  };
  return (
    <form ref={formRef} onSubmit={submit} noValidate className="grid grid-cols-1 gap-3" data-testid="incident-form">
      <Select label={t('courier.incidentType')} value={type} onChange={(e) => setType(e.target.value)}>
        {INCIDENTS.map((i) => (
          <option key={i} value={i}>
            {t(`incident.types.${i}`)}
          </option>
        ))}
      </Select>
      <Textarea label={t('courier.incidentDescription')} rows={3} maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} error={error ?? undefined} />
      <div className="flex justify-end">
        <Button type="submit" variant="secondary" loading={pending} leadingIcon={<Siren size={18} aria-hidden="true" />}>
          {t('courier.incidentSubmit')}
        </Button>
      </div>
    </form>
  );
}
