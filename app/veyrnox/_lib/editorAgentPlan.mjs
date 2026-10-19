import { helperEnglish, helperDiagnostic, helperMessage } from '../../../lib/helperMessages.mjs';
// Editing agent, dry run (ADR-0105 slice D). Pure and offline: no model, no network, no media API. It defines what an agent may ask for
// (a closed list of commands), what would be sent to a model (timeline JSON, transcript text, the user's instruction, nothing else), and how a
// returned plan is checked and shown before anything changes. A plan that cannot be applied cleanly changes nothing.
import { FPS, formatTime } from './editorTimeline.mjs';
import {
    SEQUENCE_LIMITS, SEQUENCE_MAX, addSequenceClip, addSequenceText, duplicateSequence, moveSequence, removeSequenceClip,
    sequenceEnd, setSequenceRate, splitSequenceClip, trimSequence, updateSequenceClip,
} from './editorSequence.mjs';

export const AGENT_LIMITS = Object.freeze({
    maxCommands: 20, maxPlanBytes: 16 * 1024, maxInstructionChars: 500, maxTranscriptChars: 6000, maxTextChars: 200,
    maxClipsSent: 120, maxLabelChars: 60, maxRemovedShare: 0.5,
});
const KINDS = ['video', 'audio', 'text'];
const MEDIA_KINDS = ['video', 'audio'];
const fail = reason => ({ error: reason });
const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const int = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
const num = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const keysOk = (args, allowed) => Object.keys(args).every(k => allowed.includes(k)) && !Object.keys(args).some(k => k === '__proto__' || k === 'constructor' || k === 'prototype');
const clean = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

const labelOf = (tl, kind, item) => {
    if (kind === 'text') return `"${clean(item.text, 24)}"`;
    return tl.media[item.mediaId]?.name ? clean(tl.media[item.mediaId].name, 30) : `${kind} clip`;
};
const clipArgs = (args, extra = []) => keysOk(args, ['op', 'kind', 'id', ...extra]) && KINDS.includes(args.kind) && typeof args.id === 'string' && /^[a-z][0-9]{1,6}$/.test(args.id);
const exists = (tl, args) => tl[args.kind]?.some(c => c.id === args.id);

// The closed list. Each command checks its own arguments exactly (an extra field is a refusal, never ignored) and calls the same function a
// manual edit calls, so the same boundary validators run. Nothing here can generate, charge, upload, export or read outside the timeline.
export const AGENT_COMMANDS = Object.freeze({
    split: {
        check: (tl, a) => clipArgs(a, ['frame']) && int(a.frame, 1, SEQUENCE_MAX) && exists(tl, a),
        run: (tl, a) => splitSequenceClip(tl, a.kind, a.id, a.frame),
        say: (tl, a) => `Split ${labelOf(tl, a.kind, tl[a.kind].find(c => c.id === a.id))} at ${formatTime(a.frame)}`,
    },
    trim: {
        check: (tl, a) => clipArgs(a, ['edge', 'frames']) && ['in', 'out'].includes(a.edge) && int(a.frames, -SEQUENCE_MAX, SEQUENCE_MAX) && exists(tl, a),
        run: (tl, a) => trimSequence(tl, a.kind, a.id, a.edge, a.frames),
        say: (tl, a) => `Trim the ${a.edge === 'in' ? 'start' : 'end'} of ${labelOf(tl, a.kind, tl[a.kind].find(c => c.id === a.id))} by ${(Math.abs(a.frames) / FPS).toFixed(1)} s ${a.frames < 0 ? 'outwards' : 'inwards'}`,
    },
    move: {
        check: (tl, a) => clipArgs(a, ['start']) && int(a.start, 0, SEQUENCE_MAX) && exists(tl, a),
        run: (tl, a) => moveSequence(tl, a.kind, a.id, a.start, undefined, false),
        say: (tl, a) => `Move ${labelOf(tl, a.kind, tl[a.kind].find(c => c.id === a.id))} to ${formatTime(a.start)}`,
    },
    remove: {
        check: (tl, a) => clipArgs(a, ['ripple']) && (a.ripple === undefined || typeof a.ripple === 'boolean') && exists(tl, a),
        run: (tl, a) => removeSequenceClip(tl, a.kind, a.id, a.ripple === true),
        say: (tl, a) => `Remove ${labelOf(tl, a.kind, tl[a.kind].find(c => c.id === a.id))}${a.ripple ? ' and close the gap' : ''}`,
        destructive: true,
    },
    duplicate: {
        check: (tl, a) => clipArgs(a) && exists(tl, a),
        run: (tl, a) => duplicateSequence(tl, { track: a.kind, id: a.id }),
        say: (tl, a) => `Duplicate ${labelOf(tl, a.kind, tl[a.kind].find(c => c.id === a.id))}`,
    },
    setVolume: {
        check: (tl, a) => clipArgs(a, ['volume']) && MEDIA_KINDS.includes(a.kind) && num(a.volume, 0, 1) && exists(tl, a),
        run: (tl, a) => updateSequenceClip(tl, a.kind, a.id, { volume: a.volume }),
        say: (tl, a) => `Set the volume of ${labelOf(tl, a.kind, tl[a.kind].find(c => c.id === a.id))} to ${Math.round(a.volume * 100)}%`,
    },
    setSpeed: {
        check: (tl, a) => clipArgs(a, ['rate']) && MEDIA_KINDS.includes(a.kind) && num(a.rate, 0.25, 4) && exists(tl, a),
        run: (tl, a) => setSequenceRate(tl, a.kind, a.id, a.rate),
        say: (tl, a) => `Play ${labelOf(tl, a.kind, tl[a.kind].find(c => c.id === a.id))} at ${a.rate}x speed`,
    },
    addText: {
        check: (tl, a) => isObject(a) && keysOk(a, ['op', 'text', 'start', 'len']) && typeof a.text === 'string' && a.text.trim().length > 0 && a.text.length <= AGENT_LIMITS.maxTextChars && int(a.start, 0, SEQUENCE_MAX) && int(a.len, 1, SEQUENCE_MAX),
        run: (tl, a) => addSequenceText(tl, { text: clean(a.text, AGENT_LIMITS.maxTextChars), start: a.start, len: a.len }),
        say: (_tl, a) => `Add the text "${clean(a.text, 40)}" at ${formatTime(a.start)} for ${(a.len / FPS).toFixed(1)} s`,
    },
    setText: {
        check: (tl, a) => keysOk(a, ['op', 'id', 'text']) && typeof a.id === 'string' && tl.text.some(c => c.id === a.id) && typeof a.text === 'string' && a.text.trim().length > 0 && a.text.length <= AGENT_LIMITS.maxTextChars,
        run: (tl, a) => updateSequenceClip(tl, 'text', a.id, { text: clean(a.text, AGENT_LIMITS.maxTextChars) }),
        say: (tl, a) => `Change the text "${clean(tl.text.find(c => c.id === a.id).text, 24)}" to "${clean(a.text, 40)}"`,
    },
    insertMedia: {
        check: (tl, a) => keysOk(a, ['op', 'mediaId', 'start']) && typeof a.mediaId === 'string' && Object.hasOwn(tl.media, a.mediaId) && MEDIA_KINDS.includes(tl.media[a.mediaId].kind) && (a.start === undefined || int(a.start, 0, SEQUENCE_MAX)),
        run: (tl, a) => addSequenceClip(tl, tl.media[a.mediaId].kind, a.mediaId, a.start === undefined ? {} : { start: a.start }),
        say: (tl, a) => `Add ${clean(tl.media[a.mediaId].name, 30) || 'a clip'} to the timeline${a.start === undefined ? '' : ` at ${formatTime(a.start)}`}`,
    },
});
export const AGENT_OPS = Object.freeze(Object.keys(AGENT_COMMANDS));

const clipCount = tl => tl.video.length + tl.audio.length + tl.text.length;

/**
 * Checks a returned plan against a timeline and says what it would do. Never changes `tl`. Result: { ok, error?, steps, skipped, next?, before, after }.
 *  - a command that is not on the list is skipped and reported, never repaired or guessed at;
 *  - any listed command that is malformed, refers to something that is not there, or fails the editor's own checks refuses the whole plan;
 *  - a plan may not remove more than half the clips on the timeline, nor all of them: a bulk delete is a manual job.
 */
export function checkPlan(tl, plan) {
    const before = { clips: clipCount(tl), end: sequenceEnd(tl) };
    if (!isObject(plan) || !Array.isArray(plan.commands)) return { ok: false, error: 'The plan is not in the expected form.', steps: [], skipped: [], before };
    let bytes = 0;
    try { bytes = JSON.stringify(plan).length; } catch { return { ok: false, error: 'The plan is not in the expected form.', steps: [], skipped: [], before }; }
    if (bytes > AGENT_LIMITS.maxPlanBytes) return { ok: false, error: 'The plan is too large.', steps: [], skipped: [], before };
    if (plan.commands.length > AGENT_LIMITS.maxCommands) return { ok: false, error: `A plan may have at most ${AGENT_LIMITS.maxCommands} steps.`, steps: [], skipped: [], before };
    const steps = [], skipped = [];
    let next = tl, removed = 0;
    for (const [index, command] of plan.commands.entries()) {
        const op = isObject(command) && typeof command.op === 'string' && Object.hasOwn(AGENT_COMMANDS, command.op) ? command.op : null;
        if (!op) { skipped.push({ index, op: isObject(command) ? clean(command.op, 40) : '', reason: 'This kind of step is not allowed.' }); continue; }
        const spec = AGENT_COMMANDS[op];
        if (!spec.check(next, command)) return { ok: false, error: `Step ${index + 1} (${op}) is not valid for this timeline.`, steps, skipped, before };
        const text = spec.say(next, command);
        const result = spec.run(next, command);
        if (result.error) return { ok: false, error: `Step ${index + 1}: ${result.error}`, steps, skipped, before };
        if (spec.destructive) removed += clipCount(next) - clipCount(result) > 0 ? 1 : 0;
        steps.push({ index, op, text, destructive: !!spec.destructive });
        next = result;
    }
    if (!steps.length) return { ok: false, error: skipped.length ? 'Every step in the plan was a kind this editor does not allow.' : 'The plan has nothing to change.', steps, skipped, before };
    if (removed && (removed >= before.clips || removed > Math.floor(before.clips * AGENT_LIMITS.maxRemovedShare))) {
        return { ok: false, error: `This plan would remove ${removed} of ${before.clips} clips. Plans may remove at most half, and never all; delete in bulk yourself.`, steps, skipped, before };
    }
    return { ok: true, steps, skipped, next, before, after: { clips: clipCount(next), end: sequenceEnd(next) } };
}

/** One line for the top of the diff. */
export function planSummary(result) {
    if (!result.ok) return result.error;
    const d = result.after.clips - result.before.clips;
    return helperEnglish('clips_length', { value1: result.steps.length, value2: result.steps.length === 1 ? 'step' : 'steps', value3: result.before.clips, value4: result.after.clips, value5: d >= 0 ? '+' : '', value6: d, value7: formatTime(result.before.end), value8: formatTime(result.after.end) });
}

const generated = (id, media) => !/^l-/.test(id) || !!media.assetSource;

/**
 * Exactly what would be sent to a model. Only ids, times, short labels of local files, caption and text content, and the user's instruction.
 * Never media bytes, Library or asset URLs, prompts of generated assets, project or account details. The transcript sits in its own field,
 * marked as untrusted: the instruction field holds only what the user typed.
 */
export function buildAgentRequest(tl, instruction, transcriptText = '') {
    const text = clean(instruction, AGENT_LIMITS.maxInstructionChars);
    if (!text) return fail('Say what you want changed.');
    const all = [...tl.video.map(c => ['video', c]), ...tl.audio.map(c => ['audio', c]), ...tl.text.map(c => ['text', c])];
    if (all.length > AGENT_LIMITS.maxClipsSent) return fail(`This timeline has more than ${AGENT_LIMITS.maxClipsSent} clips. Select fewer before asking.`);
    const clips = all.map(([kind, c]) => ({
        id: c.id, kind, track: c.trackId, start: c.start, len: c.len, ...(kind !== 'text' ? { in: c.in, volume: c.volume, rate: c.rate ?? 1, media: c.mediaId } : { text: clean(c.text, 120) }),
    }));
    const media = Object.values(tl.media).filter(m => MEDIA_KINDS.includes(m.kind) || ['image', 'graphic'].includes(m.kind)).map(m => ({
        id: m.id, kind: m.kind, seconds: Number((m.frames / FPS).toFixed(1)), label: generated(m.id, m) ? 'generated or Library media' : clean(m.name, AGENT_LIMITS.maxLabelChars),
    }));
    const raw = String(transcriptText || '');
    return {
        instruction: text,
        timeline: { fps: FPS, tracks: tl.tracks.map(t => ({ id: t.id, kind: t.kind, locked: !!t.locked })), clips, media },
        untrustedTranscript: { text: clean(raw, AGENT_LIMITS.maxTranscriptChars), truncated: clean(raw, Infinity).length > AGENT_LIMITS.maxTranscriptChars },
        allowedOps: AGENT_OPS,
    };
}

const firstOf = (tl, kind) => [...tl[kind]].sort((a, b) => a.start - b.start)[0];
const lastOf = (tl, kind) => [...tl[kind]].sort((a, b) => b.start - a.start)[0];
const pick = (tl, which) => (which === 'last' ? lastOf(tl, 'video') : firstOf(tl, 'video'));

/**
 * A stand-in for the model, for the dry run and for tests: reads ONLY request.instruction with a few fixed phrases. It never looks at the
 * transcript. Anything else gives an empty plan. The real model arrives in slice E.
 */
export function stubModel(request, tl) {
    const text = request.instruction.toLowerCase();
    let m;
    if ((m = text.match(/^split (?:the )?(first|last) (?:video )?clip at (\d+(?:\.\d+)?) ?(?:s|sec|seconds)$/))) {
        const clip = pick(tl, m[1]);
        return { commands: clip ? [{ op: 'split', kind: 'video', id: clip.id, frame: Math.round(Number(m[2]) * FPS) + clip.start }] : [] };
    }
    if ((m = text.match(/^remove (?:the )?(first|last) (?:video )?clip$/))) {
        const clip = pick(tl, m[1]);
        return { commands: clip ? [{ op: 'remove', kind: 'video', id: clip.id, ripple: true }] : [] };
    }
    if ((m = text.match(/^set (?:the )?volume of (?:the )?(first|last) (?:video )?clip to (\d{1,3}) ?%$/))) {
        const clip = pick(tl, m[1]);
        return { commands: clip ? [{ op: 'setVolume', kind: 'video', id: clip.id, volume: Math.min(100, Number(m[2])) / 100 }] : [] };
    }
    if ((m = text.match(/^add (?:the )?title "([^"]{1,100})"$/))) {
        return { commands: [{ op: 'addText', text: request.instruction.match(/"([^"]{1,100})"/)[1], start: 0, len: 3 * FPS }] };
    }
    return { commands: [] };
}

/** Locale-neutral display diagnostic; the legacy string interface remains available. */
export function planSummaryDiagnostic(result) {
    if (!result.ok) return helperDiagnostic(result.error);
    const delta = result.after.clips - result.before.clips;
    return helperMessage('clips_length', { value1: result.steps.length, value2: result.steps.length === 1 ? 'step' : 'steps', value3: result.before.clips, value4: result.after.clips, value5: delta >= 0 ? '+' : '', value6: delta, value7: formatTime(result.before.end), value8: formatTime(result.after.end) });
}
