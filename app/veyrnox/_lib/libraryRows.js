// Display rows for the Library grid: from this browser's job history, and from the account list (GET /jobs).

// Turn a history entry into a display row.
export function hydrateFromHistory(h) {
  return {
    job_id: h.job_id,
    model_id: h.model_id,
    credits: h.credits,
    prompt: h.prompt,
    name: h.name,
    submitted_at: h.submitted_at,
    state: 'queued',
    bg: gradientFor(h.job_id),
  };
}

// One account-list entry (GET /jobs) as a display row; `h` is this browser's cached name and prompt for it, if any.
export function serverRow(j, h) {
  return { ...hydrateFromHistory({ ...h, job_id: j.job_id, model_id: j.model_id, credits: j.credits }),
    name: h.name || j.label, prompt: h.prompt || j.label,
    submitted_at: h.submitted_at || Date.parse(j.created_at) || undefined,
    state: j.state, refunded: j.refunded, error_code: j.error_code, has_asset: j.has_asset, held: j.held, ...(j.held ? { asset_url: undefined } : {}), asset_expires_at: j.asset_expires_at };
}

// Deterministic thumbnail placeholder based on job id — until an asset arrives.
function gradientFor(id) {
  const seed = [...id].reduce((n, c) => (n * 31 + c.charCodeAt(0)) | 0, 0);
  const hue = Math.abs(seed) % 360;
  return `linear-gradient(135deg, hsl(${hue} 40% 12%), hsl(${hue} 50% 30%), hsl(${(hue + 30) % 360} 55% 55%))`;
}

