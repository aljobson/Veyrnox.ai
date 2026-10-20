// Text payloads for the MCP list tools. MCP clients reliably read only the `content` text block, so the list tools put their full
// results there as compact JSON after a summary line. structuredContent stays as well.
import { MCP_SOURCE_SLOTS } from './mcpVideo.js';

const MAX_SUGGESTIONS = 5;

function outputType(modality) {
    const target = typeof modality === 'string' ? modality.split('-to-').pop() : '';
    return target || null;
}

/** One catalog row as the list_models text shows it. */
export function modelListing(model) {
    const isVideo = typeof model.modality === 'string' && model.modality.endsWith('video');
    const caps = model.capabilities || {};
    return {
        model_id: model.id,
        name: model.name,
        modality: model.modality,
        price_credits: model.credits,
        price_unit: isVideo ? 'per 5 seconds' : 'per output',
        aspect_ratios: caps.inputs?.aspect_ratio?.values || [],
        durations: model.durations || [],
        source_slots: Object.keys(caps.media || {}).filter((slot) => MCP_SOURCE_SLOTS.includes(slot)),
        ...(model.gated ? { gated: true } : {}),
    };
}

export function modelListText(models, modality) {
    const summary = `${models.length} Veyrnox models are available${modality ? ` for ${modality}` : ''}. Use model_id with estimate_generation, generate_image and generate_video.`;
    return `${summary}\n${JSON.stringify(models.map(modelListing))}`;
}

/** One job row from /api/v1/jobs as the list_generations text shows it. */
export function generationListing(job, models = []) {
    const model = models.find((entry) => entry.id === job.model_id);
    return {
        job_id: job.job_id,
        model_id: job.model_id,
        status: job.state,
        created_at: job.created_at,
        output_type: outputType(model?.modality),
        // The list never carries a link: result URLs are short-lived, so get_generation mints one on demand.
        output_url: null,
        has_output: !!job.has_asset,
    };
}

export function generationListText(data, models) {
    const jobs = Array.isArray(data?.jobs) ? data.jobs : [];
    const summary = `${jobs.length} Veyrnox generations returned. Output links are short-lived: call get_generation with job_id to get one.`;
    return `${summary}\n${JSON.stringify({ generations: jobs.map((job) => generationListing(job, models)), next: data?.next ?? null })}`;
}

function distance(a, b) {
    const row = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i += 1) {
        let diagonal = row[0];
        row[0] = i;
        for (let j = 1; j <= b.length; j += 1) {
            const above = row[j];
            row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
            diagonal = above;
        }
    }
    return row[b.length];
}

/** The valid model ids closest to a mistyped one: shared words first, then edit distance. */
export function closestModelIds(requested, models) {
    const wanted = String(requested || '').toLowerCase();
    const words = wanted.split(/[^a-z0-9]+/).filter(Boolean);
    return models
        .map((model) => {
            const id = String(model.id).toLowerCase();
            const haystack = `${id} ${String(model.name || '').toLowerCase()}`;
            const shared = words.filter((word) => haystack.includes(word)).length;
            return { id: model.id, shared, gap: distance(wanted, id) };
        })
        .sort((a, b) => b.shared - a.shared || a.gap - b.gap)
        .slice(0, MAX_SUGGESTIONS)
        .map((entry) => entry.id);
}
