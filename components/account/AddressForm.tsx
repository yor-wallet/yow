'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState, useTransition, type FocusEvent, type FormEvent } from 'react';
import { Crosshair, ExternalLink, LocateFixed, MapPin, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Input, Checkbox, FieldShell, controlClasses } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { useValidationMessage } from '@/components/ui/useValidationMessage';
import { localize } from '@/lib/localized';
import { OMAN_BOUNDS } from '@/lib/validation';
import type { GovernorateOption } from '@/lib/delivery/geo';
import { saveAddressAction, type SavedAddress } from './address-actions';
import { cn } from '@/lib/cn';

export type { SavedAddress } from './address-actions';

export type AddressFormValues = {
  label: string;
  recipientName: string;
  phone: string; // 8 local digits
  governorateId: string;
  wilayaId: string;
  area: string;
  building: string;
  street: string;
  instructions: string;
  isDefault: boolean;
  lat: number | null;
  lng: number | null;
};

export type AddressFormProps = {
  /** From `getGovernorateOptions()` (lib/delivery/geo) — loaded by the parent server component. */
  governorates: GovernorateOption[];
  /** Existing address to edit (omit to create). */
  address?: Partial<Omit<AddressFormValues, 'phone'>> & { id: string; phone?: string };
  /** Prefill for a new address (e.g. the account holder). */
  defaults?: { recipientName?: string; phone?: string | null };
  /** sessionStorage key for the non-sensitive draft (default per create/edit). */
  draftKey?: string;
  /** Called after a successful save (checkout). Without it the form navigates to `redirectTo`. */
  onSaved?: (address: SavedAddress) => void;
  onCancel?: () => void;
  redirectTo?: string;
  submitLabel?: string;
  className?: string;
};

type GeoState =
  | { kind: 'idle' }
  | { kind: 'locating' }
  | { kind: 'error'; reason: 'denied' | 'unavailable' | 'timeout' | 'outside' | 'error' }
  | { kind: 'ok'; accuracy: number | null };

const EMPTY: AddressFormValues = {
  label: '',
  recipientName: '',
  phone: '',
  governorateId: '',
  wilayaId: '',
  area: '',
  building: '',
  street: '',
  instructions: '',
  isDefault: false,
  lat: null,
  lng: null,
};

/** `+96891234567` → `91234567`. */
function localDigits(phone: string | null | undefined): string {
  if (!phone) return '';
  const d = phone.replace(/\D/g, '');
  return d.length === 11 && d.startsWith('968') ? d.slice(3) : d.slice(-8);
}

function readDraft(key: string): Partial<AddressFormValues> | null {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Partial<AddressFormValues>) : null;
  } catch {
    return null;
  }
}

/**
 * Omani address form (account address book + checkout). Governorate → wilaya from DB,
 * +968 mobile, optional GPS via the Geolocation API (permission-aware, OpenStreetMap
 * link, no API key), non-sensitive draft in sessionStorage, keyboard-safe focus.
 */
export function AddressForm({
  governorates,
  address,
  defaults,
  draftKey,
  onSaved,
  onCancel,
  redirectTo = '/account/addresses',
  submitLabel,
  className,
}: AddressFormProps) {
  const t = useTranslations('account.addresses.form');
  const tErr = useTranslations('account.addresses.errors');
  const vm = useValidationMessage();
  const locale = useLocale();
  const router = useRouter();
  const { toast } = useToast();
  const formId = useId();
  const storageKey = draftKey ?? `doom:address-draft:${address?.id ?? 'new'}`;

  const initial = useMemo<AddressFormValues>(
    () => ({
      ...EMPTY,
      recipientName: defaults?.recipientName ?? '',
      phone: localDigits(defaults?.phone),
      ...(address
        ? {
            label: address.label ?? '',
            recipientName: address.recipientName ?? '',
            phone: localDigits(address.phone),
            governorateId: address.governorateId ?? '',
            wilayaId: address.wilayaId ?? '',
            area: address.area ?? '',
            building: address.building ?? '',
            street: address.street ?? '',
            instructions: address.instructions ?? '',
            isDefault: !!address.isDefault,
            lat: address.lat ?? null,
            lng: address.lng ?? null,
          }
        : {}),
    }),
    [address, defaults],
  );

  const [values, setValues] = useState<AddressFormValues>(initial);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [geo, setGeo] = useState<GeoState>({ kind: 'idle' });
  const [pending, startTransition] = useTransition();
  const [draftRestored, setDraftRestored] = useState(false);
  const hydrated = useRef(false);

  // Restore the draft once (client only).
  useEffect(() => {
    const draft = readDraft(storageKey);
    if (draft) {
      setValues((v) => ({ ...v, ...draft }));
      setDraftRestored(true);
    }
    hydrated.current = true;
  }, [storageKey]);

  // Persist the draft (debounced).
  useEffect(() => {
    if (!hydrated.current) return;
    const id = window.setTimeout(() => {
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(values));
      } catch {
        /* storage full / disabled */
      }
    }, 250);
    return () => window.clearTimeout(id);
  }, [values, storageKey]);

  const set = useCallback(<K extends keyof AddressFormValues>(key: K, value: AddressFormValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    setFieldErrors((e) => {
      if (!e[key]) return e;
      const next = { ...e };
      delete next[key];
      return next;
    });
  }, []);

  const governorate = governorates.find((g) => g.id === values.governorateId);
  const wilayas = governorate?.wilayas ?? [];

  const err = (field: string): string | undefined => {
    const code = fieldErrors[field]?.[0];
    if (!code) return undefined;
    return tErr.has(code as Parameters<typeof tErr>[0]) ? tErr(code as Parameters<typeof tErr>[0]) : vm(code);
  };

  // Keep the focused field visible above the on-screen keyboard.
  const onFocusCapture = (e: FocusEvent<HTMLFormElement>) => {
    const el = e.target as HTMLElement;
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) return;
    window.setTimeout(() => {
      const vv = window.visualViewport;
      const rect = el.getBoundingClientRect();
      const top = vv ? vv.offsetTop : 0;
      const bottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
      if (rect.top < top + 72 || rect.bottom > bottom - 16) {
        el.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      }
    }, 280);
  };

  const locate = async () => {
    if (!('geolocation' in navigator)) {
      setGeo({ kind: 'error', reason: 'unavailable' });
      return;
    }
    try {
      const perm = await navigator.permissions?.query({ name: 'geolocation' as PermissionName });
      if (perm?.state === 'denied') {
        setGeo({ kind: 'error', reason: 'denied' });
        return;
      }
    } catch {
      /* Permissions API not supported — ask directly */
    }
    setGeo({ kind: 'locating' });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng, accuracy } = pos.coords;
        const inside = lat >= OMAN_BOUNDS.minLat && lat <= OMAN_BOUNDS.maxLat && lng >= OMAN_BOUNDS.minLng && lng <= OMAN_BOUNDS.maxLng;
        if (!inside) {
          setGeo({ kind: 'error', reason: 'outside' });
          return;
        }
        set('lat', Math.round(lat * 1e6) / 1e6);
        set('lng', Math.round(lng * 1e6) / 1e6);
        setGeo({ kind: 'ok', accuracy: Number.isFinite(accuracy) ? Math.round(accuracy) : null });
      },
      (e) => {
        setGeo({
          kind: 'error',
          reason: e.code === e.PERMISSION_DENIED ? 'denied' : e.code === e.POSITION_UNAVAILABLE ? 'unavailable' : e.code === e.TIMEOUT ? 'timeout' : 'error',
        });
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 },
    );
  };

  const clearLocation = () => {
    set('lat', null);
    set('lng', null);
    setGeo({ kind: 'idle' });
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const data: Record<string, unknown> = {
      label: values.label,
      recipientName: values.recipientName,
      phone: values.phone,
      governorateId: values.governorateId,
      wilayaId: values.wilayaId,
      area: values.area,
      building: values.building,
      street: values.street,
      instructions: values.instructions,
      isDefault: values.isDefault,
      ...(values.lat !== null && values.lng !== null ? { lat: values.lat, lng: values.lng } : {}),
    };
    startTransition(async () => {
      const res = await saveAddressAction({ id: address?.id, data });
      if (!res.ok) {
        setFieldErrors(res.fieldErrors ?? {});
        if (!res.fieldErrors || res.error !== 'validation') setFormError(tErr(res.error === 'validation' ? 'generic' : res.error));
        const first = Object.keys(res.fieldErrors ?? {})[0];
        if (first) document.getElementById(`${formId}-${first}`)?.focus();
        return;
      }
      try {
        sessionStorage.removeItem(storageKey);
      } catch {
        /* ignore */
      }
      toast({ title: t('saved'), variant: 'success' });
      if (onSaved) onSaved(res.address);
      else {
        router.replace(redirectTo);
        router.refresh();
      }
    });
  };

  const hasLocation = values.lat !== null && values.lng !== null;
  const osm =
    hasLocation &&
    `https://www.openstreetmap.org/?mlat=${values.lat!.toFixed(6)}&mlon=${values.lng!.toFixed(6)}#map=17/${values.lat!.toFixed(6)}/${values.lng!.toFixed(6)}`;

  return (
    <form
      noValidate
      onSubmit={onSubmit}
      onFocusCapture={onFocusCapture}
      className={cn('grid grid-cols-1 gap-4 sm:grid-cols-2', className)}
      data-testid="address-form"
      aria-describedby={formError ? `${formId}-error` : undefined}
    >
      {draftRestored ? (
        <p className="text-xs text-muted sm:col-span-2" role="status" data-testid="address-draft-restored">
          {t('draftRestored')}
        </p>
      ) : null}
      <Input
        id={`${formId}-recipientName`}
        name="recipientName"
        label={t('recipientName')}
        autoComplete="name"
        required
        value={values.recipientName}
        onChange={(e) => set('recipientName', e.target.value)}
        error={err('recipientName')}
      />
      <FieldShell id={`${formId}-phone`} label={t('phone')} hint={t('phoneHint')} error={err('phone')} required>
        <div className="relative" dir="ltr">
          <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-base font-medium text-muted">
            +968
          </span>
          <input
            id={`${formId}-phone`}
            name="phone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            maxLength={12}
            required
            aria-invalid={err('phone') ? true : undefined}
            aria-describedby={err('phone') ? `${formId}-phone-error` : `${formId}-phone-hint`}
            value={values.phone}
            onChange={(e) => set('phone', e.target.value.replace(/[^\d٠-٩ ]/g, ''))}
            className={cn(controlClasses, 'pl-16', err('phone') ? 'border-error' : 'border-border')}
          />
        </div>
      </FieldShell>
      <Select
        id={`${formId}-governorateId`}
        name="governorateId"
        label={t('governorate')}
        required
        value={values.governorateId}
        placeholder={t('governoratePlaceholder')}
        onChange={(e) => {
          set('governorateId', e.target.value);
          set('wilayaId', '');
        }}
        error={err('governorateId')}
      >
        {governorates.map((g) => (
          <option key={g.id} value={g.id}>
            {localize(g.name, locale)}
          </option>
        ))}
      </Select>
      <Select
        id={`${formId}-wilayaId`}
        name="wilayaId"
        label={t('wilaya')}
        required
        disabled={!governorate}
        hint={!governorate ? t('wilayaFirst') : undefined}
        value={values.wilayaId}
        placeholder={t('wilayaPlaceholder')}
        onChange={(e) => set('wilayaId', e.target.value)}
        error={err('wilayaId')}
      >
        {wilayas.map((w) => (
          <option key={w.id} value={w.id}>
            {localize(w.name, locale)}
          </option>
        ))}
      </Select>
      <Input
        id={`${formId}-area`}
        name="area"
        label={t('area')}
        autoComplete="address-level3"
        required
        value={values.area}
        onChange={(e) => set('area', e.target.value)}
        error={err('area')}
      />
      <Input
        id={`${formId}-building`}
        name="building"
        label={t('building')}
        autoComplete="address-line2"
        required
        value={values.building}
        onChange={(e) => set('building', e.target.value)}
        error={err('building')}
      />
      <Input
        id={`${formId}-street`}
        name="street"
        label={t('street')}
        autoComplete="address-line1"
        value={values.street}
        onChange={(e) => set('street', e.target.value)}
        error={err('street')}
      />
      <Input
        id={`${formId}-label`}
        name="label"
        label={t('label')}
        placeholder={t('labelPlaceholder')}
        value={values.label}
        onChange={(e) => set('label', e.target.value)}
        error={err('label')}
      />

      {/* GPS */}
      <fieldset className="rounded-2xl border border-border bg-surface-2/40 p-4 sm:col-span-2" data-testid="address-gps">
        <legend className="px-1 text-sm font-medium">{t('location.title')}</legend>
        <p className="text-xs text-muted">{t('location.hint')}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={locate}
            loading={geo.kind === 'locating'}
            loadingLabel={t('location.locating')}
            leadingIcon={hasLocation ? <LocateFixed size={18} aria-hidden="true" /> : <Crosshair size={18} aria-hidden="true" />}
            data-testid="address-gps-button"
          >
            {hasLocation ? t('location.update') : t('location.use')}
          </Button>
          {hasLocation ? (
            <Button type="button" variant="ghost" size="sm" onClick={clearLocation} leadingIcon={<X size={16} aria-hidden="true" />}>
              {t('location.remove')}
            </Button>
          ) : null}
        </div>
        <div aria-live="polite" className="mt-2 text-sm">
          {hasLocation ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="address-gps-coords">
              <span className="inline-flex items-center gap-1.5 font-medium" dir="ltr">
                <MapPin size={16} aria-hidden="true" className="text-cyan" />
                {t('location.coords', { lat: values.lat!.toFixed(5), lng: values.lng!.toFixed(5) })}
              </span>
              {geo.kind === 'ok' && geo.accuracy !== null ? (
                <span className="text-xs text-muted">{t('location.accuracy', { meters: geo.accuracy })}</span>
              ) : null}
              {osm ? (
                <a href={osm} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 font-semibold text-accent underline-offset-4 hover:underline">
                  {t('location.viewMap')}
                  <ExternalLink size={14} aria-hidden="true" className="flip-rtl" />
                </a>
              ) : null}
            </div>
          ) : null}
          {geo.kind === 'error' ? (
            <p className="mt-1 font-medium text-error" role="alert" data-testid="address-gps-error">
              {t(`location.${geo.reason}`)}
            </p>
          ) : null}
          {fieldErrors.lat ? <p className="mt-1 font-medium text-error">{err('lat')}</p> : null}
        </div>
      </fieldset>

      <Textarea
        id={`${formId}-instructions`}
        name="instructions"
        label={t('instructions')}
        placeholder={t('instructionsPlaceholder')}
        rows={3}
        maxLength={500}
        value={values.instructions}
        onChange={(e) => set('instructions', e.target.value)}
        error={err('instructions')}
        containerClassName="sm:col-span-2"
      />
      <Checkbox
        name="isDefault"
        label={t('isDefault')}
        checked={values.isDefault}
        onChange={(e) => set('isDefault', e.target.checked)}
        className="sm:col-span-2"
      />

      {formError ? (
        <p id={`${formId}-error`} role="alert" className="rounded-xl border border-error/40 bg-error/10 px-4 py-3 text-sm font-medium text-error sm:col-span-2">
          {formError}
        </p>
      ) : null}

      <div className="flex flex-col-reverse gap-3 sm:col-span-2 sm:flex-row sm:justify-end">
        {onCancel ? (
          <Button type="button" variant="outline" onClick={onCancel}>
            {t('cancel')}
          </Button>
        ) : null}
        <Button type="submit" loading={pending} loadingLabel={t('saving')} data-testid="address-submit">
          {submitLabel ?? t('save')}
        </Button>
      </div>
    </form>
  );
}
