'use client';

import { DialogFrame, type DialogProps } from './Dialog';

export { useHistoryModal } from './useHistoryModal';

/**
 * Bottom sheet (mobile-first; centered max-w-2xl on large screens). Respects the
 * bottom safe area and keeps focused inputs visible above the keyboard.
 *
 *   const sheet = useHistoryModal('filters');
 *   <BottomSheet {...sheet.props} title="Filters">…</BottomSheet>
 */
export function BottomSheet(props: DialogProps) {
  return <DialogFrame {...props} variant="sheet" />;
}
