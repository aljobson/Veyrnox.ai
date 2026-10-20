// Studio skills (ADR-0073, ADR-0167): built-in assistants that help prepare ONE thing to make. A skill is only
// instructions copied onto a new chat; it never makes anything and never spends credits beyond the chat's own replies. Its
// result is a "Studio draft" block the chat shows as an Open in Create button; only the person's own Create press charges.
// The wording is the web's (app/veyrnox/_lib/studioSkills.js); the Film group is in filmSkills.ts.
import { FILM_SKILLS } from './filmSkills';
import { kindOf, type CatalogModel } from './media';

export const MAX_INSTRUCTIONS = 4000;
export const MAX_DRAFTS = 6;
export const MAX_DRAFT_PROMPT = 2000;

export type SkillGroup = 'Make' | 'Edit' | 'Plan' | 'Film';
export const SKILL_GROUPS: readonly SkillGroup[] = ['Make', 'Edit', 'Plan', 'Film'];

// 1 credit, reads images: the cheapest chat model that can look at a picture the person attached.
export const SKILL_MODEL = 'chat-gpt-6-luna';

const PREAMBLE = [
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
    id: 'prompt-writer', name: 'Prompt writer', group: 'Make',
    blurb: 'Turn a rough idea into a strong prompt and the right model.',
    starter: 'Describe what you want to make',
    body: 'Skill: Prompt writer. If the idea is vague, ask what the subject, mood and style are. Pick the best-fitting model from the list for an image, video or audio and say why in one line. Write one strong prompt: a concrete subject and setting, the light, the camera or composition, the style, and for video one clear action. Plain language, not a pile of keywords. Offer one variation they can ask for.',
  },
  {
    id: 'model-picker', name: 'Model picker', group: 'Plan',
    blurb: 'Find the cheapest model that does the job for your budget.',
    starter: 'What do you want to make, and how many Credits can you spend?',
    body: 'Skill: Model picker. Ask the goal and the budget in Credits if not given. Recommend up to three models from the list, the cheapest that does the job first, one line each: what it is good at and its Credits. Say plainly when a cheaper model will do. If they choose one, write a starter prompt for it.',
  },
  {
    id: 'fix-my-photo', name: 'Fix this photo', group: 'Edit',
    blurb: 'Upscale, cut out, expand or change a photo, with the cheapest tool.',
    starter: 'Attach your photo, or say what is wrong with it',
    body: 'Skill: Fix this photo. If they attached an image, look at it. Decide which edit they need: upscale (small or soft), remove the background (cut out the subject), expand (extend beyond the edges) or edit with a prompt (change something). Name the one cheapest tool that does it, by id from the list, and what to expect. Tools that take an image need it chosen in the Studio with From library: say so. For a tool without a text prompt use a short description such as "Remove the background".',
  },
  {
    id: 'edit-with-words', name: 'Edit with words', group: 'Edit',
    blurb: 'Describe a change to a photo as a precise edit.',
    starter: 'Attach your photo and say what to change',
    body: 'Skill: Edit with words. If they attached an image, look at it. Turn the request into a precise edit instruction: what to change, what must stay exactly the same, and how the new part should look. One change at a time works best: if they asked for several, split them and give the order. Use an image-to-image model from the list. Remind them to choose their image in the Studio with From library. Give the draft for the first change.',
  },
  {
    id: 'bring-to-life', name: 'Bring it to life', group: 'Make',
    blurb: 'Turn a still photo into a short moving clip.',
    starter: 'Attach a photo to animate',
    body: 'Skill: Bring it to life. If they attached an image, look at it. Write a motion prompt: what moves, how the camera moves, how fast, and what stays still. Simple movement works best in a short clip. Use an image-to-video model from the list. Remind them to choose the image in the Studio with From library.',
  },
  {
    id: 'add-sound', name: 'Add sound', group: 'Edit',
    blurb: 'Describe the sound that fits a short video.',
    starter: 'What happens in your video?',
    body: 'Skill: Add sound. You cannot see video, so ask what happens in it. Describe the sound that fits in one or two sentences: ambience, effects, rhythm and mood, with no music unless they ask. Use the video-to-audio model from the list. Remind them to choose the clip from their Library in the Studio.',
  },
  {
    id: 'storyboard', name: 'Storyboard', group: 'Plan',
    blurb: 'Plan a short sequence of shots with a consistent look.',
    starter: 'What is the idea, and how long should it be?',
    body: 'Skill: Storyboard. Ask for the idea, the length and the platform if not given. Plan 3 to 6 short shots, one line each: what we see, the camera, the mood. Keep the characters and style consistent. Then give one draft block per shot in order, using the same model for all so the look matches. Models do not remember earlier shots, so every prompt repeats the character and style description in full.',
  },
  {
    id: 'fix-my-prompt', name: 'Fix my prompt', group: 'Make',
    blurb: 'Find out why a prompt went wrong and rewrite it.',
    starter: 'Paste the prompt and say what went wrong',
    body: 'Skill: Fix my prompt. They paste a prompt and say what went wrong, or attach the result. Name the likely cause in one or two lines: too vague, conflicting instructions, too many subjects, or the wrong model for the job. Rewrite the prompt and say what you changed. If a different model would suit better, say which.',
  },
    ...FILM_SKILLS,
];

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

// The text copied onto a new chat: the preamble, the skill, then the live model list. Never over the chat's limit; if the
// list does not fit, whole lines are dropped from the end.
export function skillInstructions(skill: Skill, models: readonly CatalogModel[]): string {
    let out = `${PREAMBLE}\n\n${skill.body}\n\nModels (id|kind|Credits per generation):\n`;
    for (const line of catalogLines(models)) {
        if (out.length + line.length + 1 > MAX_INSTRUCTIONS) break;
        out += `${line}\n`;
    }
    return out.trimEnd();
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
