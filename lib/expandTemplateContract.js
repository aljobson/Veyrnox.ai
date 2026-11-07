// Interned prompt strings keep the generated contract from embedding identical text three times.
export function expandFidelityContract(data, id) {
  if (typeof id !== 'string' || !Object.hasOwn(data.templates, id)) return null;
  const c = data.templates[id];
  return { ...c, sourcePrompt: data.prompts[c.sourcePromptIndex], prompt: data.prompts[c.promptIndex], photoPrompt: data.prompts[c.photoPromptIndex] };
}

