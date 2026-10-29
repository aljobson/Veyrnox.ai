import { t } from './i18n';
import { optionsFor } from './createOptions';
// Film Studio on the phone: validate the same studio document used by native editing and account cloud saves, show its
// stages, shots and assets, and hand a current shot prompt to Create.
// The checks below are copies of app/veyrnox/_lib/filmStudio.js and filmStudioStorage.js; __tests__/filmStudio.test.ts
// runs both on the same studio so a change on the web that this file misses fails a test.
import { estimateCredits, kindOf, textInput, type CatalogModel } from './media';
import { GENERATION_PROMPT_MAX } from './promptLimits';

export const MAX_FILM_BYTES = 1_000_000;
export const FILM_STUDIO_WEB_PATH = '/app/film-studio';
const FIELD_MAX = 24_000;
const stringLimit = (key: string): number => key === 'context'
    ? MAX_FILM_BYTES
    : ['script', 'content'].includes(key) ? GENERATION_PROMPT_MAX : FIELD_MAX;

export const FILM_STAGES: readonly (readonly [string, string])[] = [
    ['setup', t('filmStudio.setupyourtools')],
    ['studio-init', t('filmStudio.createyourstudio')],
    ['film-breakdown', t('filmStudio.breakdownthefilm')],
    ['reference-board', t('filmStudio.approvereferences')],
    ['asset-passport', t('filmStudio.createassetpassports')],
    ['stress-test', t('filmStudio.testandlockassets')],
    ['shot-prompt', t('filmStudio.writeshotprompts')],
];
export const STYLE_BOARDS = ['light', 'color', 'optics', 'camera movement', 'texture', 'cutting tempo', 'sound'];
export const PROMPT_BLOCKS = ['Scene context', 'Active references', 'Location map', 'First-frame blocking', 'Format mode', 'Optics', 'Camera body', 'Action timing', 'Physics', 'Lighting', 'Audio', 'Character acting', 'Style prefix', 'Quality bar', 'Positive constraints'];
export const PROMPT_DETAILS = [['map', t('filmStudio.positionsdistancesinmetresandcameraaxis')], ['camera', t('filmStudio.cameraheightsupportpathandstoppingpoint')], ['timing', t('filmStudio.actionbeatsof0308')], ['physics', t('filmStudio.persistentphysicalconsequences')], ['lighting', t('filmStudio.lightsourcesandpalettefromthelocation')], ['audio', t('filmStudio.ambienceandinframesound')], ['palette', '60:30:10 dominant, secondary and accent colours'], ['quality', t('filmStudio.referencematchandqualityrequirements')], ['constraints', t('filmStudio.visiblepositiveconstraintsandthefailurecondition')]] as const;
export const SHOT_LANES: readonly (readonly [string, readonly (readonly [string, string])[]])[] = [
    [t('filmStudio.identity'), [['id', t('filmStudio.sceneshotID')], ['location', t('filmStudio.locationasset')], ['time', t('filmStudio.timeofday')], ['characters', t('filmStudio.characterassets')], ['props', t('filmStudio.propassets')], ['description', t('filmStudio.description')], ['dialogue', t('filmStudio.verbatimdialogue')], ['seconds', t('filmStudio.runningtime')], ['complexity', t('filmStudio.complexity')]]],
    [t('filmStudio.direction'), [['goal', t('filmStudio.shotgoal')], ['action', t('filmStudio.taskasaverb')], ['dramaturgy', t('filmStudio.dramaturgy')], ['blocking', t('filmStudio.blocking')], ['acting', t('filmStudio.acting')], ['style', t('filmStudio.styledevice')]]],
    [t('filmStudio.cameraedit'), [['size', t('filmStudio.shotsize')], ['movement', t('filmStudio.cameramovement')], ['lens', t('filmStudio.lens')], ['angle', t('filmStudio.angle')], ['cut', t('filmStudio.cuttype')], ['pace', t('filmStudio.pace')], ['transition', t('filmStudio.transition')]]],
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
    isObj(v) && keys.every((k) => typeof v[k] === 'string' && (v[k] as string).length <= stringLimit(k) && !(v[k] as string).includes('\0'));
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
    if (typeof raw !== 'string' || byteLength(raw) > MAX_FILM_BYTES) return { ok: false, error: t('filmStudio.thestudiofilemustbesmallerthan') };
    let f: unknown;
    try {
        f = JSON.parse(raw);
    } catch {
        return { ok: false, error: t('filmStudio.thatisnotavalidFilmStudio') };
    }
    if (isObj(f) && f.targetSeconds === undefined) f = { ...f, targetSeconds: 60 };
    if (isObj(f) && f.templateId === undefined) f = { ...f, templateId: '' };
    const bad = { ok: false, error: t('filmStudio.thisisnotavalidFilmStudio') } as const;
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
        return { ok: false, error: t('filmStudio.thestudiofilecontainsduplicateidentifiers') };
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
    const issues = SHOT_LANES.flatMap(([, fields]) => fields.filter(([key]) => !present(s[key])).map(([, label]) => t('filmStudio.ismissing', { value1: label })));
    if (!(Number(s.seconds) >= 10 && Number(s.seconds) <= 15)) issues.push(t('filmStudio.aclipmustlast1015seconds'));
    if (!s.oneAction) issues.push(t('filmStudio.confirmthattheclipcontainsoneaction'));
    if (!validAssetKey(s.location)) issues.push(t('filmStudio.useanexactlocationtagandversion'));
    if ([...assetTags(s.characters), ...assetTags(s.props)].some((k) => !validAssetKey(k))) issues.push(t('filmStudio.characterandproptagsneedanexact'));
    if (s.text && (!present(s.textPlacement) || !present(s.textContext))) issues.push(t('filmStudio.givetheseparatetexttaskitsplacement'));
    return issues;
}

export function boardIssues(b: Board): string[] {
    const refs = b.references.filter((r) => r.kind === 'reference');
    const range = ({ character: [10, 20], location: [8, 15], prop: [3, 5], style: [1, 100] } as Record<string, number[]>)[b.type];
    const issues: string[] = [];
    if (!range || refs.length < range[0] || refs.length > range[1]) issues.push(t('filmStudio.needsreferences', { value1: b.name, value2: range?.join('–') || 'valid' }));
    if (b.references.some((r) => !present(r.source) || !present(r.caption))) issues.push(t('filmStudio.everyreferenceneedsitssourceanda', { value1: b.name }));
    if (new Set(b.references.map((r) => r.source.trim())).size !== b.references.length) issues.push(t('filmStudio.referencesourcesmustbedistinct', { value1: b.name }));
    if (b.decision !== 'approved') issues.push(t('filmStudio.needsawrittenapproval', { value1: b.name }));
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
    if (!asset) throw new Error(t('filmStudio.theassetpassportismissing'));
    const rows = testMatrix(film, asset);
    if (!rows.every((row) => asset.tests?.[row.id]?.verdict === 'pass' && present(asset.tests[row.id].result))) throw new Error(t('filmStudio.everytestneedsanoutputreferenceand'));
    if (new Set(rows.map((row) => asset.tests[row.id].result.trim())).size !== rows.length) throw new Error(t('filmStudio.everytestneedsitsowndistinctoutput'));
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
    if (PROMPT_DETAILS.some(([key]) => !present(details[key]))) throw new Error(t('filmStudio.completeeverypromptdetail'));
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

export function failedAttempts(film: Film, shot: Shot): number {
    const context = promptContext(film, shot);
    return film.attempts.filter(a => a.shot === shot.id && a.verdict === 'rejected' &&
        film.prompts.find(p => p.shot === shot.id && p.version === a.version)?.context === context).length;
}

export function nextPromptVersion(film: Film, shot: Shot, content: string): Prompt {
    const headings = content.split('\n').filter((line) => /^\d+\. /.test(line));
    if (headings.length !== 15 || PROMPT_BLOCKS.some((title, index) => headings[index] !== `${index + 1}. ${title}`)) throw new Error(t('filmStudio.preserveallfifteenpromptblocksintheir'));
    const previous = film.prompts.filter((prompt) => prompt.shot === shot.id).sort((a, b) => a.version - b.version);
    const last = previous.at(-1);
    if (last && last.context === promptContext(film, shot) && !film.attempts.some((attempt) => attempt.shot === shot.id && attempt.version === last.version)) throw new Error(t('filmStudio.logthepreviousgenerationresultandverdict'));
    if (last && last.context === promptContext(film, shot)) {
        const before = last.content.split('\n');
        const after = content.split('\n');
        if (before.length !== after.length || before.filter((line, index) => line !== after[index]).length !== 1) throw new Error(t('filmStudio.changeexactlyonelineKeepallother'));
        const descriptors = shotAssets(shot).map((key) => film.assets.find((asset) => assetKey(asset) === key)?.descriptor ?? '');
        if (descriptors.some((descriptor) => !content.includes(descriptor))) throw new Error(t('filmStudio.canonicaldescriptorsmuststayverbatim'));
        if (shot.dialogue !== 'none' && !content.includes(String(shot.dialogue))) throw new Error(t('filmStudio.keepthesupplieddialogueverbatim'));
    }
    if (failedAttempts(film, shot) >= 15 && last?.context === promptContext(film, shot)) throw new Error(t('filmWorkspace.fifteenMisses'));
    return { shot: shot.id, version: (last?.version ?? 0) + 1, content, context: promptContext(film, shot), at: new Date().toISOString() };
}

export function logFilmAttempt(film: Film, prompt: Prompt, entry: { result: string; changed: string; verdict: 'accepted' | 'rejected'; checks?: string[] }): Film {
    if (!film.prompts.includes(prompt) || !present(entry.result) || !present(entry.changed)) throw new Error(t('filmStudio.recordtheresultandwhatchanged'));
    if (film.attempts.some((attempt) => attempt.shot === prompt.shot && attempt.version === prompt.version)) throw new Error(t('filmStudio.thispromptversionalreadyhasaresult'));
    const shot = film.shots.find((item) => item.id === prompt.shot);
    if (!shot || prompt.context !== promptContext(film, shot) || Array.from({ length: 6 }, (_, index) => index).some((stage) => stageIssues(film, stage).length)) throw new Error(t('filmStudio.rebuildthepromptfromthecurrentlocked'));
    if (entry.verdict === 'accepted' && !ACCEPTANCE_CHECKS.every((check) => entry.checks?.includes(check))) throw new Error(t('filmStudio.anacceptedtakeneedsallsixquality'));
    return { ...film, attempts: [...film.attempts, { shot: prompt.shot, version: prompt.version, result: entry.result, changed: entry.changed, verdict: entry.verdict, checks: entry.checks ?? [], at: new Date().toISOString() }] };
}

export function stageIssues(film: Film, stage: number): string[] {
    if (stage === 0) {
        return [!present(film.stack.image) && t('filmStudio.chooseanimagemodel'), !present(film.stack.video) && t('filmStudio.chooseavideomodel'), !(Number(film.stack.seconds) >= 10 && Number(film.stack.seconds) <= 15) && t('filmStudio.chooseacliplengthof1015')].filter(Boolean) as string[];
    }
    if (stage === 1) return present(film.name) ? [] : [t('filmStudio.nameyourstudio')];
    if (stage === 2) {
        return [!present(film.script) && t('filmStudio.addthescripttreatmentoridea'), !film.shots.length && t('filmStudio.addatleastoneshot'), ...film.shots.flatMap((s) => shotIssues(s).map((i) => `${s.id || 'Shot'}: ${i}`)), new Set(film.shots.map((s) => s.id)).size !== film.shots.length && t('filmStudio.shotIDsmustbeunique')].filter(Boolean) as string[];
    }
    const required = [...new Set(film.shots.flatMap(shotAssets))];
    if (stage === 3) {
        return [
            ...required.filter((k) => !film.boards.some((b) => b.name === k && b.type === assetType(film, k))).map((k) => t('filmStudio.addareferenceboardfor', { value1: assetType(film, k), value2: k })),
            ...STYLE_BOARDS.filter((k) => !film.boards.some((b) => b.name === k && b.type === 'style')).map((k) => t('filmStudio.addthestyleboard', { value1: k })),
            ...film.boards.flatMap(boardIssues),
        ];
    }
    if (stage === 4) {
        return required.flatMap((k) => {
            const a = film.assets.find((x) => assetKey(x) === k);
            if (!a) return [t('filmStudio.createthepassport', { value1: k })];
            return a.type !== assetType(film, k) || !present(a.descriptor) || !a.references.length || a.references.some((r) => !present(r)) ? [t('filmStudio.completeitstypedescriptorandreferencefiles', { value1: k })] : [];
        });
    }
    if (stage === 5) return required.filter((k) => !isLocked(film, film.assets.find((a) => assetKey(a) === k))).map((k) => t('filmStudio.isdraftPassitsentiretestmatrix', { value1: k }));
    return film.shots.filter((s) => !film.prompts.some((p) => p.shot === s.id && p.context === promptContext(film, s))).map((s) => t('filmStudio.writethecurrentpromptfor', { value1: s.id }));
}

export function accessibleStage(film: Film): number {
    for (let i = 0; i < 7; i++) if (stageIssues(film, i).length) return i;
    return 6;
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
    accepted: t('filmStudio.takeaccepted'),
    'prompt-ready': t('filmStudio.promptready'),
    'prompt-stale': t('filmStudio.promptoutofdate'),
    'no-prompt': t('filmStudio.nopromptyet'),
    blocked: t('filmStudio.waitingforlockedassets'),
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
    | { ok: true; model: CatalogModel; credits: number; seconds: number; prompt: string; aspect: string }
    | { ok: false; reason: string };

export const normalizeName = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function findVideoModel(film: Film, catalog: readonly CatalogModel[]): CatalogModel | null {
    const want = normalizeName(film.stack.video);
    if (!want) return null;
    return catalog.find((m) => kindOf(m.modality) === 'video' && !m.gated && (normalizeName(m.id) === want || normalizeName(m.name) === want)) ?? null;
}

export function handoffFor(film: Film, shot: Shot, catalog: readonly CatalogModel[]): Handoff {
    const row = shotRow(film, shot);
    if (row.state === 'accepted') return { ok: false, reason: t('filmStudio.thisshotalreadyhasanacceptedtake') };
    if (row.state === 'blocked') return { ok: false, reason: t('filmStudio.everyassetinthisshotmustbe') };
    const prompt = latestPrompt(film, shot.id);
    if (!prompt) return { ok: false, reason: t('filmStudio.writethisshotspromptonthe') };
    if (row.state === 'prompt-stale') return { ok: false, reason: t('filmStudio.thepromptisoutofdateRebuild') };
    if (film.stack.videoAccess !== 'Studio') return { ok: false, reason: t('filmWorkspace.externalAccess') };
    const model = findVideoModel(film, catalog);
    if (!model) return { ok: false, reason: t('filmStudio.isnotintodayspricelist', { value1: film.stack.video || t('filmStudio.videoModelFallback') }) };
    const seconds = Number(shot.seconds);
    if (!model.durations.includes(seconds)) return { ok: false, reason: t('filmStudio.doesnotoffersecondclips', { value1: model.name, value2: seconds }) };
    const aspects = optionsFor(model).aspects;
    if (aspects.length && !aspects.includes(film.stack.aspect)) return { ok: false, reason: t('filmWorkspace.incompatibleAspect') };
    const limit = textInput(model)?.max;
    if (!limit || prompt.content.length > limit) return { ok: false, reason: t('filmStudio.thispromptischaracterstakesItis', { value1: prompt.content.length, value2: model.name, value3: limit ?? 0 }) };
    return { ok: true, model, credits: estimateCredits(model, seconds), seconds, prompt: prompt.content, aspect: film.stack.aspect };
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
        name: film.name || t('filmStudio.untitledfilm'),
        aspect: film.stack.aspect,
        shots: film.shots.length,
        assets: film.assets.length,
        lockedAssets: film.assets.filter((a) => isLocked(film, a)).length,
        acceptedShots: rows.filter((r) => r.state === 'accepted').length,
        stagesDone: stageStatuses(film).filter((s) => s.done).length,
    };
}
