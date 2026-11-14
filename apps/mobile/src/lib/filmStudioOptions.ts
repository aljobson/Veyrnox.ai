import { SHOT_LANES, type Film, type Shot } from './filmStudio';
import { optionsFor } from './createOptions';
import { kindOf, textInput, type CatalogModel } from './media';

const FORMATS = ['16:9', '9:16', '1:1'];
export const isStudio = (access: string): boolean => access === 'Studio';
const promptModel = (model: CatalogModel): boolean => {
    const inputs = model.capabilities?.inputs ?? {};
    return !!inputs.prompt && !model.gated && !inputs.clips && !inputs.topic && !inputs.plan_id;
};
export function setupModels(catalog: readonly CatalogModel[], kind: 'image' | 'video'): CatalogModel[] {
    return catalog.filter(m => kindOf(m.modality) === kind && promptModel(m) &&
        (kind !== 'video' || m.durations.some(n => n >= 10 && n <= 15)));
}
export function clipLengths(stack: Film['stack'], catalog: readonly CatalogModel[]): number[] {
    if (!isStudio(stack.videoAccess)) return [10, 11, 12, 13, 14, 15];
    const lengths = catalog.find(m => m.id === stack.video)?.durations.filter(n => n >= 10 && n <= 15) ?? [];
    return lengths.length ? lengths : [10];
}
export function frameFormats(stack: Film['stack'], catalog: readonly CatalogModel[]): string[] {
    const model = isStudio(stack.videoAccess) ? catalog.find(m => m.id === stack.video) : undefined;
    const formats = model ? optionsFor(model).aspects.filter(a => FORMATS.includes(a)) : [];
    return formats.length ? formats : [...FORMATS];
}
export function normalizeFilmStack(stack: Film['stack'], key: keyof Film['stack'], value: string, catalog: readonly CatalogModel[]): Film['stack'] {
    const next = { ...stack, [key]: value };
    const model = catalog.find(m => m.id === next.video);
    if (!isStudio(next.videoAccess) || !model) return next;
    const lengths = model.durations.filter(n => n >= 10 && n <= 15), formats = frameFormats(next, catalog);
    return { ...next, seconds: !lengths.length || lengths.includes(Number(next.seconds)) ? next.seconds : String(lengths[0]),
        aspect: formats.includes(next.aspect) ? next.aspect : formats[0] };
}
export function nextShotId(film: Film): string {
    const taken = new Set([...film.shots.map(s => s.id), ...film.prompts.map(p => p.shot), ...film.attempts.map(a => a.shot)]);
    let n = 1;
    while (taken.has(`sc01-sh${String(n).padStart(2, '0')}`)) n++;
    return `sc01-sh${String(n).padStart(2, '0')}`;
}
export const sanitizeShotId = (text: string): string => text.replace(/[^a-zA-Z0-9_-]/g, '');
export function shotIdProblem(film: Film, index: number, id: string): 'format' | 'duplicate' | 'history' | null {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,60}$/.test(id)) return 'format';
    if (film.shots.some((s, i) => i !== index && s.id === id)) return 'duplicate';
    if (!film.shots.some(s => s.id === id) && (film.prompts.some(p => p.shot === id) || film.attempts.some(a => a.shot === id))) return 'history';
    return null;
}
export function boardId(film: Film, name: string, type: string, taken: readonly string[]): string {
    const used = new Set([...film.boards.map(b => b.id), ...taken]);
    if (!used.has(name)) return name;
    const base = `${name}-${type}`;
    let id = base, n = 2;
    while (used.has(id)) id = `${base}-${n++}`;
    return id;
}
export function newShot(film: Film): Shot {
    return { ...Object.fromEntries(SHOT_LANES.flatMap(([, fields]) => fields.map(([key]) => [key, '']))),
        id: nextShotId(film), seconds: film.stack.seconds, characters: 'none', props: 'none', dialogue: 'none',
        oneAction: false, text: '', textPlacement: '', textContext: '' };
}
export function promptOpenState(model: CatalogModel | null | undefined, options: {
    access: string; live: boolean; prompt: string; duration?: number; aspect?: string;
}): { ok: true } | { ok: false; reason: 'access' | 'catalog' | 'limit' | 'duration' | 'aspect' } {
    if (!isStudio(options.access)) return { ok: false, reason: 'access' };
    if (!options.live || !model || !promptModel(model)) return { ok: false, reason: 'catalog' };
    const limit = textInput(model)?.max;
    if (!limit || options.prompt.length > limit) return { ok: false, reason: 'limit' };
    if (options.duration && !model.durations.includes(options.duration)) return { ok: false, reason: 'duration' };
    const aspects = optionsFor(model).aspects;
    if (options.aspect && aspects.length && !aspects.includes(options.aspect)) return { ok: false, reason: 'aspect' };
    return { ok: true };
}

const present = (v: unknown): boolean => typeof v === 'string' && v.trim().length > 0;
const clip = (text: string, max: number): string => text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
const firstSentence = (text: string): string => (text.trim().split(/(?<=[.!?])\s|\n/)[0] ?? '').trim();

// Quick start for one shot card. Fills only the fields that are empty, from the shot's own description (or the film's
// script) and the film setup. Plain local text: no network, no credits. The user reviews every value; the one-action
// confirmation is never ticked for them. Returns how many fields were filled.
export function fillShotDefaults(film: Film, index: number): { film: Film; filled: number } {
    const shot = film.shots[index];
    if (!shot) return { film, filled: 0 };
    const beat = firstSentence(String(shot.description ?? '')) || firstSentence(film.script) || `Shot ${index + 1}`;
    const known = film.shots.find((s, i) => i !== index && present(s.location))?.location;
    const suggestions: Record<string, string> = {
        location: String(known ?? '@location:v1'), time: 'Day', description: clip(beat, 400), complexity: 'Simple',
        goal: clip(`Show: ${beat}`, 200), action: 'Show', dramaturgy: 'Set up the moment, then let it land',
        blocking: 'Subject stays in one place in frame', acting: 'Natural and understated', style: 'Naturalistic',
        size: 'Medium', movement: 'Static', lens: '35mm', angle: 'Eye level', cut: 'Hard cut', pace: 'Steady', transition: 'Cut',
        seconds: film.stack.seconds || '10', characters: 'none', props: 'none', dialogue: 'none',
    };
    const next: Record<string, string | boolean> = { ...shot };
    let filled = 0;
    SHOT_LANES.flatMap(([, fields]) => fields).forEach(([key]) => {
        if (key === 'id' || present(shot[key]) || !(key in suggestions)) return;
        next[key] = suggestions[key]; filled++;
    });
    if (!filled) return { film, filled: 0 };
    return { film: { ...film, shots: film.shots.map((s, i) => i === index ? next as Shot : s) }, filled };
}
