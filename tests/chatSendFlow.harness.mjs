// The harness of tests/chatSendFlow.test.mjs and tests/chatSendRefused.test.mjs: send() run for real, with the screen
// and the network faked (ADR-0067). The hook's source is loaded with its imports handed in: the real plain modules
// (where an ending lands, which notice, how a failure is sorted, the notice store) and fakes for React, the API and
// the screen. Nothing here renders, so what the screen's own open() does with a chat is not covered:
// tests/chatSendHome.test.mjs pins that. Not a test file itself: its name keeps it out of `npm test`'s pattern.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NEW_CHAT, addToDraft, clearNotice, readCreditsWarning, readDraft, readNotice, writeDraft, writeNotice } from '../app/veyrnox/_lib/chatLocal.js';
import { loadFailure } from '../app/veyrnox/_lib/chatScreen.js';
import { askStoppedSend, lostNotice } from '../app/veyrnox/_lib/chatStop.js';
import { ask, forget, land, leave, newChatView, onScreen, sendHome } from '../app/veyrnox/_lib/chatSendHome.js';

const source = readFileSync(new URL('../app/veyrnox/_components/chat/useChatSend.js', import.meta.url), 'utf8');
const imported = [...source.matchAll(/^import \{ ([^}]+) \} from /gm)].flatMap((m) => m[1].split(',').map((n) => n.trim()));
const body = source.replace(/^'use client';\n/, '').replace(/^import [^\n]+\n/gm, '').replace('export function useChatSend', 'return function useChatSend');

export class GatewayError extends Error {
    constructor(message, { status, code } = {}) { super(message); this.status = status; this.code = code; }
}
export const stopped = () => Object.assign(new Error('aborted'), { name: 'AbortError' });
/** POST /api/v1/chat/sends/close while its switch is off (CHAT_SEND_CLOSE_ENABLED): a refusal, as the gateway throws it. */
export const notOpen = async () => { throw new GatewayError('send_close_not_open', { status: 503, code: 'send_close_not_open' }); };
export const A = { id: 'chat-a', model_id: 'm' };
export const TEXT = 'Describe a lighthouse.';
export const ME = 'user-a';
// The notices that say Credits were used, or still may be, by a message the chat does not show. Written out here, not
// imported: tests/chatLocal.test.mjs holds the store to the same four.
export const WARNINGS = ['stop_unsure', 'stop_saving', 'connection_lost', 'reply_not_saved'];
export const memory = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k), key: (i) => [...m.keys()][i], get length() { return m.size; } }; };
/** What the screen reads when a chat arrives on it after a page reload: its stored draft and its stored notice. */
export const afterReload = (storage, chat) => ({ box: readDraft(storage, ME, chat), notice: readNotice(storage, ME, chat) });

/**
 * One send. `turn` plays the server: it gets sendTurn's arguments and the `person`, emits events, and returns or throws.
 * `person` moves about the screen the way the real one does: a press notes the chat asked for, and it is shown when
 * its messages arrive.
 */
// `key` is the send's idempotency key. The default is not one the browser could have made, so the store keeps none
// with a warning (chatLocal.js): a test of a send that is asked about by its key passes a real one, and a function
// stands for the browser's own maker (one that throws: a browser that cannot make a key).
// `closeSend` plays that route for a Stop that came before `start` (it gets the key and the `person`). The default is the route with its switch off, so a
// test that does not name it sees every ending as it was before the send was asked about at the moment of Stop.
// `askLimitMs` is how long that question may take here. `log.closes` is each key asked about, `log.looks` the job id
// each look for the turn was given (null: the chat alone).
// The same route is asked for a send whose own request got no answer before `start` (tests/chatSendUnanswered.test.mjs).
// `closeSend` is also handed the log so far. `settle` may be a function, for a look that throws. `openDown`: the chat
// cannot be read again. `log.checking` is what the hook's `checking` state was set to, in order.
export async function run({ active = null, turn, settle = 'pending', listDown = false, listFails = false, images = [], whileMaking = () => {}, kept = {}, text = TEXT, storage = null, making = null, upload = async () => 'k', prepare = async (f) => f, key = 'key', closeSend = notOpen, askLimitMs = null, openDown = false }) {
    const view = newChatView();
    if (active) { ask(view, active.id); land(view, active.id); }
    const log = { notices: [], box: [], saved: {}, added: {}, opened: [], shownOnOpen: [], deleted: [], activeSet: [], imagesCleared: 0, refreshed: 0, quietReads: 0, failures: [], kept: { ...kept }, keptWith: {}, dropped: [], closes: [], looks: [], checking: [] };
    let onScreenMessages = []; let states = 0;
    const person = {
        press: (id) => ask(view, id),
        opens: (id) => { ask(view, id); land(view, id); onScreenMessages = []; },
        leavesThePage: () => leave(view),
        deletes: (id) => forget(view, id),
        kept: () => ({ ...log.kept }), // what is kept right now, for a server script that looks mid-send
        bubbles: () => onScreenMessages.map((m) => `${m.role}:${m.status}`), // what the chat shows right now
    };
    const deps = {
        // The third state is `checking` (pinned in tests/chatSendUnanswered.test.mjs): what it is set to is recorded, in order.
        useState: (initial) => { states += 1; const nth = states; return [initial, (value) => { if (nth === 3) log.checking.push(value); }]; }, useRef: (initial) => ({ current: initial }),
        GatewayError, NEW_CHAT, loadFailure, lostNotice, ask, forget, land, onScreen, sendHome,
        askStoppedSend: (args) => askStoppedSend({ ...args, ...(askLimitMs && { limitMs: askLimitMs }) }),
        chatErrorCopy: (code) => code, chatUnchargedCopy: (code, _extra, warning) => `${code}, and before that ${warning.code}`,
        makeIdempotencyKey: () => (typeof key === 'function' ? key() : key), uploadChatImage: upload, prepareImage: prepare,
        sendTurn: (args) => turn(args, person),
        chatApi: {
            create: making || (async () => { whileMaking(person); return { thread: { id: 'made', model_id: 'm' } }; }), move: async () => ({}), patch: async () => ({ thread: {} }),
            remove: (id) => { log.deleted.push(id); return Promise.resolve(); },
            threads: async () => { log.quietReads += 1; if (listDown) throw new Error('offline'); return { threads: [] }; },
            settleStop: async ({ jobId }) => { log.looks.push(jobId ?? null); if (typeof settle === 'function') return settle(); return settle; },
            closeSend: (k) => { log.closes.push(k); return closeSend(k, person, log); },
        },
    };
    assert.deepEqual(imported.filter((n) => !(n in deps)), [], 'every name the hook imports is handed in here');
    // Only the names the hook imports are in scope: one it uses without importing throws here, as it would in the browser.
    const useChatSend = new Function('deps', `const { ${imported.join(', ')} } = deps;\n${body}`)(deps);
    const { send } = useChatSend({
        // With `storage`, the box is stored under the chat on screen as it changes, as the screen's draft effect does.
        text, setText: (t) => { log.box.push(t); if (storage) writeDraft(storage, ME, view.shown, t); }, model: { id: 'm' }, imagesBlocked: false, chosen: {}, price: 2,
        active, setActive: (t) => log.activeSet.push(t ? t.id : null), messages: [],
        setMessages: (f) => { onScreenMessages = typeof f === 'function' ? f(onScreenMessages) : f; },
        setThreads: () => {}, setError: (n) => log.notices.push(n),
        att: { items: images, clear: () => { log.imagesCleared += 1; } }, limits: { maxEdge: 2048 }, draftModel: 'm', folders: null, folder: 'all', instr: '',
        // The screen's open(): here it only records the call, and the notice the real one would show with the chat, and says the chat was read.
        // `openDown`: the chat could not be read (still offline), which the real open() says by returning false.
        open: async (id) => { log.opened.push(id); if (openDown) return false; log.shownOnOpen.push(storage ? readNotice(storage, ME, id) : (log.kept[id] ?? null)); ask(view, id); land(view, id); return true; },
        // The screen's refreshThreads(): a read that fails is said on screen, over whatever notice is there (its fail()).
        refreshThreads: async () => { log.refreshed += 1; if (listFails) log.notices.push('list_failed'); }, fail: (e) => log.failures.push(e.code || e.message),
        chatView: { current: view }, saveDraft: (id, t) => { log.saved[id] = t; }, addDraft: (id, t) => { log.added[id] = t; },
        keepNotice: (id, code, extra) => { log.kept[id] = code; log.keptWith[id] = extra; },
        dropNotice: (id) => { log.dropped.push(id); delete log.kept[id]; },
        heldWarning: (id) => (WARNINGS.includes(log.kept[id]) ? { code: log.kept[id] } : null),
        // With `storage`, the five go to the real store instead, written and read the way the screen does it (ChatWorkspace.js).
        ...(storage && {
            saveDraft: (id, t) => writeDraft(storage, ME, id, t), addDraft: (id, t) => addToDraft(storage, ME, id, t),
            keepNotice: (id, code, extra) => writeNotice(storage, ME, id, code, extra), dropNotice: (id) => clearNotice(storage, ME, id),
            heldWarning: (id) => readCreditsWarning(storage, ME, id),
        }),
    });
    await send();
    return { log, view, bubbles: () => onScreenMessages.map((m) => `${m.role}:${m.status}`), kept: () => ({ ...log.kept }) };
}

/** Server scripts. `meanwhile` is what the person does after the reply has started. */
export const reply = (meanwhile = () => {}, done = { status: 'completed', credits_charged: 2, message_id: 'm1' }) => async ({ onEvent }, person) => {
    onEvent('start', { job_id: 'job-1' }); onEvent('delta', { text: 'A lamp' }); meanwhile(person); onEvent('done', done);
    return { replay: false };
};
export const stopBeforeText = (meanwhile = () => {}) => async ({ onEvent }, person) => { onEvent('start', { job_id: 'job-1' }); meanwhile(person); throw stopped(); };
export const stopAfterText = (meanwhile = () => {}) => async ({ onEvent }, person) => { onEvent('start', { job_id: 'job-1' }); onEvent('delta', { text: 'A lamp' }); meanwhile(person); throw stopped(); };
export const cutBeforeText = (meanwhile = () => {}) => async ({ onEvent }, person) => { onEvent('start', { job_id: 'job-1' }); meanwhile(person); throw new TypeError('network error'); };
export const refused = (error, meanwhile = () => {}) => async (_args, person) => { meanwhile(person); throw error; };
/** What sendTurn throws when the message's own request went out and no answer of ours came back (chatApi.js). */
export const unanswered = (status = 0) => new GatewayError('send_unanswered', { status, code: 'send_unanswered' });
/** The request went out and nothing came back, before `start`. */
export const noAnswer = (meanwhile) => refused(unanswered(), meanwhile);
export const toB = (person) => person.opens('chat-b');
