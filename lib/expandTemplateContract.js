import { brotliCompressSync, brotliDecompressSync, constants } from 'node:zlib';

// The prompts (interned, so identical text is stored once) and the per-template rows are brotli-compressed in the JSON file: they
// are 3.7 MB of text and the Worker size budget is 56000 KiB. Server and offline callers only (never the browser).
const decoded = new WeakMap();
export function contractData(data) {
  if (data.templates && data.prompts) return data;
  if (!decoded.has(data)) decoded.set(data, JSON.parse(brotliDecompressSync(Buffer.from(data.z, 'base64')).toString('utf8')));
  return decoded.get(data);
}
export function compressContractData(packed) {
  const body = Buffer.from(JSON.stringify({ prompts: packed.prompts, templates: packed.templates }), 'utf8');
  const z = brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_LGWIN]: 24 } });
  return { contractVersion: packed.contractVersion, z: z.toString('base64') };
}

export function expandFidelityContract(data, id) {
  const { prompts, templates } = contractData(data);
  if (typeof id !== 'string' || !Object.hasOwn(templates, id)) return null;
  const c = templates[id];
  return { ...c, sourcePrompt: prompts[c.sourcePromptIndex], prompt: prompts[c.promptIndex], photoPrompt: prompts[c.photoPromptIndex] };
}
