import { getCacheUser, subscribeCacheUser } from './appCache';
import { MOTIONS, sanitizePicks, type Picks } from './oddlingsBuilder';
import { kindOf, type CatalogModel } from './media';

export const MAX_INSTRUCTIONS = 4000;
export const MAX_INSTRUCTION_TOKENS = 1000;
export const MAX_SELECTED_SKILLS = 4;
export const ODDLING_CANON_MAX = 2200;
interface Skill { readonly id: string; readonly body: string }
export const PREAMBLE = [
  "You are Veyrnox.ai's Studio assistant. Plan ONE image/video/audio job; never generate or spend Credits.",
  'End with this exact block using a listed model id:',
  '```studio',
  '{"model":"<id>","prompt":"<the prompt>"}',
  '```',
  'Optional: "aspect":"16:9" (or 9:16, 1:1). Studio confirms listed Credits before charging.',
  'Be brief. Ask one question only when essential.',
].join('\n');

export const SKILLS: readonly Skill[] = [
    { id: 'oddling-continuity', body: 'Skill: Oddling continuity. Preserve the locked passport: name, premise, voice, show and visual canon. Develop the scene without identity changes. Every draft repeats the complete character and visual canon; models have no memory. Without a passport, start in Oddling Studio.' },
    { id: 'storyboard', body: 'Skill: Storyboard. If needed, ask for idea, length and platform. Plan 3-6 shots with subject, camera and mood. Keep character and style consistent. Give one ordered draft per shot with the same model; repeat the complete character and style because models have no memory.' },
    { id: 'prompt-writer', body: 'Skill: Prompt writer. If needed, ask for subject, mood and style. Pick a listed image, video or audio model and say why. Write one plain-language prompt with subject, setting, light, composition, style and one clear video action. Offer one variation.' },
    { id: 'bring-to-life', body: 'Skill: Bring it to life. Inspect an attached image; otherwise use the locked passport, or ask for a source. Write simple subject/camera motion, speed and what stays still. Use image-to-video; choose the source in Studio.' },
];
const VISUAL_ALIASES: Record<string, string> = {"character_type": "ty", "exaggeration": "ex", "gender": "g", "ethnicity_origin_base": "or", "age": "ag", "skin_tone": "sk", "eye_color": "ec", "eyes_type": "et", "eye_shape": "es", "eyes_details": "ed", "mouth": "mo", "ears": "ea", "horns": "ho", "skin_conditions": "sc", "head_shape": "hs", "brows": "br", "nose_shape": "no", "cheeks": "ch", "lips": "li", "chin_jaw": "jw", "face_features": "ff", "facial_hair": "fh", "face_skin_material": "fm", "face_surface_pattern": "fp", "body_type": "bo", "height": "he", "proportions": "pr", "torso_size": "to", "neck_size": "ns", "arm_size": "as", "leg_size": "ls", "head_size": "hds", "eye_size": "eys", "mouth_size": "mos", "ear_size": "eas", "nose_size": "nos", "hand_size": "has", "foot_size": "fs", "neck": "nk", "left_arm": "la", "right_arm": "ra", "left_leg": "ll", "right_leg": "rl", "hair": "hr", "hair_color": "hc", "wardrobe_style": "wd", "headwear": "hw", "everyday_accessories": "da", "accessories": "ac", "distinctive_features": "df", "rendering_style": "re"};
const VISUAL_GROUP_IDS = ["character_type", "exaggeration", "gender", "ethnicity_origin_base", "age", "skin_tone", "eye_color", "eyes_type", "eye_shape", "eyes_details", "mouth", "ears", "horns", "skin_conditions", "head_shape", "brows", "nose_shape", "cheeks", "lips", "chin_jaw", "face_features", "facial_hair", "face_skin_material", "face_surface_pattern", "body_type", "height", "proportions", "torso_size", "neck_size", "arm_size", "leg_size", "head_size", "eye_size", "mouth_size", "ear_size", "nose_size", "hand_size", "foot_size", "neck", "left_arm", "right_arm", "left_leg", "right_leg", "hair", "hair_color", "wardrobe_style", "headwear", "everyday_accessories", "accessories", "distinctive_features", "rendering_style"];
const oneLine = (value: unknown, max: number): string => String(value || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
export interface CanonInput { picks: Picks; mode?: string; scene?: string; referenceNote?: string; motionId?: string }
export function oddlingCanon(input: CanonInput): string {
    const picks = sanitizePicks(input.picks);
    if (!Object.keys(picks).length) return '';
    const motionId = oneLine(input.motionId, 80);
    const clean = { picks, mode: input.mode === 'motion' ? 'motion' : 'portrait', scene: oneLine(input.scene, 300), referenceNote: oneLine(input.referenceNote, 180), motionId: MOTIONS.some(m => m.id === motionId) ? motionId : '' };
  const p = clean.picks;
  const motion = clean.mode === 'motion' && MOTIONS.find((item) => item.id === clean.motionId);
  const visual = VISUAL_GROUP_IDS.flatMap(id => p[id]
    ? [`${VISUAL_ALIASES[id] || id}=${oneLine(p[id], 60)}`]
    : []).join(';');
  const core = [
    p.oddling_name && `name=${oneLine(p.oddling_name, 40)}`,
    p.oddling_obsession && `premise=${oneLine(p.oddling_obsession, 140)}`,
    p.oddling_voice && `voice=${oneLine(p.oddling_voice, 40)}`,
    p.oddling_show && `show=${oneLine(p.oddling_show, 40)}`,
    p.oddling_rule && `canon=${oneLine(p.oddling_rule, 160)}`,
    `mode=${clean.mode}`,
    motion && `motion=${motion.phrase}`,
  ].filter(Boolean).join(';');
  const required = [
    'LOCKED ODDLING PASSPORT. Never rename, redesign or contradict it.',
    `Core:${core}`,
    visual && `Visual:${visual}`,
    'Every Studio draft must repeat the relevant Core and Visual identity; generation models have no memory.',
  ].filter(Boolean).join('\n');
  const optional = [
    clean.scene && `Scene:${clean.scene}`,
    clean.referenceNote && `Reference:${clean.referenceNote}`,
  ].filter(Boolean);
  if (required.length > ODDLING_CANON_MAX) return '';
  let out = required;
  for (const line of optional) {
    if (out.length + line.length + 1 > ODDLING_CANON_MAX) return '';
    out += `\n${line}`;
  }
  return out;
}

function draftable(models: readonly CatalogModel[]) {
    return models.filter(m => m && m.id && !m.gated && !['clips', 'topic', 'plan_id'].some(key => key in (m.capabilities?.inputs ?? {})));
}
function needsOf(m: CatalogModel): string {
    return Object.entries(m.capabilities?.media ?? {}).filter(([, spec]) => spec?.required).map(([slot]) => slot).join('+');
}
export function catalogLines(models: readonly CatalogModel[]) {
  const order: Record<string, number> = { image: 0, video: 1, audio: 2 };
  return draftable(models)
    .slice()
    .sort((a, b) => (order[kindOf(a.modality) ?? ""] ?? 3) - (order[kindOf(b.modality) ?? ""] ?? 3) || (a.credits ?? 0) - (b.credits ?? 0) || a.id.localeCompare(b.id))
    .map((m) => `${m.id}|${kindOf(m.modality)}|${m.credits}${needsOf(m) ? `|needs ${needsOf(m)}` : ''}${m.bestValue ? '|best value' : ''}`);
}

/** Put one cheapest model of every available media kind first, then the remaining price-sorted catalog. */
export function prioritizedCatalogLines(models: readonly CatalogModel[]) {
  const lines = catalogLines(models);
  const first: string[] = [];
  for (const kind of ['image', 'video', 'audio']) {
    const line = lines.find((item) => item.includes(`|${kind}|`));
    if (line) first.push(line);
  }
  const reserved = new Set(first);
  return [...first, ...lines.filter((line) => !reserved.has(line))];
}

const uniqueSkills = (skills: readonly Skill[]) => [...new Map((skills || []).filter(Boolean).map((skill) => [skill.id, skill])).values()].slice(0, MAX_SELECTED_SKILLS);
const boundedContext = (context: string) => String(context || '').trim().slice(0, 2200);
export function estimateInstructionTokens(text: string) {
  let ascii = 0; let other = 0;
  for (const ch of String(text || '')) {
    if (ch.codePointAt(0)! < 0x80) ascii += 1;
    else other += 1;
  }
  return Math.ceil(ascii / 4) + other;
}
const withinInstructionLimits = (text: string) => text.length <= MAX_INSTRUCTIONS && estimateInstructionTokens(text) <= MAX_INSTRUCTION_TOKENS;
const contextCandidates = (context: string) => {
  const full = boundedContext(context);
  return [full];
};
const skillText = (skills: readonly Skill[]) => skills.length === 1
  ? skills[0].body
  : `Active skills — use them together for one result:\n\n${skills.map((skill, index) => `${index + 1}. ${skill.body}`).join('\n\n')}`;
const instructionHead = (skills: readonly Skill[], context: string) => {
  const project = String(context || '').trim();
  return `${PREAMBLE}\n\n${skillText(skills)}${project ? `\n\nProject context — preserve it in every result:\n${project}` : ''}\n\nModels (id|kind|Credits per generation):\n`;
};

function fittingContext(skills: readonly Skill[], models: readonly CatalogModel[], context: string) {
  const reserve = prioritizedCatalogLines(models).slice(0, 3).join('\n');
  return contextCandidates(context).find((project) => withinInstructionLimits(`${instructionHead(skills, project)}${reserve}${reserve ? '\n' : ''}`)) ?? null;
}

/** Keep only whole specialists that leave room for one live model of every available media kind. */
export function fittingSkills(skills: readonly Skill[], models: readonly CatalogModel[], context = '') {
  const kept: Skill[] = [];
  for (const skill of uniqueSkills(skills)) {
    const candidate = [...kept, skill];
    if (fittingContext(candidate, models, context) !== null) kept.push(skill);
  }
  return kept;
}

/** A locked workflow may name one specialist that must survive the instruction budget.
 * If it cannot fit, return nothing rather than silently keeping shorter optional skills. */
export function fittingSkillsWithRequired(skills: readonly Skill[], models: readonly CatalogModel[], context = '', requiredId = '') {
  const selected = uniqueSkills(skills);
  const required = selected.find((skill) => skill.id === requiredId);
  if (!required) return [];
  const ordered = [required, ...selected.filter((skill) => skill.id !== requiredId)];
  const kept = fittingSkills(ordered, models, context);
  return kept[0]?.id === requiredId ? kept : [];
}

/**
 * The text copied onto a new chat when a skill is chosen: the shared preamble, the skill, then the live model list. Never
 * longer than the chat allows; if the list does not fit, whole lines are dropped from the end, never cut mid-line.
 */
export function skillsInstructions(skills: readonly Skill[], models: readonly CatalogModel[], context = '') {
  const selected = fittingSkills(skills, models, context);
  if (!selected.length) return '';
  const project = fittingContext(selected, models, context);
  if (project === null) return '';
  const head = instructionHead(selected, project);
  let out = head;
  for (const line of prioritizedCatalogLines(models)) {
    const next = `${out}${line}\n`;
    if (!withinInstructionLimits(next)) break;
    out = next;
  }
  return out.trimEnd();
}

const CONTEXT_HEADER = '\n\nProject context — preserve it in every result:\n';
const MODELS_HEADER = '\n\nModels (id|kind|Credits per generation):';
export function oddlingChatInstructions(input: CanonInput, models: readonly CatalogModel[]): string {
    const canon = oddlingCanon(input);
    if (!canon) return '';
    return skillsInstructions(fittingSkillsWithRequired(SKILLS, models, canon, 'oddling-continuity'), models, canon);
}
export function parseOddlingInstructions(prompt: string | null | undefined): { skillIds: string[]; canon: string } | null {
    if (!prompt?.startsWith(PREAMBLE) || !prompt.includes(SKILLS[0].body)) return null;
    const start = prompt.indexOf(CONTEXT_HEADER);
    let end = prompt.lastIndexOf(MODELS_HEADER);
    while (end >= 0 && end + MODELS_HEADER.length !== prompt.length && prompt[end + MODELS_HEADER.length] !== '\n') end = prompt.lastIndexOf(MODELS_HEADER, end - 1);
    if (start < 0 || end < start + CONTEXT_HEADER.length) return null;
    const skillIds = SKILLS.map(skill => ({ id: skill.id, at: prompt.indexOf(skill.body) })).filter(s => s.at >= 0 && s.at < start).sort((a, b) => a.at - b.at).map(s => s.id);
    return { skillIds, canon: prompt.slice(start + CONTEXT_HEADER.length, end) };
}
export function nextOddlingInstructions(prompt: string | null | undefined, skillId: string, models: readonly CatalogModel[]): null | { error: 'locked' | 'tooLong' } | { instructions: string } {
    const parsed = parseOddlingInstructions(prompt);
    if (!parsed) return null;
    if (!SKILLS.slice(1).some(s => s.id === skillId)) return { error: 'locked' };
    const optional = parsed.skillIds.filter(id => id !== 'oddling-continuity');
    const ids = ['oddling-continuity', ...(optional.includes(skillId) ? optional.filter(id => id !== skillId) : [...optional, skillId])];
    const selected = ids.map(id => SKILLS.find(s => s.id === id)!).filter(Boolean);
    const kept = fittingSkillsWithRequired(selected, models, parsed.canon, 'oddling-continuity');
    const instructions = skillsInstructions(kept, models, parsed.canon);
    return instructions ? { instructions } : { error: 'tooLong' };
}

// Each settings/skill action owns its subscription until it settles, including failures.
export function watchOddlingAction(mounted: { current: boolean }) {
    const owner = getCacheUser();
    let changed = false;
    const close = subscribeCacheUser(() => { changed = true; });
    return { current: () => !changed && mounted.current && owner === getCacheUser(), close };
}
