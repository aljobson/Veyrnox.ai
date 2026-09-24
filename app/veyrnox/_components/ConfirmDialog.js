'use client';

import { useRef } from 'react';
import { Modal } from './Modal';

// Small confirmation modal for actions that throw work away — signing out
// of a session, so far. Escape and the backdrop both cancel; the cancel
// button takes focus so a stray Enter never confirms.
export function ConfirmDialog({
  title,
  body,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'accent',
  onConfirm,
  onCancel,
}) {
  const cancelRef = useRef(null);



  const confirmCls =
    tone === 'danger'
      ? 'bg-vx-danger text-white hover:brightness-110'
      : 'bg-vx-accent text-vx-accent-ink hover:bg-vx-accent-hover';

  return (
    <Modal
      onCancel={onCancel}
      initialFocusRef={cancelRef}
      aria-label={title}
      data-print="hide"
      className="items-center justify-center px-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-sm rounded-2xl border border-vx-border bg-vx-panel p-6 shadow-2xl">
        <h2 className="text-lg font-black tracking-[-0.01em] text-vx-fg">{title}</h2>
        {body && <p className="mt-2 text-sm leading-[1.6] text-vx-fg-body">{body}</p>}
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="rounded-full border border-vx-border px-5 py-2.5 text-sm font-bold text-vx-fg-body hover:border-vx-accent hover:text-vx-fg"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`rounded-full px-5 py-2.5 text-sm font-extrabold ${confirmCls}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
