import { CHARACTER_GROUPS, sanitizeOddlingPicks } from './character.js';
import { ODDLING_MOTIONS } from './oddlingStudio.js';

export const ODDLING_CHAT_HANDOFF_KEY = 'veyrnox_oddling_chat_handoff_v2';
export const ODDLING_CHAT_THREAD_PREFIX = 'veyrnox_oddling_chat_thread_v2:';
export const ODDLING_CHAT_HANDOFF_MAX_AGE = 30 * 60 * 1000;
export const ODDLING_CHAT_THREAD_MAX_AGE = 30 * 24 * 60 * 60 * 1000;
export const ODDLING_CANON_MAX = 2200;

const LAUNCH_ID = /^[a-zA-Z0-9_-]{16,80}$/;
const THREAD_ID = /^[a-zA-Z0-9_-]{1,100}$/;
const USER_ID = /^[a-zA-Z0-9_-]{1,100}$/;
const MAX_THREAD_INSTRUCTIONS = 4000;
// Compact but meaningful labels keep every supported visual category inside the Chat instruction budget.
const VISUAL_ALIASES = [
  'ty', 'ex', 'g', 'or', 'ag', 'sk', 'ec', 'et', 'es', 'ed', 'mo', 'ea', 'ho', 'sc', 'hs', 'br', 'no',
  'ch', 'li', 'jw', 'ff', 'fh', 'fm', 'fp', 'bo', 'he', 'pr', 'to', 'ns', 'as', 'ls', 'hds', 'eys',
  'mos', 'eas', 'nos', 'has', 'fs', 'nk', 'la', 'ra', 'll', 'rl', 'hr', 'hc', 'wd', 'hw', 'da',
  'ac', 'df', 're',
];
const oneLine = (value, max) => String(value || '')
  .replace(/[\u0000-\u001f\u007f]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, max);

function cleanHandoff(value, now, maxAge) {
  if (!value || value.version !== 2 || !Number.isFinite(value.savedAt)) return null;
  if (value.savedAt > now + 60_000 || now - value.savedAt > maxAge) return null;
  const ownerId = oneLine(value.ownerId, 100);
  if (!USER_ID.test(ownerId)) return null;
  const picks = sanitizeOddlingPicks(value.picks);
  if (!Object.keys(picks).length) return null;
  const motionId = oneLine(value.motionId, 80);
  const instructions = typeof value.instructions === 'string' && value.instructions.length <= MAX_THREAD_INSTRUCTIONS
    ? value.instructions : '';
  return {
    savedAt: value.savedAt,
    ownerId,
    picks,
    mode: value.mode === 'motion' ? 'motion' : 'portrait',
    scene: oneLine(value.scene, 300),
    referenceNote: oneLine(value.referenceNote, 180),
    portraitId: oneLine(value.portraitId, 80),
    motionId: ODDLING_MOTIONS.some((motion) => motion.id === motionId) ? motionId : '',
    instructions,
  };
}

function launchIdOf(value) {
  const id = oneLine(value, 80);
  return LAUNCH_ID.test(id) ? id : '';
}

function threadKey(userId, threadId) {
  const owner = oneLine(userId, 100);
  const id = oneLine(threadId, 100);
  return USER_ID.test(owner) && THREAD_ID.test(id) ? `${ODDLING_CHAT_THREAD_PREFIX}${owner}:${id}` : '';
}

/** The URL receives only this opaque identifier; no passport or story text is exposed there. */
export function makeOddlingChatLaunchId(random = globalThis.crypto) {
  try {
    const id = random.randomUUID().replaceAll('-', '');
    return launchIdOf(id);
  } catch {
    return '';
  }
}

/** Keep a structured passport in this tab and return the opaque launch id written for it. */
export function writeOddlingChatHandoff(storage, value, now = Date.now(), launchId = makeOddlingChatLaunchId()) {
  try {
    const id = launchIdOf(launchId);
    const clean = cleanHandoff({ ...value, version: 2, savedAt: now }, now, ODDLING_CHAT_HANDOFF_MAX_AGE);
    if (!id || !clean) return '';
    storage.setItem(ODDLING_CHAT_HANDOFF_KEY, JSON.stringify({ version: 2, launchId: id, ...clean }));
    return id;
  } catch {
    return '';
  }
}

/** Read only the passport named by this URL. A mismatched launch never receives the most recent passport. */
export function readOddlingChatHandoff(storage, expectedLaunchId, expectedOwnerId, now = Date.now()) {
  try {
    const raw = JSON.parse(storage.getItem(ODDLING_CHAT_HANDOFF_KEY));
    const expected = launchIdOf(expectedLaunchId);
    if (!raw || !expected || launchIdOf(raw.launchId) !== expected) return null;
    const clean = cleanHandoff(raw, now, ODDLING_CHAT_HANDOFF_MAX_AGE);
    if (clean && clean.ownerId !== oneLine(expectedOwnerId, 100)) return null;
    if (!clean) storage.removeItem(ODDLING_CHAT_HANDOFF_KEY);
    return clean;
  } catch {
    try { storage.removeItem(ODDLING_CHAT_HANDOFF_KEY); } catch { /* storage is unavailable */ }
    return null;
  }
}

/** Bind a verified one-time launch to its new thread, then consume the launch record. */
export function bindOddlingThreadContext(launchStorage, threadStorage, userId, threadId, launchId, instructions, now = Date.now()) {
  try {
    const context = readOddlingChatHandoff(launchStorage, launchId, userId, now);
    const prompt = typeof instructions === 'string' ? instructions.trim() : '';
    if (!context || !prompt || !writeOddlingThreadContext(threadStorage, userId, threadId, context, prompt, now)) return null;
    launchStorage.removeItem(ODDLING_CHAT_HANDOFF_KEY);
    return { ...context, instructions: prompt };
  } catch {
    return null;
  }
}

/** Rebind already verified in-memory context when a no-charge first send removed its empty thread. */
export function writeOddlingThreadContext(storage, userId, threadId, context, instructions, now = Date.now()) {
  try {
    const key = threadKey(userId, threadId);
    const prompt = typeof instructions === 'string' ? instructions.trim() : '';
    const clean = cleanHandoff({ version: 2, ...context, ownerId: userId, instructions: prompt }, now, ODDLING_CHAT_THREAD_MAX_AGE);
    if (!key || !clean || !prompt || clean.instructions !== prompt) return false;
    storage.setItem(key, JSON.stringify({ version: 2, ...clean, instructions: prompt, savedAt: now }));
    return true;
  } catch {
    return false;
  }
}

/** Restore the passport while this tab revisits or refreshes its bound chat. */
export function readOddlingThreadContext(storage, userId, threadId, now = Date.now()) {
  const key = threadKey(userId, threadId);
  if (!key) return null;
  try {
    const clean = cleanHandoff(JSON.parse(storage.getItem(key)), now, ODDLING_CHAT_THREAD_MAX_AGE);
    if (clean && clean.ownerId !== oneLine(userId, 100)) return null;
    if (!clean) storage.removeItem(key);
    return clean;
  } catch {
    try { storage.removeItem(key); } catch { /* storage is unavailable */ }
    return null;
  }
}

/** Read a matching lock without destroying a mismatched passport. The caller keeps that explicit
 * blocked state visible until the exact server prompt is restored or the person starts a new chat. */
export function readMatchingOddlingThreadContext(storage, userId, threadId, systemPrompt, now = Date.now()) {
  const context = readOddlingThreadContext(storage, userId, threadId, now);
  const prompt = typeof systemPrompt === 'string' ? systemPrompt : '';
  if (context?.instructions && context.instructions === prompt) return context;
  return null;
}

export function oddlingThreadPromptMatches(context, systemPrompt) {
  return !!context?.instructions && context.instructions === (typeof systemPrompt === 'string' ? systemPrompt : '');
}

export function removeOddlingThreadContext(storage, userId, threadId) {
  const key = threadKey(userId, threadId);
  if (!key) return;
  try { storage.removeItem(key); } catch { /* storage is unavailable */ }
}

export function removeOddlingChatHandoff(storage, expectedLaunchId = '') {
  try {
    if (expectedLaunchId) {
      const expected = launchIdOf(expectedLaunchId);
      const raw = JSON.parse(storage.getItem(ODDLING_CHAT_HANDOFF_KEY));
      if (!expected || !raw || launchIdOf(raw.launchId) !== expected) return false;
    }
    storage.removeItem(ODDLING_CHAT_HANDOFF_KEY);
    return true;
  } catch {
    return false;
  }
}

/** A delayed bind may finish only on the same new-Chat launch it started from. */
export function canFinishOddlingLaunch({ left, atNewChat, pathname, urlLaunchId, refLaunchId, expectedLaunchId, generation, expectedGeneration }) {
  const expected = launchIdOf(expectedLaunchId);
  return !left && atNewChat && pathname === '/app/chat' && !!expected
    && launchIdOf(urlLaunchId) === expected && launchIdOf(refLaunchId) === expected
    && generation === expectedGeneration;
}

/** Bounded system context: canon first, then the current scene, then the supported visual vocabulary. */
export function oddlingCanonInstructions(handoff) {
  const clean = handoff && cleanHandoff({ version: 2, ...handoff }, handoff.savedAt, ODDLING_CHAT_THREAD_MAX_AGE);
  if (!clean) return '';
  const p = clean.picks;
  const motion = clean.mode === 'motion' && ODDLING_MOTIONS.find((item) => item.id === clean.motionId);
  const visual = CHARACTER_GROUPS.flatMap((group, index) => p[group.id]
    ? [`${VISUAL_ALIASES[index] || group.id}=${oneLine(p[group.id], 60)}`]
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

export function oddlingHandoffName(handoff) {
  return sanitizeOddlingPicks(handoff?.picks).oddling_name || 'Oddling';
}
