import { swapRequest, reduceAttempt, lookupJobByKey, unsettled } from './templateSwapClient.mjs';
import { createBatch, sendInOrder } from './imageBatch.js';
import { checkAbort } from './templateSwapPhoto.mjs';
export const POLL_LIMIT = 12;
export const pollDelay = index => Math.min(20000, 2000 * 2 ** index);
export function waitForPoll(ms, signal) {
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new DOMException('Cancelled', 'AbortError')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}
export function createSwapActions(store, { makeKey, processPhoto, upload, gateway, objectURL = file => URL.createObjectURL(file), wait = waitForPoll, refreshOffer = () => {}, balanceChanged = () => {} }) {
  const active = new Map();
  const current = (template, key) => store.get(template).find(a => a.key === key);
  function start(a, kind) {
    const operation = `${a.accountId}:${a.key}:${kind}`;
    if (active.has(operation) && !active.get(operation).signal.aborted) return null;
    const controller = store.controller(a.key), ticket = store.ticket(a.key);
    active.set(operation, controller);
    return { controller, ticket, signal: controller.signal, valid: () => store.valid(ticket) && !controller.signal.aborted,
      finish: () => { if (active.get(operation) === controller) active.delete(operation); store.release(controller); } };
  }
  async function choose(templateId, file) {
    if (!store.owner()) return;
    for (const a of store.get(templateId)) if (!unsettled(a)) store.dispose(a.key);
    const a = { accountId: store.owner(), templateId, key: makeKey(), state: 'processing', photo: file };
    store.put(a); const op = start(a, 'photo');
    try {
      const result = await processPhoto(file, { signal: op.signal });
      if (!op.valid()) return;
      store.update(op.ticket, { ...result, urls: result.files.map(objectURL), state: 'ready', photo: undefined });
    } catch (e) {
      if (op.valid()) store.update(op.ticket, { state: 'photo_error', errorCode: ['NotAllowedError', 'SecurityError'].includes(e.name) ? e.name : e.message || e.name });
    } finally { op.finish(); }
  }
  async function submit(templateId, offer) {
    let a = store.get(templateId).at(-1);
    if (!a || !offer || a.files?.length !== 2 || !['ready', 'not_charged', 'refund_pending', 'refunded', 'upload_error'].includes(a.state)) return;
    // A rejection starts a new attempt, but only the retained processed bytes are
    // uploaded again. Older job handles remain independently reconcilable.
    if (a.body) {
      const files = a.files;
      a = { accountId: a.accountId, templateId, key: makeKey(), state: 'ready', files, urls: files.map(objectURL) };
      store.put(a);
    }
    const op = start(a, 'submit'); if (!op) return;
    store.update(op.ticket, { state: 'uploading', errorCode: undefined });
    try {
      const references = [];
      for (const file of a.files) {
        checkAbort(op.signal); if (!op.valid()) return;
        // This is the ONLY upload boundary. Raw/blocked drafts have no files.
        if (file.type !== 'image/png') throw Error('invalid_image');
        const key = await upload(file, { signal: op.signal });
        if (!op.valid()) return;
        references.push({ slot: 'image', origin: 'upload', key });
      }
      const body = swapRequest(offer, a.key, references);
      if (!op.valid()) return;
      store.update(op.ticket, { body, references, state: 'submitting' });
      // Use the existing submit transport's unknown-outcome classification.
      const batch = createBatch(1, () => a.key);
      const { error } = await sendInOrder(1, () => gateway('/generations', { method: 'POST', body: JSON.stringify(body), signal: op.signal }), batch);
      if (error) throw error;
      const accepted = batch.accepted[0];
      if (!op.valid()) return;
      if (!accepted?.job_id) throw Error('invalid_response');
      store.update(op.ticket, reduceAttempt(current(templateId, a.key), { accepted }));
      for (const old of store.get(templateId)) store.dropFiles(old.key);
      balanceChanged();
    } catch (error) {
      if (!op.valid()) return;
      const record = current(templateId, a.key);
      if (error.code === 'price_changed') refreshOffer(templateId);
      store.update(op.ticket, record.body ? reduceAttempt(record, { error }) : { state: 'upload_error', errorCode: error.code || error.message });
    } finally { op.finish(); }
  }
  async function reconcile(templateId, key) {
    const a = current(templateId, key);
    if (!a || !unsettled(a) || a.state === 'submitting') return;
    const op = start(a, 'poll'); if (!op) return;
    if (a.state === 'unresolved') store.update(op.ticket, { state: a.refusal ? 'refund_pending' : 'unknown' });
    try {
      for (let index = 0; index < POLL_LIMIT; index++) {
        if (!op.valid()) return;
        try {
          const job = await lookupJobByKey(a.key, gateway, op.signal);
          if (!op.valid()) return;
          if (!job && index === 0 && a.body && a.uncertain && !a.refusal) {
            // One replay per reconciliation pass; always the frozen body/key and
            // reference pair. A later gate refusal cannot erase earlier uncertainty.
            try {
              if (!op.valid()) return;
              const accepted = await gateway('/generations', { method: 'POST', body: JSON.stringify(a.body), signal: op.signal });
              if (!op.valid()) return;
              if (accepted?.job_id) {
                store.update(op.ticket, reduceAttempt(current(templateId, key), { accepted }));
                store.dropFiles(key);
                balanceChanged();
              }
            } catch (error) {
              if (!op.valid()) return;
              store.update(op.ticket, reduceAttempt(current(templateId, key), { error }));
            }
          }
          if (job) {
            const next = reduceAttempt(current(templateId, key), { job });
            store.update(op.ticket, next);
            if (!unsettled(next)) {
              try {
                if (!op.valid()) return;
                const balance = await gateway('/balance', { signal: op.signal });
                if (!op.valid()) return;
                if (Number.isFinite(balance?.balance)) store.update(op.ticket, { balance: balance.balance });
              } catch { /* The settled money fact remains authoritative if balance is unavailable. */ }
              if (!op.valid()) return;
              balanceChanged();
              if (next.state === 'succeeded') store.dropFiles(key);
              return;
            }
          }
        } catch { if (!op.valid()) return; }
        if (index < POLL_LIMIT - 1) await wait(pollDelay(index), op.signal);
      }
      if (op.valid()) store.update(op.ticket, { state: 'unresolved' });
    } finally { op.finish(); }
  }
  function cancel(key) {
    const a = [...active.entries()].filter(([id]) => id.startsWith(`${store.owner()}:${key}:`));
    for (const [, controller] of a) controller.abort();
    store.dispose(key);
  }
  return { choose, submit, reconcile, cancel };
}
