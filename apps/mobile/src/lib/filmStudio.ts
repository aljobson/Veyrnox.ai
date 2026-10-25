// Film Studio on the phone: validate the same studio document used by native editing and account cloud saves, show its
// stages, shots and assets, and hand a current shot prompt to Create.
// The checks below are copies of app/veyrnox/_lib/filmStudio.js and filmStudioStorage.js; __tests__/filmStudio.test.ts
// runs both on the same studio so a change on the web that this file misses fails a test.
import { estimateCredits, kindOf, textInput, type CatalogModel } from './media';

export const MAX_FILM_BYTES = 1_000_000;
export const FILM_STUDIO_WEB_PATH = '/app/film-studio';
const FIELD_MAX = 24_000;

export const FILM_STAGES: readonly (readonly [string, string])[] = [
    ['setup', 'Set up your tools'],
    ['studio-init', 'Create your studio'],
    ['film-breakdown', 'Break down the film'],
    ['reference-board', 'Approve references'],
    ['asset-passport', 'Create asset passports'],
    ['stress-test', 'Test and lock assets'],
    ['shot-prompt', 'Write shot prompts'],
];
export const STYLE_BOARDS = ['light', 'color', 'optics', 'camera movement', 'texture', 'cutting tempo', 'sound'];
export const PROMPT_BLOCKS = ['Scene context', 'Active references', 'Location map', 'First-frame blocking', 'Format mode', 'Optics', 'Camera body', 'Action timing', 'Physics', 'Lighting', 'Audio', 'Character acting', 'Style prefix', 'Quality bar', 'Positive constraints'];
export const PROMPT_DETAILS = [['map', 'Positions, distances in metres and camera axis'], ['camera', 'Camera height, support, path and stopping point'], ['timing', 'Action beats of 0.3–0.8 seconds'], ['physics', 'Persistent physical consequences'], ['lighting', 'Light sources and palette from the location passport'], ['audio', 'Ambience and in-frame sound'], ['palette', '60:30:10 dominant, secondary and accent colours'], ['quality', 'Reference match and quality requirements'], ['constraints', 'Visible positive constraints and the failure condition']] as const;
export const SHOT_LANES: readonly (readonly [string, readonly (readonly [string, string])[]])[] = [
    ['Identity', [['id', 'Scene / shot ID'], ['location', 'Location asset'], ['time', 'Time of day'], ['characters', 'Character assets'], ['props', 'Prop assets'], ['description', 'Description'], ['dialogue', 'Verbatim dialogue'], ['seconds', 'Running time'], ['complexity', 'Complexity']]],
    ['Direction', [['goal', 'Shot goal'], ['action', 'Task as a verb'], ['dramaturgy', 'Dramaturgy'], ['blocking', 'Blocking'], ['acting', 'Acting'], ['style', 'Style device']]],
    ['Camera / edit', [['size', 'Shot size'], ['movement', 'Camera movement'], ['lens', 'Lens'], ['angle', 'Angle'], ['cut', 'Cut type'], ['pace', 'Pace'], ['transition', 'Transition']]],
];
export const ACCEPTANCE_CHECKS = ['References match', 'Anatomy and surfaces are clean', 'Camera follows the card', 'Performance and lip-sync hold', 'Continuity matches adjacent shots', 'Palette matches'];

export interface Shot { [field: string]: string | boolean; id: string; oneAction: boolean }
export interface Board { id: string; name: string; type: string; decision: string; references: { source: string; caption: string; kind: string }[] }
export interface Asset { tag: string; version: number; type: string; descriptor: string; references: string[]; tests: Record<string, { result: string; verdict: string }>; lock?: { context: string; at: string } }
export interface Prompt { shot: string; version: number; content: string; context: string; at: string }
export interface Attempt { shot: string; version: number; result: string; changed: string; verdict: string; checks?: string[]; at: string }
export interface Film {
    schema: 1;
    name: string;
    templateId: string;
    targetSeconds: number;
    stack: { image: string; video: string; imageAccess: string; videoAccess: string; seconds: string; aspect: string };
    script: string;
    shots: Shot[];
    boards: Board[];
    assets: Asset[];
    prompts: Prompt[];
    attempts: Attempt[];
}

export function emptyFilm(): Film {
    return {
        schema: 1, name: '', templateId: '', targetSeconds: 60,
        stack: { image: '', video: '', imageAccess: 'Studio', videoAccess: 'Studio', seconds: '10', aspect: '16:9' },
        script: '', shots: [], boards: [], assets: [], prompts: [], attempts: [],
    };
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const strings = (v: unknown, keys: readonly string[]): boolean =>
    isObj(v) && keys.every((k) => typeof v[k] === 'string' && (v[k] as string).length <= (k === 'context' ? MAX_FILM_BYTES : FIELD_MAX) && !(v[k] as string).includes('\0'));
const list = (v: unknown, limit: number, valid: (x: any) => boolean): boolean => Array.isArray(v) && v.length <= limit && v.every(valid);
const byteLength = (text: string): number => {
    let n = 0;
    for (const ch of text) {
        const c = ch.codePointAt(0) as number;
        n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
    }
    return n;
};

const STACK_KEYS = ['image', 'video', 'imageAccess', 'videoAccess', 'seconds', 'aspect'];
const SHOT_KEYS = SHOT_LANES.flatMap(([, fields]) => fields.map(([k]) => k));

export type ParseResult = { ok: true; film: Film } | { ok: false; error: string };

// The same schema, size, bounds and identifier checks as the web workspace.
export function parseFilm(raw: string): ParseResult {
    if (typeof raw !== 'string' || byteLength(raw) > MAX_FILM_BYTES) return { ok: false, error: 'The studio file must be smaller than 1 MB.' };
    let f: unknown;
    try {
        f = JSON.parse(raw);
    } catch {
        return { ok: false, error: 'That is not a valid Film Studio project.' };
    }
    if (isObj(f) && f.targetSeconds === undefined) f = { ...f, targetSeconds: 60 };
    if (isObj(f) && f.templateId === undefined) f = { ...f, templateId: '' };
    const bad = { ok: false, error: 'This is not a valid Film Studio project.' } as const;
    if (!isObj(f) || f.schema !== 1 || !strings(f, ['name', 'script', 'templateId']) || !/^(?:|[a-z0-9][a-z0-9-]{0,99})$/.test(f.templateId as string)) return bad;
    if (![30, 60, 90, 120].includes(f.targetSeconds as number) || !strings(f.stack, STACK_KEYS) || !['16:9', '9:16', '1:1'].includes((f.stack as Obj).aspect as string)) return bad;
    const valid =
        list(f.shots, 200, (s) => strings(s, SHOT_KEYS) && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,60}$/.test(s.id) && typeof s.oneAction === 'boolean') &&
        list(f.boards, 300, (b) => strings(b, ['id', 'name', 'type', 'decision']) && ['character', 'location', 'prop', 'style'].includes(b.type) && list(b.references, 100, (r) => strings(r, ['source', 'caption', 'kind']) && ['reference', 'anti-reference'].includes(r.kind))) &&
        list(f.assets, 200, (a) =>
            strings(a, ['tag', 'type', 'descriptor']) && /^@[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(a.tag) && Number.isInteger(a.version) && a.version >= 1 && a.version <= 9999 && ['character', 'location', 'prop'].includes(a.type) &&
            list(a.references, 100, (r) => typeof r === 'string' && r.length <= 2000) &&
            isObj(a.tests) && Object.keys(a.tests).length <= 1000 && Object.values(a.tests).every((t) => strings(t, ['result', 'verdict']) && ['pending', 'pass', 'miss'].includes((t as Obj).verdict as string)) &&
            (!a.lock || strings(a.lock, ['context', 'at']))) &&
        list(f.prompts, 1000, (p) => strings(p, ['shot', 'content', 'context', 'at']) && Number.isInteger(p.version) && p.version > 0) &&
        list(f.attempts, 1000, (a) => strings(a, ['shot', 'result', 'verdict', 'changed', 'at']) && Number.isInteger(a.version) && a.version > 0 && ['accepted', 'rejected'].includes(a.verdict) &&
            (a.verdict !== 'accepted' || (list(a.checks, 6, (c) => ACCEPTANCE_CHECKS.includes(c)) && ACCEPTANCE_CHECKS.every((c) => a.checks.includes(c)))));
    if (!valid) return bad;
    const film = f as unknown as Film;
    const unique = (items: unknown[]) => new Set(items).size === items.length;
    if (!unique(film.shots.map((s) => s.id)) || !unique(film.boards.map((b) => b.id)) || !unique(film.assets.map((a) => assetKey(a))) || !unique(film.prompts.map((p) => `${p.shot}:${p.version}`)) || !unique(film.attempts.map((a) => `${a.shot}:${a.version}`))) {
        return { ok: false, error: 'The studio file contains duplicate identifiers.' };
    }
    return { ok: true, film };
}

const present = (v: unknown): boolean => typeof v === 'string' && v.trim().length > 0;
export const assetKey = (a: { tag: string; version: number }): string => `${a.tag}:v${a.version}`;
export const assetTags = (value: unknown): string[] => String(value || '').split(',').map((s) => s.trim()).filter((s) => s && s !== 'none');
export const shotAssets = (s: Shot): string[] => [...new Set([s.location as string, ...assetTags(s.characters), ...assetTags(s.props)].filter(present))];
export const validAssetKey = (k: unknown): boolean => /^@[a-zA-Z][a-zA-Z0-9_]{0,39}:v[1-9]\d{0,3}$/.test(String(k));

export function assetType(film: Film, key: string): string {
    if (film.shots.some((s) => s.location === key)) return 'location';
    return film.shots.some((s) => assetTags(s.characters).includes(key)) ? 'character' : 'prop';
}

export function shotIssues(s: Shot): string[] {
    const issues = SHOT_LANES.flatMap(([, fields]) => fields.filter(([key]) => !present(s[key])).map(([, label]) => `${label} is missing.`));
    if (!(Number(s.seconds) >= 10 && Number(s.seconds) <= 15)) issues.push('A clip must last 10–15 seconds.');
    if (!s.oneAction) issues.push('Confirm that the clip contains one action.');
    if (!validAssetKey(s.location)) issues.push('Use an exact location tag and version, such as @room:v1.');
    if ([...assetTags(s.characters), ...assetTags(s.props)].some((k) => !validAssetKey(k))) issues.push('Character and prop tags need an exact version. Use none for an empty list.');
    if (s.text && (!present(s.textPlacement) || !present(s.textContext))) issues.push('Give the separate text task its placement and context.');
    return issues;
}

function boardIssues(b: Board): string[] {
    const refs = b.references.filter((r) => r.kind === 'reference');
    const range = ({ character: [10, 20], location: [8, 15], prop: [3, 5], style: [1, 100] } as Record<string, number[]>)[b.type];
    const issues: string[] = [];
    if (!range || refs.length < range[0] || refs.length > range[1]) issues.push(`${b.name}: needs ${range?.join('–') || 'valid'} references.`);
    if (b.references.some((r) => !present(r.source) || !present(r.caption))) issues.push(`${b.name}: every reference needs its source and a precise caption.`);
    if (new Set(b.references.map((r) => r.source.trim())).size !== b.references.length) issues.push(`${b.name}: reference sources must be distinct.`);
    if (b.decision !== 'approved') issues.push(`${b.name}: needs a written approval.`);
    return issues;
}

export interface MatrixRow { id: string; angle: string; size: string; shot: string; light: string; pair: string }

export function testMatrix(film: Film, asset: Asset): MatrixRow[] {
    const key = assetKey(asset);
    const scenes = film.shots.filter((s) => shotAssets(s).includes(key));
    const rows: MatrixRow[] = Array.from({ length: asset.type === 'character' ? 10 : 5 }, (_, i) => {
        const s = scenes[i % scenes.length];
        return { id: `view-${i}`, angle: ['front', 'three-quarter', 'profile', 'back', 'close detail'][i % 5], size: i < 5 ? 'medium' : 'wide', shot: s?.id || '', light: (s?.time as string) || '', pair: '' };
    });
    for (const s of scenes) {
        rows.push({ id: `light-${s.id}`, angle: s.angle as string, size: s.size as string, shot: s.id, light: s.time as string, pair: '' });
        for (const pair of shotAssets(s).filter((k) => k !== key)) rows.push({ id: `pair-${s.id}-${pair}`, angle: 'three-quarter', size: 'two-shot', shot: s.id, light: s.time as string, pair });
    }
    return rows;
}

export function lockContext(film: Film, asset: Asset | undefined): string {
    if (!asset) return '';
    const matrix = testMatrix(film, asset);
    return JSON.stringify({
        descriptor: asset.descriptor, references: asset.references, type: asset.type, boards: film.boards, matrix,
        pairings: film.assets.filter((a) => matrix.some((r) => r.pair === assetKey(a))).map((a) => [assetKey(a), a.descriptor, a.references]),
    });
}

export function isLocked(film: Film, asset: Asset | undefined): boolean {
    if (!asset || !asset.lock || asset.lock.context !== lockContext(film, asset)) return false;
    const rows = testMatrix(film, asset);
    return rows.every((row) => asset.tests?.[row.id]?.verdict === 'pass' && present(asset.tests[row.id].result)) && new Set(rows.map((r) => asset.tests[r.id].result.trim())).size === rows.length;
}

export function lockAsset(film: Film, key: string): Film {
    for (let stage = 0; stage < 5; stage += 1) {
        const issue = stageIssues(film, stage)[0];
        if (issue) throw new Error(issue);
    }
    const asset = film.assets.find((item) => assetKey(item) === key);
    if (!asset) throw new Error('The asset passport is missing.');
    const rows = testMatrix(film, asset);
    if (!rows.every((row) => asset.tests?.[row.id]?.verdict === 'pass' && present(asset.tests[row.id].result))) throw new Error('Every test needs an output reference and a pass.');
    if (new Set(rows.map((row) => asset.tests[row.id].result.trim())).size !== rows.length) throw new Error('Every test needs its own distinct output.');
    return { ...film, assets: film.assets.map((item) => item === asset ? { ...item, lock: { context: lockContext(film, item), at: new Date().toISOString() } } : item) };
}

export function referenceSheet(asset: Asset): string {
    return `${asset.descriptor}\nNeutral grey background. Five views of the same asset: front, three-quarter, profile, back and close detail. Identity, materials and the variant state match across every view. References: ${asset.references.join(', ')}.`;
}

export function testPrompt(film: Film, asset: Asset, row: MatrixRow): string {
    const paired = film.assets.find((item) => assetKey(item) === row.pair);
    return [asset.descriptor, `References: ${asset.references.join(', ')}.`, `${row.angle}, ${row.size}. Static image. Scene ${row.shot}, light: ${row.light}.`, paired?.descriptor, paired && `Paired references: ${paired.references.join(', ')}. Both identities match their references.`].filter(Boolean).join('\n');
}

export function promptContext(film: Film, shot: Shot): string {
    return JSON.stringify([film.stack, shot, film.boards, shotAssets(shot).map((k) => {
        const a = film.assets.find((x) => assetKey(x) === k);
        return a && [k, a.descriptor, a.references, a.lock];
    })]);
}

export function buildShotPrompt(film: Film, shot: Shot, details: Record<string, string>): string {
    for (let stage = 0; stage < 6; stage += 1) {
        const issue = stageIssues(film, stage)[0];
        if (issue) throw new Error(issue);
    }
    if (PROMPT_DETAILS.some(([key]) => !present(details[key]))) throw new Error('Complete every prompt detail.');
    const assets = shotAssets(shot).map((key) => film.assets.find((item) => assetKey(item) === key) as Asset);
    const characters = assetTags(shot.characters).length;
    const values = [
        `EXACT ${characters} CHARACTERS — NO DUPLICATES. ${shot.id}. ${shot.goal}. ${shot.action}. ${shot.description}`,
        assets.map((asset) => `${assetKey(asset)}\n${asset.descriptor}\nReference files: ${asset.references.join(', ')}`).join('\n\n'),
        details.map, String(shot.blocking), `${film.stack.aspect}. ${film.stack.video}. ${film.stack.videoAccess}. ${shot.seconds} seconds.`,
        `${shot.lens}. Field of view changes on a hard cut.`, `${shot.angle}. ${shot.movement}. ${details.camera}`,
        details.timing, details.physics, details.lighting,
        `${details.audio}${shot.dialogue === 'none' ? '' : `\nDialogue, verbatim: ${shot.dialogue}`}`, String(shot.acting),
        `${shot.style}. ${details.palette}.`, details.quality, details.constraints,
    ];
    return PROMPT_BLOCKS.map((label, index) => `${index + 1}. ${label}\n${values[index]}`).join('\n\n');
}

export function nextPromptVersion(film: Film, shot: Shot, content: string): Prompt {
    const headings = content.split('\n').filter((line) => /^\d+\. /.test(line));
    if (headings.length !== 15 || PROMPT_BLOCKS.some((title, index) => headings[index] !== `${index + 1}. ${title}`)) throw new Error('Preserve all fifteen prompt blocks in their original order.');
    const previous = film.prompts.filter((prompt) => prompt.shot === shot.id).sort((a, b) => a.version - b.version);
    const last = previous.at(-1);
    if (last && !film.attempts.some((attempt) => attempt.shot === shot.id && attempt.version === last.version)) throw new Error('Log the previous generation result and verdict before revising.');
    if (last && last.context === promptContext(film, shot)) {
        const before = last.content.split('\n');
        const after = content.split('\n');
        if (before.length !== after.length || before.filter((line, index) => line !== after[index]).length !== 1) throw new Error('Change exactly one line. Keep all other lines verbatim.');
        const descriptors = shotAssets(shot).map((key) => film.assets.find((asset) => assetKey(asset) === key)?.descriptor ?? '');
        if (descriptors.some((descriptor) => !content.includes(descriptor))) throw new Error('Canonical descriptors must stay verbatim.');
        if (shot.dialogue !== 'none' && !content.includes(String(shot.dialogue))) throw new Error('Keep the supplied dialogue verbatim.');
    }
    return { shot: shot.id, version: (last?.version ?? 0) + 1, content, context: promptContext(film, shot), at: new Date().toISOString() };
}

export function logFilmAttempt(film: Film, prompt: Prompt, entry: { result: string; changed: string; verdict: 'accepted' | 'rejected'; checks?: string[] }): Film {
    if (!film.prompts.includes(prompt) || !present(entry.result) || !present(entry.changed)) throw new Error('Record the result and what changed.');
    if (film.attempts.some((attempt) => attempt.shot === prompt.shot && attempt.version === prompt.version)) throw new Error('This prompt version already has a result.');
    const shot = film.shots.find((item) => item.id === prompt.shot);
    if (!shot || prompt.context !== promptContext(film, shot) || Array.from({ length: 6 }, (_, index) => index).some((stage) => stageIssues(film, stage).length)) throw new Error('Rebuild the prompt from the current locked passports before recording an attempt.');
    if (entry.verdict === 'accepted' && !ACCEPTANCE_CHECKS.every((check) => entry.checks?.includes(check))) throw new Error('An accepted take needs all six quality checks.');
    return { ...film, attempts: [...film.attempts, { shot: prompt.shot, version: prompt.version, result: entry.result, changed: entry.changed, verdict: entry.verdict, checks: entry.checks ?? [], at: new Date().toISOString() }] };
}

export function stageIssues(film: Film, stage: number): string[] {
    if (stage === 0) {
        return [!present(film.stack.image) && 'Choose an image model.', !present(film.stack.video) && 'Choose a video model.', !(Number(film.stack.seconds) >= 10 && Number(film.stack.seconds) <= 15) && 'Choose a clip length of 10–15 seconds.'].filter(Boolean) as string[];
    }
    if (stage === 1) return present(film.name) ? [] : ['Name your studio.'];
    if (stage === 2) {
        return [!present(film.script) && 'Add the script, treatment or idea.', !film.shots.length && 'Add at least one shot.', ...film.shots.flatMap((s) => shotIssues(s).map((i) => `${s.id || 'Shot'}: ${i}`)), new Set(film.shots.map((s) => s.id)).size !== film.shots.length && 'Shot IDs must be unique.'].filter(Boolean) as string[];
    }
    const required = [...new Set(film.shots.flatMap(shotAssets))];
    if (stage === 3) {
        return [
            ...required.filter((k) => !film.boards.some((b) => b.name === k && b.type === assetType(film, k))).map((k) => `Add a ${assetType(film, k)} reference board for ${k}.`),
            ...STYLE_BOARDS.filter((k) => !film.boards.some((b) => b.name === k && b.type === 'style')).map((k) => `Add the ${k} style board.`),
            ...film.boards.flatMap(boardIssues),
        ];
    }
    if (stage === 4) {
        return required.flatMap((k) => {
            const a = film.assets.find((x) => assetKey(x) === k);
            if (!a) return [`Create the ${k} passport.`];
            return a.type !== assetType(film, k) || !present(a.descriptor) || !a.references.length || a.references.some((r) => !present(r)) ? [`${k}: complete its type, descriptor and reference files.`] : [];
        });
    }
    if (stage === 5) return required.filter((k) => !isLocked(film, film.assets.find((a) => assetKey(a) === k))).map((k) => `${k} is draft. Pass its entire test matrix and record the lock decision.`);
    return film.shots.filter((s) => !film.prompts.some((p) => p.shot === s.id && p.context === promptContext(film, s))).map((s) => `Write the current prompt for ${s.id}.`);
}

export interface StageStatus { readonly id: string; readonly title: string; readonly open: number; readonly done: boolean; readonly first: string | null }

// A stage is done when it has nothing left to fix. Each is checked on its own, so the list shows exactly what the web shows.
export function stageStatuses(film: Film): StageStatus[] {
    return FILM_STAGES.map(([id, title], i) => {
        const issues = stageIssues(film, i);
        return { id, title, open: issues.length, done: issues.length === 0, first: issues[0] ?? null };
    });
}

export type ShotState = 'accepted' | 'prompt-ready' | 'prompt-stale' | 'no-prompt' | 'blocked';

export interface ShotRow {
    readonly shot: Shot;
    readonly state: ShotState;
    readonly label: string;
    readonly attempts: number;
    readonly assets: readonly { key: string; locked: boolean }[];
}

const STATE_LABEL: Record<ShotState, string> = {
    accepted: 'Take accepted',
    'prompt-ready': 'Prompt ready',
    'prompt-stale': 'Prompt out of date',
    'no-prompt': 'No prompt yet',
    blocked: 'Waiting for locked assets',
};

export function latestPrompt(film: Film, shotId: string): Prompt | null {
    const mine = film.prompts.filter((p) => p.shot === shotId);
    return mine.reduce<Prompt | null>((best, p) => (!best || p.version > best.version ? p : best), null);
}

export function shotRow(film: Film, shot: Shot): ShotRow {
    const assets = shotAssets(shot).map((key) => ({ key, locked: isLocked(film, film.assets.find((a) => assetKey(a) === key)) }));
    const attempts = film.attempts.filter((a) => a.shot === shot.id);
    const prompt = latestPrompt(film, shot.id);
    let state: ShotState;
    if (attempts.some((a) => a.verdict === 'accepted')) state = 'accepted';
    else if (!assets.every((a) => a.locked)) state = 'blocked';
    else if (!prompt) state = 'no-prompt';
    else state = prompt.context === promptContext(film, shot) ? 'prompt-ready' : 'prompt-stale';
    return { shot, state, label: STATE_LABEL[state], attempts: attempts.length, assets };
}

export const shotRows = (film: Film): ShotRow[] => film.shots.map((s) => shotRow(film, s));

// What a shot can be sent to Create with: a prompt that still matches the locked passports, a video model in today's
// catalog that offers the shot's length, and the words inside that model's own limit (never cut short). The price is the
// catalog's; Create shows it again and charges only on its own Generate button.
export type Handoff =
    | { ok: true; model: CatalogModel; credits: number; seconds: number; prompt: string }
    | { ok: false; reason: string };

export const normalizeName = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function findVideoModel(film: Film, catalog: readonly CatalogModel[]): CatalogModel | null {
    const want = normalizeName(film.stack.video);
    if (!want) return null;
    return catalog.find((m) => kindOf(m.modality) === 'video' && !m.gated && (normalizeName(m.id) === want || normalizeName(m.name) === want)) ?? null;
}

export function handoffFor(film: Film, shot: Shot, catalog: readonly CatalogModel[]): Handoff {
    const row = shotRow(film, shot);
    if (row.state === 'accepted') return { ok: false, reason: 'This shot already has an accepted take.' };
    if (row.state === 'blocked') return { ok: false, reason: 'Every asset in this shot must be locked on the web first.' };
    const prompt = latestPrompt(film, shot.id);
    if (!prompt) return { ok: false, reason: 'Write this shot’s prompt on the web first.' };
    if (row.state === 'prompt-stale') return { ok: false, reason: 'The prompt is out of date. Rebuild it on the web from the locked passports.' };
    const model = findVideoModel(film, catalog);
    if (!model) return { ok: false, reason: `${film.stack.video || 'The studio’s video model'} is not in today’s price list on the phone. Use the web, or choose it in Create.` };
    const seconds = Number(shot.seconds);
    if (!model.durations.includes(seconds)) return { ok: false, reason: `${model.name} does not offer ${seconds}-second clips.` };
    const limit = textInput(model)?.max;
    if (!limit || prompt.content.length > limit) return { ok: false, reason: `This prompt is ${prompt.content.length} characters; ${model.name} takes ${limit ?? 0}. It is never cut short. Share it to an external workflow, or continue on the web.` };
    return { ok: true, model, credits: estimateCredits(model, seconds), seconds, prompt: prompt.content };
}

export interface Summary {
    readonly name: string;
    readonly aspect: string;
    readonly shots: number;
    readonly assets: number;
    readonly lockedAssets: number;
    readonly acceptedShots: number;
    readonly stagesDone: number;
}

export function summarize(film: Film): Summary {
    const rows = shotRows(film);
    return {
        name: film.name || 'Untitled film',
        aspect: film.stack.aspect,
        shots: film.shots.length,
        assets: film.assets.length,
        lockedAssets: film.assets.filter((a) => isLocked(film, a)).length,
        acceptedShots: rows.filter((r) => r.state === 'accepted').length,
        stagesDone: stageStatuses(film).filter((s) => s.done).length,
    };
}
