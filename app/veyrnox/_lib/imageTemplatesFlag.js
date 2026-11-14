// Publication only; no provider calls, preview generation or prices here.
export function imageTemplatesEnabled(env = process.env) {
  return env?.IMAGE_TEMPLATES_ENABLED === 'true';
}

