import { t } from './i18n';
import { parseOddlingInstructions, SKILLS as ODDLING_SKILLS } from './oddlingsChat';
// Studio skills (ADR-0073, ADR-0167): built-in assistants that help prepare ONE thing to make. A skill is only
// instructions copied onto a new chat; it never makes anything and never spends credits beyond the chat's own replies. Its
// result is a "Studio draft" block the chat shows as an Open in Create button; only the person's own Create press charges.
// The wording is the web's (app/veyrnox/_lib/studioSkills.js); the Film group is in filmSkills.ts.
import { FILM_SKILLS } from './filmSkills';
import { kindOf, type CatalogModel } from './media';
import { GENERATION_PROMPT_MAX } from './promptLimits';

export const MAX_INSTRUCTIONS = 4000;
export const MAX_DRAFTS = 6;
export const MAX_DRAFT_PROMPT = GENERATION_PROMPT_MAX;

export type SkillGroup = 'Make' | 'Edit' | 'Plan' | 'Film';
export const SKILL_GROUPS: readonly SkillGroup[] = ['Make', 'Edit', 'Plan', 'Film'];

// 1 credit, reads images: the cheapest chat model that can look at a picture the person attached.
export const SKILL_MODEL = 'chat-gpt-6-luna';

export const PREAMBLE = [
  'You are a Studio assistant inside Veyrnox.ai, which makes images, video and audio with credit-metered models.',
  'You help the person prepare ONE thing to make. You never make anything yourself and never spend Credits.',
  'When a Studio job is ready, end your reply with a draft block, exactly like this, using only an id from the model list below:',
  '```studio',
  '{"model":"<id>","prompt":"<the prompt>"}',
  '```',
  'You may add "aspect":"16:9" (or 9:16, 1:1). Quote Credits only from the list (per generation); the Studio shows the exact price before anything is charged.',
  'Keep replies short and plain. If something essential is missing, ask one question first.',
].join('\n');

export interface Skill {
    readonly id: string;
    readonly name: string;
    readonly group: SkillGroup;
    readonly blurb: string;
    readonly starter: string;
    readonly body: string;
}

export const SKILLS: readonly Skill[] = [
  {
    id: 'prompt-writer', name: t('studioSkills.promptwriter'), group: 'Make',
    blurb: t('studioSkills.turnaroughideaintoastrong'),
    starter: t('studioSkills.describewhatyouwanttomake'),
    body: 'Skill: Prompt writer. If the idea is vague, ask what the subject, mood and style are. Pick the best-fitting model from the list for an image, video or audio and say why in one line. Write one strong prompt: a concrete subject and setting, the light, the camera or composition, the style, and for video one clear action. Plain language, not a pile of keywords. Offer one variation they can ask for.',
  },
  {
    id: 'model-picker', name: t('studioSkills.modelpicker'), group: 'Plan',
    blurb: t('studioSkills.findthecheapestmodelthatdoesthe'),
    starter: t('studioSkills.whatdoyouwanttomakeand'),
    body: 'Skill: Model picker. Ask the goal and the budget in Credits if not given. Recommend up to three models from the list, the cheapest that does the job first, one line each: what it is good at and its Credits. Say plainly when a cheaper model will do. If they choose one, write a starter prompt for it.',
  },
  {
    id: 'fix-my-photo', name: t('studioSkills.fixthisphoto'), group: 'Edit',
    blurb: t('studioSkills.upscalecutoutexpandorchangea'),
    starter: t('studioSkills.attachyourphotoorsaywhatis'),
    body: 'Skill: Fix this photo. If they attached an image, look at it. Decide which edit they need: upscale (small or soft), remove the background (cut out the subject), expand (extend beyond the edges) or edit with a prompt (change something). Name the one cheapest tool that does it, by id from the list, and what to expect. Tools that take an image need it chosen in the Studio with From library: say so. For a tool without a text prompt use a short description such as "Remove the background".',
  },
  {
    id: 'edit-with-words', name: t('studioSkills.editwithwords'), group: 'Edit',
    blurb: t('studioSkills.describeachangetoaphotoas'),
    starter: t('studioSkills.attachyourphotoandsaywhatto'),
    body: 'Skill: Edit with words. If they attached an image, look at it. Turn the request into a precise edit instruction: what to change, what must stay exactly the same, and how the new part should look. One change at a time works best: if they asked for several, split them and give the order. Use an image-to-image model from the list. Remind them to choose their image in the Studio with From library. Give the draft for the first change.',
  },
  {
    id: 'bring-to-life', name: t('studioSkills.bringittolife'), group: 'Make',
    blurb: t('studioSkills.turnastillphotointoashort'),
    starter: t('studioSkills.attachaphototoanimate'),
    body: 'Skill: Bring it to life. If they attached an image, look at it. Write a motion prompt: what moves, how the camera moves, how fast, and what stays still. Simple movement works best in a short clip. Use an image-to-video model from the list. Remind them to choose the image in the Studio with From library.',
  },
  {
    id: 'add-sound', name: t('studioSkills.addsound'), group: 'Edit',
    blurb: t('studioSkills.describethesoundthatfitsashort'),
    starter: t('studioSkills.whathappensinyourvideo'),
    body: 'Skill: Add sound. You cannot see video, so ask what happens in it. Describe the sound that fits in one or two sentences: ambience, effects, rhythm and mood, with no music unless they ask. Use the video-to-audio model from the list. Remind them to choose the clip from their Library in the Studio.',
  },
  {
    id: 'storyboard', name: t('studioSkills.storyboard'), group: 'Plan',
    blurb: t('studioSkills.planashortsequenceofshotswith'),
    starter: t('studioSkills.whatistheideaandhowlong'),
    body: 'Skill: Storyboard. Ask for the idea, the length and the platform if not given. Plan 3 to 6 short shots, one line each: what we see, the camera, the mood. Keep the characters and style consistent. Then give one draft block per shot in order, using the same model for all so the look matches. Models do not remember earlier shots, so every prompt repeats the character and style description in full.',
  },
  {
    id: 'oddling-continuity', name: t('skillsUi.oddling.name'), group: 'Plan',
    blurb: t('skillsUi.oddling.blurb'), starter: t('skillsUi.oddling.starter'), body: ODDLING_SKILLS[0].body,
  },
  {
    id: 'fix-my-prompt', name: t('studioSkills.fixmyprompt'), group: 'Make',
    blurb: t('studioSkills.findoutwhyapromptwentwrong'),
    starter: t('studioSkills.pastethepromptandsaywhatwent'),
    body: 'Skill: Fix my prompt. They paste a prompt and say what went wrong, or attach the result. Name the likely cause in one or two lines: too vague, conflicting instructions, too many subjects, or the wrong model for the job. Rewrite the prompt and say what you changed. If a different model would suit better, say which.',
  },
    ...FILM_SKILLS,
];

// The starter is already localized on the skill; overview copy stays as translation keys.
export function skillOverview(skill: Skill) {
    return {
        bestForKey: `skillsUi.bestFor.${skill.group}`,
        outputKey: `skillsUi.output.${skill.group}`,
        howTo: ['skillsUi.howMissing', skill.group === 'Film' ? 'skillsUi.howFilm' : 'skillsUi.howStudio'],
    };
}

export const skillById = (id: string): Skill | null => SKILLS.find((s) => s.id === id) ?? null;

// A model a draft may name: open, a kind the app can show, and taking text. Library-only editors take no prompt.
const draftable = (models: readonly CatalogModel[]): CatalogModel[] =>
    models.filter((m) => !m.gated && kindOf(m.modality) !== null && !!m.capabilities?.inputs && 'prompt' in (m.capabilities.inputs as object));

const needsOf = (m: CatalogModel): string[] =>
    Object.entries(m.capabilities?.media ?? {})
        .filter(([, spec]) => spec?.required)
        .map(([slot]) => slot);

// `id|kind|credits` per model, plus `|needs image` where a source file is required. Cheapest first within a kind.
export function catalogLines(models: readonly CatalogModel[]): string[] {
    const order: Record<string, number> = { image: 0, video: 1, audio: 2 };
    return draftable(models)
        .slice()
        .sort((a, b) => (order[kindOf(a.modality) ?? ''] ?? 3) - (order[kindOf(b.modality) ?? ''] ?? 3) || a.credits - b.credits || a.id.localeCompare(b.id))
        .map((m) => `${m.id}|${kindOf(m.modality)}|${m.credits}${needsOf(m).length ? `|needs ${needsOf(m).join('+')}` : ''}`);
}

export const MAX_SELECTED_SKILLS = 4;
export const MAX_INSTRUCTION_TOKENS = 1000;
export function estimateInstructionTokens(text: string): number {
    let ascii = 0, other = 0;
    for (const ch of text) { if (ch.codePointAt(0)! < 0x80) ascii++; else other++; }
    return Math.ceil(ascii / 4) + other;
}
const withinLimits = (text: string) => text.length <= MAX_INSTRUCTIONS && estimateInstructionTokens(text) <= MAX_INSTRUCTION_TOKENS;
export function prioritizedCatalogLines(models: readonly CatalogModel[]): string[] {
    const lines = catalogLines(models);
    const first = ['image', 'video', 'audio'].map(kind => lines.find(line => line.includes(`|${kind}|`))).filter((line): line is string => !!line);
    return [...first, ...lines.filter(line => !first.includes(line))];
}
const instructionHead = (skills: readonly Skill[]) => `${PREAMBLE}\n\n${skills.length === 1 ? skills[0].body : `Active skills — use them together for one result:\n\n${skills.map((s, i) => `${i + 1}. ${s.body}`).join('\n\n')}`}\n\nModels (id|kind|Credits per generation):\n`;
export function fittingSkills(skills: readonly Skill[], models: readonly CatalogModel[] = []): Skill[] {
    const kept: Skill[] = [];
    const reserve = prioritizedCatalogLines(models).slice(0, 3).join('\n');
    for (const skill of [...new Map(skills.map(s => [s.id, s])).values()].slice(0, MAX_SELECTED_SKILLS)) {
        if (withinLimits(`${instructionHead([...kept, skill])}${reserve}${reserve ? '\n' : ''}`)) kept.push(skill);
    }
    return kept;
}
export function skillsInstructions(skills: readonly Skill[], models: readonly CatalogModel[] = []): string {
    const selected = fittingSkills(skills, models);
    if (!selected.length) return '';
    let out = instructionHead(selected);
    // Preserve the phone's existing single-skill format, including catalog order.
    for (const line of selected.length === 1 ? catalogLines(models) : prioritizedCatalogLines(models)) {
        if (!withinLimits(`${out}${line}\n`)) break;
        out += `${line}\n`;
    }
    return out.trimEnd();
}
export const skillInstructions = (skill: Skill, models: readonly CatalogModel[]): string => skillsInstructions([skill], models);
export function selectedSkillIds(prompt: string | null | undefined): string[] {
    if (!prompt?.startsWith(PREAMBLE)) return parseOddlingInstructions(prompt)?.skillIds.filter(id => SKILLS.some(skill => skill.id === id)) ?? [];
    return SKILLS.map(skill => ({ id: skill.id, at: prompt.indexOf(skill.body) })).filter(s => s.at >= 0)
        .sort((a, b) => a.at - b.at).slice(0, MAX_SELECTED_SKILLS).map(s => s.id);
}

const FENCE = /```studio[ \t]*\r?\n([\s\S]*?)```/g;

export interface StudioDraft {
    readonly model: string;
    readonly name: string;
    readonly credits: number;
    readonly prompt: string;
    readonly needs: string[];
}

// The drafts in a reply, checked against the live catalog: a known open model and a non-empty prompt. Anything else is
// skipped, so a confused or hostile reply can offer nothing Create would not accept. Prices come from the catalog, never the text.
export function parseStudioDrafts(text: string, models: readonly CatalogModel[]): StudioDraft[] {
    if (typeof text !== 'string' || !text.includes('```studio')) return [];
    const byId = new Map(draftable(models).map((m) => [m.id, m]));
    const drafts: StudioDraft[] = [];
    for (const match of text.matchAll(FENCE)) {
        if (drafts.length >= MAX_DRAFTS) break;
        let raw: unknown;
        try {
            raw = JSON.parse(match[1]);
        } catch {
            continue;
        }
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
        const r = raw as { model?: unknown; prompt?: unknown };
        const m = typeof r.model === 'string' ? byId.get(r.model) : undefined;
        const prompt = typeof r.prompt === 'string' ? r.prompt.trim().slice(0, MAX_DRAFT_PROMPT) : '';
        if (!m || !prompt) continue;
        drafts.push({ model: m.id, name: m.name, credits: m.credits, prompt, needs: needsOf(m) });
    }
    return drafts;
}

// The reply without its draft blocks, so the cards replace them instead of showing the raw block.
export const withoutDrafts = (text: string): string => text.replace(FENCE, '').replace(/\n{3,}/g, '\n\n').trim();
