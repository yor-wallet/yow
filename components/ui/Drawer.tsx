'use client';

import { DialogFrame, type DialogProps } from './Dialog';

export { useHistoryModal } from './useHistoryModal';

/**
 * Side drawer (specification §3): slides in from the START of the reading direction (right in Arabic,
 * left in English / French), 200 ms. Same engine as Modal / BottomSheet: title, "Close" button, focus
 * moved inside and trapped, Escape and browser Back close it, focus returns to the opener.
 */
export function Drawer(props: DialogProps) {
  return <DialogFrame {...props} variant="drawer" />;
}
