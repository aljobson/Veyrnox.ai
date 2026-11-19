// iOS drops a view controller (photo picker, document picker) presented while a Modal is still dismissing,
// so a sheet row's action waits until the sheet has finished closing. A timer, not Modal.onDismiss: the
// sheet unmounts when it closes, and an unmounted Modal never reports its dismissal.
export const SHEET_CLOSE_MS = 400;

export function runAfterSheetCloses(action: () => void, delayMs: number = SHEET_CLOSE_MS): void {
    setTimeout(action, delayMs);
}
