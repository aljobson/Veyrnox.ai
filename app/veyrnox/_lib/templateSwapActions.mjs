import { swapRequest, reduceAttempt, lookupJobByKey, unsettled } from './templateSwapClient.mjs';
import { createBatch, sendInOrder } from './imageBatch.js';
const abortError = () => Object.assign(new Error('Cancelled'), { name: 'AbortError' });
const checkAbort = signal => { if (signal?.aborted) throw abortError(); };
export const POLL_LIMIT = 12;
// A job the server accepted and still reports queued or running is not "unresolved":
// a 5 s Kling O1 swap takes minutes. Keep reading it at the 20 s ceiling for about an
// hour (the job watcher's window) before handing over to the Check button.
export const LIVE_POLL_LIMIT = POLL_LIMIT + 180;
const live = a => Boolean(a && !a.uncertain && ['queued', 'running'].includes(a.state));
export const pollDelay = index => Math.min(20000, 2000 * 2 ** index);
export function waitForPoll(ms, signal) {
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(abortError()); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}
export function createSwapActions(store, { makeKey, processPhoto, upload, gateway, objectURL = file => URL.createObjectURL(file), revokeURL = url => URL.revokeObjectURL(url), wait = waitForPoll, refreshOffer = () => {}, balanceChanged = () => {}, discardPhoto = () => {}, jobStarted = () => {} }) {
  const active = new Map();
  const current = (template, key) => store.get(template).find(a => a.key === key);
  // An accepted job joins the same job history every other generation writes, so the
  // site's progress bar and background watcher see it. Only ever after acceptance.
  function started(a, label) {
    if (!a?.job_id || !a.body) return;
    try { jobStarted({ job_id: a.job_id, model_id: a.body.model_id, credits: a.spent ?? a.body.max_charge_credits, templateId: a.templateId, name: label }); } catch { /* display only */ }
  }
  function start(a, kind) {
    const operation = `${a.accountId}:${a.key}:${kind}`;
    if (active.has(operation) && !active.get(operation).signal.aborted) return null;
    const controller = store.controller(a.key), ticket = store.ticket(a.key);
    active.set(operation, controller);
    return { controller, ticket, signal: controller.signal, valid: () => store.valid(ticket) && !controller.signal.aborted,
      finish: () => { if (active.get(operation) === controller) active.delete(operation); store.release(controller); } };
  }
  // person 0 is the first (or only) photo, person 1 the second person's photo (two-person templates, ADR-0351 amendment 14).
  // A not-yet-submitted draft is updated in place so choosing one person never drops the other's photo.
  async function choose(templateId, file, person = 0) {
    if (!store.owner()) return;
    const last = store.get(templateId).at(-1);
    const inPlace = Boolean(last && last.files && !last.body && ['ready', 'photo_error'].includes(last.state) && (person === 0 || last.files.length >= 2));
    if (person === 1 && !inPlace) return;
    let a = last;
    if (!inPlace) {
      for (const item of store.get(templateId)) if (!unsettled(item)) store.dispose(item.key);
      a = { accountId: store.owner(), templateId, key: makeKey(), state: 'processing', photo: file, photoPerson: 0 };
      store.put(a);
    }
    const op = start(a, 'photo');
    if (!op) return;
    if (inPlace) store.update(op.ticket, { state: 'processing', photo: file, photoPerson: person, errorCode: undefined });
    try {
      const result = await processPhoto(file, { signal: op.signal });
      if (!op.valid()) { discardPhoto(result); return; }
      const urls = result.files.map(objectURL);
      if (!inPlace) { store.update(op.ticket, { ...result, urls, state: 'ready', photo: undefined }); return; }
      const now = current(templateId, a.key), files = [...now.files], kept = [...now.urls];
      const slot = person * 2;
      for (const old of kept.slice(slot, slot + 2)) revokeURL(old);
      files.splice(slot, 2, ...result.files); kept.splice(slot, 2, ...urls);
      store.update(op.ticket, { files, urls: kept, state: 'ready', photo: undefined });
    } catch (e) {
      if (op.valid()) store.update(op.ticket, { state: 'photo_error', errorCode: ['NotAllowedError', 'SecurityError'].includes(e.name) ? e.name : e.message || e.name, photoPerson: person });
    } finally { op.finish(); }
  }
  async function submit(templateId, offer) {
    let a = store.get(templateId).at(-1);
    if (!a || !offer || a.files?.length !== (offer.people === 2 ? 4 : 2) || !['ready', 'not_charged', 'refund_pending', 'refunded', 'upload_error'].includes(a.state)) return;
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
      started(current(templateId, a.key), offer.name);
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
      const limit = () => (live(current(templateId, key)) ? LIVE_POLL_LIMIT : POLL_LIMIT);
      for (let index = 0; index < limit(); index++) {
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
                started(current(templateId, key));
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
        if (index < limit() - 1) await wait(pollDelay(index), op.signal);
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
