'use client';

import { DialogFrame, type DialogProps } from './Dialog';

export { useHistoryModal } from './useHistoryModal';
export type { HistoryModal } from './useHistoryModal';

/**
 * Centered modal dialog. Never off-screen (max-height = viewport, internal scroll).
 *
 *   const modal = useHistoryModal('confirm-delete');
 *   <Modal {...modal.props} title="…" footer={<Button onClick={modal.close}>OK</Button>}>…</Modal>
 */
export function Modal(props: DialogProps) {
  return <DialogFrame {...props} variant="modal" />;
}
