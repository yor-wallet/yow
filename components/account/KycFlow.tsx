'use client';

import { useEffect, useId, useMemo, useRef, useState, useTransition } from 'react';
import { Camera, CheckCircle2, ImageUp, Lock, RotateCcw, ScanFace, IdCard, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { KycDocumentType } from '@prisma/client';
import { Link, useRouter } from '@/i18n/navigation';
import { Stepper } from '@/components/ui/Stepper';
import { Input, Checkbox } from '@/components/ui/Input';
import { Button, buttonClasses } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { submitKycAction } from '@/app/[locale]/account/verification/actions';
import { cn } from '@/lib/cn';

const MAX_UPLOAD = 8 * 1024 * 1024;
const MAX_INPUT = 25 * 1024 * 1024;
const MAX_DIMENSION = 2000;

type Doc = { blob: Blob; url: string; width: number; height: number };
type DocError =
  | 'heic_unsupported'
  | 'unsupported_type'
  | 'too_large'
  | 'image_unreadable'
  | 'empty';

function newKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}abcdef`;
}

function looksHeic(file: File): boolean {
  return /hei[cf]/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
}

/** Decode, downscale (≤ 2000px) and re-encode as JPEG (strips EXIF/GPS metadata). */
async function compressImage(file: File): Promise<Doc> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('image_unreadable');
  }
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('image_unreadable');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  if (!blob) throw new Error('image_unreadable');
  if (blob.size > MAX_UPLOAD) throw new Error('too_large');
  return { blob, url: URL.createObjectURL(blob), width, height };
}

export type KycFlowProps = {
  mode: 'new' | 'requested';
  required: KycDocumentType[];
  initialName: string;
  email: string;
  phone: string | null;
  addressLine: string | null;
};

const ICONS: Record<KycDocumentType, typeof IdCard> = { ID_FRONT: IdCard, ID_BACK: IdCard, SELFIE: ScanFace };
const NAME_DRAFT_KEY = 'doom:kyc-draft:name';

/** Three-step verification: details → documents (camera capture + compression) → review & submit. */
export function KycFlow({ mode, required, initialName, email, phone, addressLine }: KycFlowProps) {
  const t = useTranslations('kyc');
  const router = useRouter();
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [fullName, setFullName] = useState(initialName);
  const [nameError, setNameError] = useState<string | null>(null);
  const [docs, setDocs] = useState<Partial<Record<KycDocumentType, Doc>>>({});
  const [docErrors, setDocErrors] = useState<Partial<Record<KycDocumentType, DocError>>>({});
  const [processing, setProcessing] = useState<Partial<Record<KycDocumentType, boolean>>>({});
  const [consent, setConsent] = useState(false);
  const [consentError, setConsentError] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const idempotencyKey = useRef<string>('');
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    idempotencyKey.current = newKey();
    try {
      const saved = sessionStorage.getItem(NAME_DRAFT_KEY);
      if (saved) setFullName(saved);
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    try {
      sessionStorage.setItem(NAME_DRAFT_KEY, fullName);
    } catch {
      /* ignore */
    }
  }, [fullName]);
  useEffect(() => () => Object.values(docs).forEach((d) => d && URL.revokeObjectURL(d.url)), [docs]);
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: false });
  }, [step]);

  const steps = [t('steps.details'), t('steps.documents'), t('steps.review')];
  const canContinueDetails = !!phone && !!addressLine;
  const readyCount = required.filter((r) => docs[r]).length;
  const allDocs = readyCount === required.length;

  const onFile = async (type: KycDocumentType, file: File | undefined) => {
    if (!file) return;
    setDocErrors((e) => ({ ...e, [type]: undefined }));
    if (file.size === 0) return setDocErrors((e) => ({ ...e, [type]: 'empty' }));
    if (looksHeic(file)) return setDocErrors((e) => ({ ...e, [type]: 'heic_unsupported' }));
    if (!/^image\/(jpeg|png|webp)$/i.test(file.type) && file.type !== '') return setDocErrors((e) => ({ ...e, [type]: 'unsupported_type' }));
    if (file.size > MAX_INPUT) return setDocErrors((e) => ({ ...e, [type]: 'too_large' }));
    setProcessing((p) => ({ ...p, [type]: true }));
    try {
      const doc = await compressImage(file);
      setDocs((d) => {
        const prev = d[type];
        if (prev) URL.revokeObjectURL(prev.url);
        return { ...d, [type]: doc };
      });
    } catch (err) {
      const code = (err instanceof Error ? err.message : 'image_unreadable') as DocError;
      setDocErrors((e) => ({ ...e, [type]: code === 'too_large' ? 'too_large' : 'image_unreadable' }));
    } finally {
      setProcessing((p) => ({ ...p, [type]: false }));
    }
  };

  const removeDoc = (type: KycDocumentType) =>
    setDocs((d) => {
      const prev = d[type];
      if (prev) URL.revokeObjectURL(prev.url);
      const next = { ...d };
      delete next[type];
      return next;
    });

  const nextFromDetails = () => {
    if (fullName.trim().length < 2) {
      setNameError(t('errors.name_too_short'));
      return;
    }
    setNameError(null);
    setStep(1);
  };

  const submit = () => {
    setFormError(null);
    if (!consent) {
      setConsentError(true);
      return;
    }
    const fd = new FormData();
    fd.set('fullName', fullName.trim());
    fd.set('consent', 'true');
    fd.set('idempotencyKey', idempotencyKey.current);
    for (const type of required) {
      const d = docs[type];
      if (d) fd.set(type, new File([d.blob], `${type.toLowerCase()}.jpg`, { type: 'image/jpeg' }));
    }
    start(async () => {
      const res = await submitKycAction(fd);
      if (!res.ok) {
        const key = `errors.${res.error}` as 'errors.generic';
        const msg = t.has(key) ? t(key) : t('errors.generic');
        if (res.field) {
          setDocErrors((e) => ({ ...e, [res.field!]: res.error as DocError }));
          setStep(1);
        }
        setFormError(res.field ? `${t(`docs.${res.field}`)} — ${msg}` : msg);
        if (res.error !== 'already_pending') idempotencyKey.current = newKey();
        else router.refresh();
        return;
      }
      try {
        sessionStorage.removeItem(NAME_DRAFT_KEY);
      } catch {
        /* ignore */
      }
      toast({ title: t('submitted'), variant: 'success' });
      router.refresh();
    });
  };

  return (
    <div className="min-w-0" data-testid="kyc-flow" data-step={step}>
      <Stepper steps={steps} current={step} />
      <div className="mt-6">
        {step === 0 ? (
          <section aria-labelledby="kyc-step-title" className="grid grid-cols-1 gap-4">
            <div>
              <h2 id="kyc-step-title" ref={headingRef} tabIndex={-1} className="text-lg font-bold outline-none">
                {t('details.title')}
              </h2>
              <p className="text-sm text-muted">{t('details.text')}</p>
            </div>
            <Input
              name="fullName"
              label={t('details.fullName')}
              hint={t('details.fullNameHint')}
              autoComplete="name"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              error={nameError ?? undefined}
            />
            <dl className="grid grid-cols-1 gap-3 rounded-2xl border border-border bg-surface-2/40 p-4 text-sm sm:grid-cols-2">
              <div className="min-w-0">
                <dt className="text-muted">{t('details.email')}</dt>
                <dd className="break-all font-medium" dir="ltr">
                  {email}
                </dd>
              </div>
              <div>
                <dt className="text-muted">{t('details.phone')}</dt>
                <dd className="font-medium">
                  {phone ? (
                    <span dir="ltr">{phone}</span>
                  ) : (
                    <span className="text-error">
                      {t('details.phoneMissing')}{' '}
                      <Link href="/account/profile" className="font-semibold text-accent underline">
                        {t('details.editProfile')}
                      </Link>
                    </span>
                  )}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-muted">{t('details.address')}</dt>
                <dd className="font-medium">
                  {addressLine ?? (
                    <span className="text-error">
                      {t('details.addressMissing')}{' '}
                      <Link href="/account/addresses/new?next=/account/verification" className="font-semibold text-accent underline">
                        {t('details.addAddress')}
                      </Link>
                    </span>
                  )}
                </dd>
              </div>
            </dl>
            <div className="flex justify-end">
              <Button onClick={nextFromDetails} disabled={!canContinueDetails} data-testid="kyc-next">
                {t('next')}
              </Button>
            </div>
          </section>
        ) : null}

        {step === 1 ? (
          <section aria-labelledby="kyc-step-title">
            <h2 id="kyc-step-title" ref={headingRef} tabIndex={-1} className="text-lg font-bold outline-none">
              {t('docs.title')}
            </h2>
            <p className="text-sm text-muted">{t('docs.text')}</p>
            <p className="mt-1 text-xs text-muted" aria-live="polite">
              {t('docs.count', { done: readyCount, total: required.length })}
            </p>
            <ul className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
              {required.map((type) => (
                <li key={type}>
                  <DocCapture
                    type={type}
                    doc={docs[type]}
                    error={docErrors[type] ? (t.has(`errors.${docErrors[type]}` as 'errors.generic') ? t(`errors.${docErrors[type]}` as 'errors.generic') : t('errors.generic')) : undefined}
                    processing={!!processing[type]}
                    onFile={(f) => onFile(type, f)}
                    onRemove={() => removeDoc(type)}
                  />
                </li>
              ))}
            </ul>
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
              <Button variant="outline" onClick={() => setStep(0)}>
                {t('back')}
              </Button>
              <Button onClick={() => setStep(2)} disabled={!allDocs} data-testid="kyc-next">
                {t('next')}
              </Button>
            </div>
          </section>
        ) : null}

        {step === 2 ? (
          <section aria-labelledby="kyc-step-title">
            <h2 id="kyc-step-title" ref={headingRef} tabIndex={-1} className="text-lg font-bold outline-none">
              {t('review.title')}
            </h2>
            <p className="text-sm text-muted">{t('review.text')}</p>
            <ul className="mt-4 grid grid-cols-1 gap-3 xs:grid-cols-3">
              {required.map((type) => {
                const d = docs[type];
                return (
                  <li key={type} className="min-w-0 overflow-hidden rounded-2xl border border-border bg-surface-2/40">
                    {d ? (
                      // eslint-disable-next-line @next/next/no-img-element -- local blob preview
                      <img src={d.url} alt={t('docs.previewAlt', { doc: t(`docs.${type}`) })} width={d.width} height={d.height} className="aspect-[4/3] w-full object-cover" />
                    ) : null}
                    <p className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium">
                      <CheckCircle2 size={16} aria-hidden="true" className="text-success" />
                      {t(`docs.${type}`)}
                    </p>
                  </li>
                );
              })}
            </ul>
            <p className="mt-4 flex gap-2 rounded-xl border border-blue/30 bg-blue/10 p-3 text-sm">
              <Lock size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-accent" />
              {t('review.encryption')}
            </p>
            <Checkbox
              className="mt-3"
              name="consent"
              checked={consent}
              onChange={(e) => {
                setConsent(e.target.checked);
                setConsentError(false);
              }}
              label={
                <>
                  {t('review.consent')}{' '}
                  <Link href="/legal/privacy" className="font-semibold text-accent underline underline-offset-2">
                    {t('review.privacyLink')}
                  </Link>
                </>
              }
              error={consentError ? t('errors.consent_required') : undefined}
            />
            {formError ? (
              <p role="alert" className="mt-3 rounded-xl border border-error/40 bg-error/10 px-4 py-3 text-sm font-medium text-error" data-testid="kyc-error">
                {formError}
              </p>
            ) : null}
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
              <Button variant="outline" onClick={() => setStep(1)} disabled={pending}>
                {t('back')}
              </Button>
              <Button onClick={submit} loading={pending} loadingLabel={t('review.submitting')} data-testid="kyc-submit">
                {mode === 'requested' ? t('uploadRequested') : t('review.submit')}
              </Button>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

function DocCapture({
  type,
  doc,
  error,
  processing,
  onFile,
  onRemove,
}: {
  type: KycDocumentType;
  doc?: Doc;
  error?: string;
  processing: boolean;
  onFile: (f: File | undefined) => void;
  onRemove: () => void;
}) {
  const t = useTranslations('kyc.docs');
  const id = useId();
  const Icon = ICONS[type];
  const capture = type === 'SELFIE' ? 'user' : 'environment';
  const errorId = `${id}-error`;
  const preview = useMemo(() => doc?.url, [doc]);
  return (
    <div
      className={cn(
        'flex h-full min-w-0 flex-col rounded-card border p-4 transition-[border-color,box-shadow] duration-(--dur-card)',
        doc ? 'border-success/60 bg-success/5' : error ? 'border-error/60' : 'border-border bg-surface',
      )}
      data-testid={`kyc-doc-${type}`}
      data-ready={doc ? 'true' : undefined}
    >
      <div className="flex items-center gap-2">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-premium text-cyan">
          <Icon size={18} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="font-semibold">{t(type)}</p>
          <p className="text-xs text-muted">{t(`hint.${type}`)}</p>
        </div>
      </div>
      <div className="relative mt-3 grid aspect-[4/3] place-items-center overflow-hidden rounded-xl border border-dashed border-border-strong bg-surface-2/50">
        {processing ? (
          <span className="flex flex-col items-center gap-2 text-sm text-muted">
            <Spinner label={t('processing')} />
            {t('processing')}
          </span>
        ) : preview ? (
          // eslint-disable-next-line @next/next/no-img-element -- local blob preview
          <img src={preview} alt={t('previewAlt', { doc: t(type) })} className="h-full w-full object-cover" />
        ) : (
          <Icon size={40} aria-hidden="true" className="text-muted/60" />
        )}
        {doc && !processing ? (
          <span className="absolute end-2 top-2 inline-flex items-center gap-1 rounded-pill bg-success px-2 py-0.5 text-xs font-bold text-on-accent">
            <CheckCircle2 size={14} aria-hidden="true" />
            {t('ready')}
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-xs text-muted">{t('formats')}</p>
      {error ? (
        <p id={errorId} role="alert" className="mt-1 text-sm font-medium text-error">
          {error}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <label className={buttonClasses({ variant: doc ? 'outline' : 'primary', size: 'sm', className: 'cursor-pointer focus-within:outline-2 focus-within:outline-ring' })}>
          {doc ? <RotateCcw size={16} aria-hidden="true" /> : <Camera size={16} aria-hidden="true" />}
          {doc ? t('retake') : t('take')}
          <input
            type="file"
            accept="image/*"
            capture={capture}
            className="sr-only"
            aria-describedby={error ? errorId : undefined}
            onChange={(e) => {
              onFile(e.target.files?.[0]);
              e.target.value = '';
            }}
            data-testid={`kyc-capture-${type}`}
          />
        </label>
        <label className={buttonClasses({ variant: 'ghost', size: 'sm', className: 'cursor-pointer focus-within:outline-2 focus-within:outline-ring' })}>
          <ImageUp size={16} aria-hidden="true" />
          {t('choose')}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
            className="sr-only"
            aria-describedby={error ? errorId : undefined}
            onChange={(e) => {
              onFile(e.target.files?.[0]);
              e.target.value = '';
            }}
            data-testid={`kyc-file-${type}`}
          />
        </label>
        {doc ? (
          <Button variant="ghost" size="sm" onClick={onRemove} leadingIcon={<Trash2 size={16} aria-hidden="true" />} className="text-error">
            {t('remove')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
