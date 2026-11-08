import type { Timeline, TrackKind } from './nativeEditorModel';
import { runCommand, validateAgentTimeline, clean, type Command } from './editorAgentOperations';
import { t } from './i18n';
export type { Command } from './editorAgentOperations';
export const AGENT_LIMITS = Object.freeze({ maxCommands: 20, maxPlanBytes: 16 * 1024, maxInstructionChars: 500, maxTranscriptChars: 6000, maxTextChars: 200, maxClipsSent: 120, maxLabelChars: 60, maxRemovedShare: .5 });
const kinds = ['video', 'audio', 'text'];
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const number = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const int = (v: unknown, min = 0, max = 18000) => number(v, min, max) && Number.isInteger(v);
const keys = (a: Record<string, unknown>, allowed: string[]) => Object.keys(a).every(k => allowed.includes(k));
const clip = (tl: Timeline, a: Record<string, unknown>, extra: string[] = []) => keys(a, ['op', 'kind', 'id', ...extra]) && kinds.includes(a.kind as string) && typeof a.id === 'string' && /^[a-z][0-9]{1,6}$/.test(a.id) && tl[a.kind as TrackKind].some(c => c.id === a.id);
const text = (a: unknown): a is string => typeof a === 'string' && !!a.trim() && a.length <= 200;
type Check = (tl: Timeline, a: Record<string, unknown>) => boolean;
/** Port of app/veyrnox/_lib/editorAgentPlan.mjs: extra fields on known ops refuse the whole plan. */
export const AGENT_COMMANDS: Readonly<Record<string, Check>> = Object.freeze({
    split: (tl, a) => clip(tl, a, ['frame']) && int(a.frame, 1),
    trim: (tl, a) => clip(tl, a, ['edge', 'frames']) && ['in', 'out'].includes(a.edge as string) && int(a.frames, -18000),
    move: (tl, a) => clip(tl, a, ['start']) && int(a.start),
    remove: (tl, a) => clip(tl, a, ['ripple']) && (a.ripple === undefined || typeof a.ripple === 'boolean'),
    duplicate: (tl, a) => clip(tl, a),
    setVolume: (tl, a) => clip(tl, a, ['volume']) && a.kind !== 'text' && number(a.volume, 0, 1),
    setSpeed: (tl, a) => clip(tl, a, ['rate']) && a.kind !== 'text' && number(a.rate, .25, 4),
    addText: (_tl, a) => keys(a, ['op', 'text', 'start', 'len']) && text(a.text) && int(a.start) && int(a.len, 1),
    setText: (tl, a) => keys(a, ['op', 'id', 'text']) && typeof a.id === 'string' && tl.text.some(c => c.id === a.id) && text(a.text),
    insertMedia: (tl, a) => keys(a, ['op', 'mediaId', 'start']) && typeof a.mediaId === 'string' && Object.hasOwn(tl.media, a.mediaId) && ['video', 'audio'].includes(tl.media[a.mediaId].kind!) && (a.start === undefined || int(a.start)),
});
const STEP_KEYS: Record<string, string> = { split: 'editorAi.step.split', trim: 'editorAi.step.trim', move: 'editorAi.step.move', remove: 'editorAi.step.remove', duplicate: 'editorAi.step.duplicate', setVolume: 'editorAi.step.setVolume', setSpeed: 'editorAi.step.setSpeed', addText: 'editorAi.step.addText', setText: 'editorAi.step.setText', insertMedia: 'editorAi.step.insertMedia' };
export const AGENT_OPS = Object.freeze(Object.keys(AGENT_COMMANDS));
export type Freshness = { projectId: string; accountId: string; editRevision: number };
export const sameRevision = (a: Freshness, b: Freshness) => a.projectId === b.projectId && a.accountId === b.accountId && a.editRevision === b.editRevision;
export type Step = { index: number; op: string; text: string; destructive: boolean };
export type PlanResult = { ok: boolean; error?: string; steps: Step[]; skipped: { index: number; op: string; reason: string }[]; next?: Timeline; before: { clips: number; end: number }; after?: { clips: number; end: number } };
const count = (tl: Timeline) => tl.video.length + tl.audio.length + tl.text.length;
const end = (tl: Timeline) => Math.max(0, ...[...tl.video, ...tl.audio, ...tl.text].map(c => c.start + c.len));
export function checkPlan(tl: Timeline, plan: unknown, expected?: Freshness, current?: Freshness): PlanResult {
    const before = { clips: count(tl), end: end(tl) }, steps: Step[] = [], skipped: PlanResult['skipped'] = [];
    const refused = (key = 'editorAi.unusable'): PlanResult => ({ ok: false, error: t(key), steps, skipped, before });
    if (expected && (!current || !sameRevision(expected, current))) return refused('editorAi.stale');
    if (!object(plan) || !Array.isArray(plan.commands)) return refused();
    try { if (new TextEncoder().encode(JSON.stringify(plan)).byteLength > AGENT_LIMITS.maxPlanBytes || validateAgentTimeline(tl)) return refused(); } catch { return refused(); }
    if (plan.commands.length > 20) return refused();
    let next = tl, removed = 0;
    for (const [index, command] of plan.commands.entries()) {
        const op = object(command) && typeof command.op === 'string' && Object.hasOwn(AGENT_COMMANDS, command.op) ? command.op : null;
        if (!op) { skipped.push({ index, op: '', reason: 'unsupported_operation' }); continue; }
        if (!AGENT_COMMANDS[op](next, command)) return refused();
        const result = runCommand(next, command as Command);
        if ('error' in result) return refused();
        if (op === 'remove' && count(next) > count(result)) removed++;
        const kind = command.op === 'setText' ? 'text' : command.kind as TrackKind;
        const item = kind ? next[kind]?.find(c => c.id === command.id) : undefined;
        const media = next.media[(command.mediaId ?? (item && 'mediaId' in item ? item.mediaId : '')) as string];
        const label = item && 'text' in item ? clean(item.text).slice(0, 24) : media?.name ? clean(media.name).slice(0, 30) : command.id ?? command.mediaId ?? '';
        const inserted = op === 'insertMedia' ? result[media!.kind as TrackKind].at(-1) : null;
        const description = t(STEP_KEYS[op], { id: label, frame: command.frame ?? command.start ?? inserted?.start ?? '',
            value: command.frames ?? command.volume ?? command.rate ?? (typeof command.text === 'string' ? clean(command.text) : ''),
            edge: t(command.edge === 'in' ? 'editorAi.edge.in' : 'editorAi.edge.out'), len: command.len ?? '' });
        steps.push({ index, op, text: description + (op === 'remove' && command.ripple ? ` · ${t('editor.ripple')}` : ''), destructive: op === 'remove' });
        next = result;
    }
    if (!steps.length || (removed && (removed >= before.clips || removed > Math.floor(before.clips * .5)))) return refused();
    return { ok: true, steps, skipped, next, before, after: { clips: count(next), end: end(next) } };
}
export function planSummary(result: PlanResult): string {
    const time = (frames: number) => { const seconds = frames / 30, minutes = Math.floor(seconds / 60); return `${minutes}:${(seconds - minutes * 60).toFixed(1).padStart(4, '0')}`; };
    return result.ok ? t('editorAi.summary', { steps: result.steps.length, before: result.before.clips, after: result.after!.clips }) + ' · ' +
        t('editorCore.durationSeconds', { value1: `${time(result.before.end)} → ${time(result.after!.end)}` }) : result.error!;
}
