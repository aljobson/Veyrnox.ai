export const CREATIVE_SCRIPT_MAX_BYTES = 64 * 1024;
export const CREATIVE_SCRIPT_MAX_CHARACTERS = 1000;

const SCRIPT_EXTENSIONS = /\.(?:txt|md|markdown)$/i;
const SCRIPT_MIME_TYPES = new Set(['', 'text/plain', 'text/markdown', 'text/x-markdown']);

export function creativeScriptFileProblem(file) {
  if (!file || typeof file.name !== 'string' || typeof file.size !== 'number') return 'missing';
  if (file.size <= 0) return 'empty';
  if (file.size > CREATIVE_SCRIPT_MAX_BYTES) return 'size';
  if (!SCRIPT_EXTENSIONS.test(file.name) || !SCRIPT_MIME_TYPES.has(file.type || '')) return 'type';
  return '';
}

export async function readCreativeScriptFile(file) {
  const problem = creativeScriptFileProblem(file);
  if (problem) return { problem, text: '' };
  const text = (await file.text()).trim();
  if (!text) return { problem: 'empty', text: '' };
  if (text.length > CREATIVE_SCRIPT_MAX_CHARACTERS) return { problem: 'length', text: '' };
  return { problem: '', text };
}
