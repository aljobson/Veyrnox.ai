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
