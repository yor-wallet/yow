'use client';

import { useTranslations } from 'next-intl';

/**
 * Translate zod error codes (lib/validation) into messages from
 * messages/{locale}/errors.json → "validation". Unknown codes fall back to "required".
 *
 *   const vm = useValidationMessage();
 *   <Input error={vm(state.fieldErrors?.email?.[0])} />
 */
export function useValidationMessage() {
  const t = useTranslations('errors.validation');
  return (code: string | undefined | null): string | undefined => {
    if (!code) return undefined;
    const key = code as Parameters<typeof t>[0];
    return t.has(key) ? t(key) : t('required');
  };
}
