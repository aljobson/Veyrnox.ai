// Studio skills (ADR-0073): built-in assistants in LLM Chat that help someone prepare ONE thing to make in the Studio.
// A skill is only instructions, started the same way as a Persona (copied onto a new chat), so it needs no table and
// no flag. It never makes anything and never spends Credits: its result is a "Studio draft", a fenced block the chat
// turns into an Open in Studio button, and only the person's own press of Generate charges anything.

import { FILM_ASSISTANTS } from './filmStudioAssistants.js';
import { modelAspectRatios } from './tokens.js';

export const MAX_INSTRUCTIONS = 4000; // the chat's own Instructions limit (ADR-0067)
export const MAX_INSTRUCTION_TOKENS = 1000; // same conservative server limit: ASCII / 4, every other code point / 1
export const MAX_DRAFTS = 6;          // cards for one reply (a storyboard is the most that needs several)
export const MAX_DRAFT_PROMPT = 2000;
export const MAX_SKILL_IDEA = 500;     // short enough for a shareable GET launch URL
export const MAX_SELECTED_SKILLS = 4;  // keeps every chosen specialist complete inside the 4,000-character system prompt

export const SKILL_GROUPS = ['Make', 'Edit', 'Plan', 'Film'];

// 1 Credit, reads images: the cheapest chat model that can look at a picture the person attached.
const SKILL_MODEL = 'chat-gpt-6-luna';

const PREAMBLE = [
  "You are Veyrnox.ai's Studio assistant. Plan ONE image/video/audio job; never generate or spend Credits.",
  'End with this exact block using a listed model id:',
  '```studio',
  '{"model":"<id>","prompt":"<the prompt>"}',
  '```',
  'Optional: "aspect":"16:9" (or 9:16, 1:1). Studio confirms listed Credits before charging.',
  'Be brief. Ask one question only when essential.',
].join('\n');

/** @type {{id:string, name:string, blurb:string, group:'Make'|'Edit'|'Plan'|'Film', model:string, starter:string, body:string}[]} */
export const SKILLS = [
  {
    id: 'prompt-writer', name: 'Prompt writer', group: 'Make', model: SKILL_MODEL,
    blurb: 'Turn a rough idea into a strong prompt and the right model.',
    starter: 'Describe what you want to make',
    body: 'Skill: Prompt writer. If needed, ask for subject, mood and style. Pick a listed image, video or audio model and say why. Write one plain-language prompt with subject, setting, light, composition, style and one clear video action. Offer one variation.',
  },
  {
    id: 'model-picker', name: 'Model picker', group: 'Plan', model: SKILL_MODEL,
    blurb: 'Find the cheapest model that does the job for your budget.',
    starter: 'What do you want to make, and how many Credits can you spend?',
    body: 'Skill: Model picker. Ask the goal and the budget in Credits if not given. Recommend up to three models from the list, the cheapest that does the job first, preferring ones marked best value when they fit, one line each: what it is good at and its Credits. Say plainly when a cheaper model will do. If they choose one, write a starter prompt for it.',
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
    body: 'Skill: Bring it to life. Inspect an attached image; otherwise use the locked passport, or ask for a source. Write simple subject/camera motion, speed and what stays still. Use image-to-video; choose the source in Studio.',
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
    body: 'Skill: Storyboard. If needed, ask for idea, length and platform. Plan 3-6 shots with subject, camera and mood. Keep character and style consistent. Give one ordered draft per shot with the same model; repeat the complete character and style because models have no memory.',
  },
  {
    id: 'oddling-continuity', name: 'Oddling continuity', group: 'Plan', model: SKILL_MODEL,
    blurb: 'Keep one Oddling, story and visual theme consistent across every shot.',
    starter: 'What should happen next in this Oddling story?',
    body: 'Skill: Oddling continuity. Preserve the locked passport: name, premise, voice, show and visual canon. Develop the scene without identity changes. Every draft repeats the complete character and visual canon; models have no memory. Without a passport, start in Oddling Studio.',
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

/** Known, unique skill ids from a launch URL. Repeated and comma-separated links both remain shareable. */
export function skillIdsFromSearch(search) {
  const params = new URLSearchParams(String(search || ''));
  const ids = params.getAll('skill').flatMap((value) => value.split(','));
  return [...new Set(ids.map((id) => id.trim()).filter((id) => skillById(id)))].slice(0, MAX_SELECTED_SKILLS);
}

const GROUP_OVERVIEW = {
  Make: {
    bestFor: 'Turning a rough idea into one generation-ready creative brief.',
    output: 'A checked Studio draft with a compatible model and prompt.',
  },
  Edit: {
    bestFor: 'Planning one clear change to a file you already have.',
    output: 'An edit-ready Studio draft plus the source file you need to choose.',
  },
  Plan: {
    bestFor: 'Making the model, budget or shot decisions before spending credits.',
    output: 'A concise plan and, when ready, one or more checked Studio drafts.',
  },
  Film: {
    bestFor: 'Working through one stage of the structured Film Studio workflow.',
    output: 'A stage-specific draft to review and save in Film Studio.',
  },
};

/** Public skill-page copy derived from the instructions the assistant actually follows. */
export function skillOverview(skill) {
  if (!skill) return null;
  const group = GROUP_OVERVIEW[skill.group] || GROUP_OVERVIEW.Make;
  return {
    introduction: skill.blurb,
    bestFor: group.bestFor,
    howTo: [
      skill.starter,
      'Answer one focused question if the specialist needs a missing detail.',
      skill.group === 'Film' ? 'Review and save the result in Film Studio.' : 'Review the prepared draft, then open it in Studio when you are ready.',
    ],
    output: group.output,
  };
}

/**
 * A Skills-library launch may carry one short idea into a new chat. Ignore the
 * idea unless its skill is known, and bound it before it reaches the composer.
 */
export function skillLaunchFromSearch(search) {
  const params = new URLSearchParams(String(search || ''));
  const skill = skillById(skillIdsFromSearch(search)[0]);
  if (!skill) return { skillId: '', idea: '' };
  return {
    skillId: skill.id,
    idea: String(params.get('prompt') || '').trim().slice(0, MAX_SKILL_IDEA),
  };
}

/** A feature-gated personal-skill link may open the saved list or the new-skill form. */
export function personalSkillLaunchFromSearch(search) {
  const mode = new URLSearchParams(String(search || '')).get('personas');
  return mode === 'new' || mode === 'manage' ? mode : '';
}

/** Studio models a draft may name: open (not gated), and not the Library-only editors, Auto Short or the video agent, which take no prompt. */
function draftable(models) {
  return (models || []).filter((m) => m && m.id && !m.gated && !m.isEdit && !m.takesTopic && !m.takesPlan);
}

function needsOf(m) {
  const slots = Object.entries(m.media || {}).filter(([, spec]) => spec && spec.required).map(([slot]) => slot);
  return slots.length ? slots.join('+') : '';
}

/** `id|kind|Credits` per model, plus `|needs image` where a source file is required and `|best value` for our lowest-cost supply. Cheapest first within a kind. */
export function catalogLines(models) {
  const order = { image: 0, video: 1, audio: 2 };
  return draftable(models)
    .slice()
    .sort((a, b) => (order[a.kind] ?? 3) - (order[b.kind] ?? 3) || (a.credits ?? 0) - (b.credits ?? 0) || a.id.localeCompare(b.id))
    .map((m) => `${m.id}|${m.kind}|${m.credits}${needsOf(m) ? `|needs ${needsOf(m)}` : ''}${m.bestValue ? '|best value' : ''}`);
}

/** Put one cheapest model of every available media kind first, then the remaining price-sorted catalog. */
export function prioritizedCatalogLines(models) {
  const lines = catalogLines(models);
  const first = [];
  for (const kind of ['image', 'video', 'audio']) {
    const line = lines.find((item) => item.includes(`|${kind}|`));
    if (line) first.push(line);
  }
  const reserved = new Set(first);
  return [...first, ...lines.filter((line) => !reserved.has(line))];
}

const uniqueSkills = (skills) => [...new Map((skills || []).filter(Boolean).map((skill) => [skill.id, skill])).values()].slice(0, MAX_SELECTED_SKILLS);
const boundedContext = (context) => String(context || '').trim().slice(0, 2200);
export function estimateInstructionTokens(text) {
  let ascii = 0; let other = 0;
  for (const ch of String(text || '')) {
    if (ch.codePointAt(0) < 0x80) ascii += 1;
    else other += 1;
  }
  return Math.ceil(ascii / 4) + other;
}
const withinInstructionLimits = (text) => text.length <= MAX_INSTRUCTIONS && estimateInstructionTokens(text) <= MAX_INSTRUCTION_TOKENS;
const contextCandidates = (context) => {
  const full = boundedContext(context);
  return [full];
};
const skillText = (skills) => skills.length === 1
  ? skills[0].body
  : `Active skills — use them together for one result:\n\n${skills.map((skill, index) => `${index + 1}. ${skill.body}`).join('\n\n')}`;
const instructionHead = (skills, context) => {
  const project = String(context || '').trim();
  return `${PREAMBLE}\n\n${skillText(skills)}${project ? `\n\nProject context — preserve it in every result:\n${project}` : ''}\n\nModels (id|kind|Credits per generation):\n`;
};

function fittingContext(skills, models, context) {
  const reserve = prioritizedCatalogLines(models).slice(0, 3).join('\n');
  return contextCandidates(context).find((project) => withinInstructionLimits(`${instructionHead(skills, project)}${reserve}${reserve ? '\n' : ''}`)) ?? null;
}

/** Keep only whole specialists that leave room for one live model of every available media kind. */
export function fittingSkills(skills, models, context = '') {
  const kept = [];
  for (const skill of uniqueSkills(skills)) {
    const candidate = [...kept, skill];
    if (fittingContext(candidate, models, context) !== null) kept.push(skill);
  }
  return kept;
}

/** A locked workflow may name one specialist that must survive the instruction budget.
 * If it cannot fit, return nothing rather than silently keeping shorter optional skills. */
export function fittingSkillsWithRequired(skills, models, context = '', requiredId = '') {
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
export function skillsInstructions(skills, models, context = '') {
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

export function skillInstructions(skill, models) {
  return skillsInstructions(skill ? [skill] : [], models);
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
    const aspect = typeof raw.aspect === 'string' && modelAspectRatios(m).includes(raw.aspect) ? raw.aspect : null;
    drafts.push({
      model: m.id, name: m.name, kind: m.kind, credits: m.credits, prompt, aspect,
      needs: Object.entries(m.media || {}).filter(([, spec]) => spec && spec.required).map(([slot]) => slot),
    });
  }
  return drafts;
}
