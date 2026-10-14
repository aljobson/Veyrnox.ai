const KEY = 'veyrnox_film_template_draft_v1';
const TARGETS = new Set([30, 60, 90, 120]);

function clean(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export function filmStarterForTemplate(preset, prompt, targetSeconds = 60) {
  const target = Number(targetSeconds);
  return {
    templateId: clean(preset?.id || preset?.templateId, 100),
    title: clean(preset?.name || preset?.title, 100),
    prompt: clean(prompt, 2000),
    model: clean(preset?.model, 120),
    aspect: ['16:9', '9:16', '1:1'].includes(preset?.aspect) ? preset.aspect : '16:9',
    targetSeconds: TARGETS.has(target) ? target : 60,
  };
}

export function writeFilmStarter(storage, preset, prompt, targetSeconds) {
  if (!storage) return false;
  const draft = filmStarterForTemplate(preset, prompt, targetSeconds);
  if (!draft.templateId || !draft.prompt) return false;
  storage.setItem(KEY, JSON.stringify(draft));
  return true;
}

export function takeFilmStarter(storage) {
  if (!storage) return null;
  const raw = storage.getItem(KEY);
  storage.removeItem(KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    const draft = filmStarterForTemplate(value, value.prompt, value.targetSeconds);
    return draft.templateId && draft.prompt ? draft : null;
  } catch {
    return null;
  }
}
