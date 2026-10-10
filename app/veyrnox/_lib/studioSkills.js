// Studio skills (ADR-0073): built-in assistants in LLM Chat that help someone prepare ONE thing to make in the Studio.
// A skill is only instructions, started the same way as a Persona (copied onto a new chat), so it needs no table and
// no flag. It never makes anything and never spends Credits: its result is a "Studio draft", a fenced block the chat
// turns into an Open in Studio button, and only the person's own press of Generate charges anything.

import { FILM_ASSISTANTS } from './filmStudioAssistants.js';

export const MAX_INSTRUCTIONS = 4000; // the chat's own Instructions limit (ADR-0067)
export const MAX_DRAFTS = 6;          // cards for one reply (a storyboard is the most that needs several)
export const MAX_DRAFT_PROMPT = 2000;

export const SKILL_GROUPS = ['Make', 'Edit', 'Plan', 'Film'];

// 1 Credit, reads images: the cheapest chat model that can look at a picture the person attached.
const SKILL_MODEL = 'chat-gpt-6-luna';

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

/** @type {{id:string, name:string, blurb:string, group:'Make'|'Edit'|'Plan'|'Film', model:string, starter:string, body:string}[]} */
export const SKILLS = [
  {
    id: 'prompt-writer', name: 'Prompt writer', group: 'Make', model: SKILL_MODEL,
    blurb: 'Turn a rough idea into a strong prompt and the right model.',
    starter: 'Describe what you want to make',
    body: 'Skill: Prompt writer. If the idea is vague, ask what the subject, mood and style are. Pick the best-fitting model from the list for an image, video or audio and say why in one line. Write one strong prompt: a concrete subject and setting, the light, the camera or composition, the style, and for video one clear action. Plain language, not a pile of keywords. Offer one variation they can ask for.',
  },
  {
    id: 'model-picker', name: 'Model picker', group: 'Plan', model: SKILL_MODEL,
    blurb: 'Find the cheapest model that does the job for your budget.',
    starter: 'What do you want to make, and how many Credits can you spend?',
    body: 'Skill: Model picker. Ask the goal and the budget in Credits if not given. Recommend up to three models from the list, the cheapest that does the job first, one line each: what it is good at and its Credits. Say plainly when a cheaper model will do. If they choose one, write a starter prompt for it.',
  },
  {
    id: 'fix-my-photo', name: 'Fix this photo', group: 'Edit', model: SKILL_MODEL,
    blurb: 'Upscale, cut out, expand or change a photo, with the cheapest tool.',
    starter: 'Attach your photo, or say what is wrong with it',
    body: 'Skill: Fix this photo. If they attached an image, look at it. Decide which edit they need: upscale (small or soft), remove the background (cut out the subject), expand (extend beyond the edges) or edit with a prompt (change something). Name the one cheapest tool that does it, by id from the list, and what to expect. Tools that take an image need it chosen in the Studio with From library: say so. For a tool without a text prompt use a short description such as "Remove the background".',
  },
  {
    id: 'edit-with-words', name: 'Edit with words', group: 'Edit', model: SKILL_MODEL,
    blurb: 'Describe a change to a photo as a precise edit.',
    starter: 'Attach your photo and say what to change',
    body: 'Skill: Edit with words. If they attached an image, look at it. Turn the request into a precise edit instruction: what to change, what must stay exactly the same, and how the new part should look. One change at a time works best: if they asked for several, split them and give the order. Use an image-to-image model from the list. Remind them to choose their image in the Studio with From library. Give the draft for the first change.',
  },
  {
    id: 'bring-to-life', name: 'Bring it to life', group: 'Make', model: SKILL_MODEL,
    blurb: 'Turn a still photo into a short moving clip.',
    starter: 'Attach a photo to animate',
    body: 'Skill: Bring it to life. If they attached an image, look at it. Write a motion prompt: what moves, how the camera moves, how fast, and what stays still. Simple movement works best in a short clip. Use an image-to-video model from the list. Remind them to choose the image in the Studio with From library.',
  },
  {
    id: 'add-sound', name: 'Add sound', group: 'Edit', model: SKILL_MODEL,
    blurb: 'Describe the sound that fits a short video.',
    starter: 'What happens in your video?',
    body: 'Skill: Add sound. You cannot see video, so ask what happens in it. Describe the sound that fits in one or two sentences: ambience, effects, rhythm and mood, with no music unless they ask. Use the video-to-audio model from the list. Remind them to choose the clip from their Library in the Studio.',
  },
  {
    id: 'storyboard', name: 'Storyboard', group: 'Plan', model: SKILL_MODEL,
    blurb: 'Plan a short sequence of shots with a consistent look.',
    starter: 'What is the idea, and how long should it be?',
    body: 'Skill: Storyboard. Ask for the idea, the length and the platform if not given. Plan 3 to 6 short shots, one line each: what we see, the camera, the mood. Keep the characters and style consistent. Then give one draft block per shot in order, using the same model for all so the look matches. Models do not remember earlier shots, so every prompt repeats the character and style description in full.',
  },
  {
    id: 'fix-my-prompt', name: 'Fix my prompt', group: 'Make', model: SKILL_MODEL,
    blurb: 'Find out why a prompt went wrong and rewrite it.',
    starter: 'Paste the prompt and say what went wrong',
    body: 'Skill: Fix my prompt. They paste a prompt and say what went wrong, or attach the result. Name the likely cause in one or two lines: too vague, conflicting instructions, too many subjects, or the wrong model for the job. Rewrite the prompt and say what you changed. If a different model would suit better, say which.',
  },
  ...FILM_ASSISTANTS,
];

export function skillById(id) {
  return SKILLS.find((s) => s.id === id) || null;
}

/** Studio models a draft may name: open (not gated), and not the Library-only editors, Auto Short or the video agent, which take no prompt. */
function draftable(models) {
  return (models || []).filter((m) => m && m.id && !m.gated && !m.isEdit && !m.takesTopic && !m.takesPlan);
}

function needsOf(m) {
  const slots = Object.entries(m.media || {}).filter(([, spec]) => spec && spec.required).map(([slot]) => slot);
  return slots.length ? slots.join('+') : '';
}

/** `id|kind|Credits` per model, plus `|needs image` where a source file is required. Cheapest first within a kind. */
export function catalogLines(models) {
  const order = { image: 0, video: 1, audio: 2 };
  return draftable(models)
    .slice()
    .sort((a, b) => (order[a.kind] ?? 3) - (order[b.kind] ?? 3) || (a.credits ?? 0) - (b.credits ?? 0) || a.id.localeCompare(b.id))
    .map((m) => `${m.id}|${m.kind}|${m.credits}${needsOf(m) ? `|needs ${needsOf(m)}` : ''}`);
}

/**
 * The text copied onto a new chat when a skill is chosen: the shared preamble, the skill, then the live model list. Never
 * longer than the chat allows; if the list does not fit, whole lines are dropped from the end, never cut mid-line.
 */
export function skillInstructions(skill, models) {
  const head = `${PREAMBLE}\n\n${skill.body}\n\nModels (id|kind|Credits per generation):\n`;
  let out = head;
  for (const line of catalogLines(models)) {
    if (out.length + line.length + 1 > MAX_INSTRUCTIONS) break;
    out += `${line}\n`;
  }
  return out.trimEnd();
}

const FENCE = /```studio[ \t]*\r?\n([\s\S]*?)```/g;

/**
 * The Studio drafts in an assistant reply, checked against the live catalog: a known open model, a non-empty prompt, and an
 * aspect only if that model takes it. Anything else in the block is ignored, and a draft that fails is skipped, so a
 * confused or hostile reply can offer nothing the Studio would not accept. Prices are read from the catalog, never the text.
 *
 * @returns {{model:string, name:string, kind:string, credits:number, prompt:string, aspect:string|null, needs:string[]}[]}
 */
export function parseStudioDrafts(text, models) {
  if (typeof text !== 'string' || !text.includes('```studio')) return [];
  const byId = new Map(draftable(models).map((m) => [m.id, m]));
  const drafts = [];
  for (const match of text.matchAll(FENCE)) {
    if (drafts.length >= MAX_DRAFTS) break;
    let raw;
    try { raw = JSON.parse(match[1]); } catch { continue; }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const m = typeof raw.model === 'string' ? byId.get(raw.model) : null;
    const prompt = typeof raw.prompt === 'string' ? raw.prompt.trim().slice(0, MAX_DRAFT_PROMPT) : '';
    if (!m || !prompt) continue;
    const aspect = typeof raw.aspect === 'string' && Array.isArray(m.aspects) && m.aspects.includes(raw.aspect) ? raw.aspect : null;
    drafts.push({
      model: m.id, name: m.name, kind: m.kind, credits: m.credits, prompt, aspect,
      needs: Object.entries(m.media || {}).filter(([, spec]) => spec && spec.required).map(([slot]) => slot),
    });
  }
  return drafts;
}
