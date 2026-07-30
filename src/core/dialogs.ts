import { openM, closeM } from './modals';

// Promise-based in-app replacements for window.alert / window.confirm so the
// UI stays consistent with the rest of the app's modals. The HTML provides
// shared #modal-alert / #modal-confirm shells; these helpers just rewire
// their button listeners per-call so two overlapping promises can't
// resolve each other (the listeners are torn down on settle).
//
// Calling showAlert from a button handler is awaitable:
//   await showAlert('Name required', 'Validation');
// And showConfirm returns true/false:
//   if (!(await showConfirm('Are you sure?'))) return;

export function showAlert(
  message: string,
  title: string = 'Notice',
): Promise<void> {
  const titleEl = document.getElementById('alertTitle');
  const msgEl = document.getElementById('alertMessage');
  const okBtn = document.getElementById('alertOkBtn');
  const closeX = document.getElementById('alertCloseX');
  if (titleEl) titleEl.textContent = title;
  if (msgEl) msgEl.textContent = message;
  openM('alert');
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      okBtn?.removeEventListener('click', finish);
      closeX?.removeEventListener('click', finish);
      closeM('alert');
      resolve();
    };
    okBtn?.addEventListener('click', finish);
    closeX?.addEventListener('click', finish);
  });
}

export type ConfirmOptions = {
  title?: string;
  okLabel?: string;
  cancelLabel?: string;
  /** If true, paints the OK button danger-red (for destructive actions). */
  danger?: boolean;
};

export function showConfirm(
  message: string,
  options?: ConfirmOptions,
): Promise<boolean> {
  const titleEl = document.getElementById('confirmTitle');
  const msgEl = document.getElementById('confirmMessage');
  const okBtn = document.getElementById('confirmOkBtn') as HTMLButtonElement | null;
  const cancelBtn = document.getElementById('confirmCancelBtn');
  const cancelX = document.getElementById('confirmCancelX');
  if (titleEl) titleEl.textContent = options?.title ?? 'Confirm';
  if (msgEl) msgEl.textContent = message;
  if (okBtn) {
    okBtn.textContent = options?.okLabel ?? 'Confirm';
    if (options?.danger) {
      okBtn.style.background = 'var(--danger)';
      okBtn.style.borderColor = 'var(--danger)';
    } else {
      okBtn.style.background = '';
      okBtn.style.borderColor = '';
    }
  }
  if (cancelBtn) cancelBtn.textContent = options?.cancelLabel ?? 'Cancel';
  openM('confirm');
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (proceed: boolean) => {
      if (settled) return;
      settled = true;
      okBtn?.removeEventListener('click', onOk);
      cancelBtn?.removeEventListener('click', onCancel);
      cancelX?.removeEventListener('click', onCancel);
      closeM('confirm');
      resolve(proceed);
    };
    const onOk = () => finish(true);
    const onCancel = () => finish(false);
    okBtn?.addEventListener('click', onOk);
    cancelBtn?.addEventListener('click', onCancel);
    cancelX?.addEventListener('click', onCancel);
  });
}
