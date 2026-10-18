import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { readPublicCatalog } from './publicCatalog.js';
import { GET as readJob } from '../app/api/v1/jobs/[id]/route.js';
import { GET as readJobAsset } from '../app/api/v1/jobs/[id]/asset/route.js';
import { GET as listJobs } from '../app/api/v1/jobs/route.js';
import { GET as readBalance } from '../app/api/v1/balance/route.js';
import { estimatedCredits } from './generationEstimate.js';
import { POST as createGeneration } from '../app/api/v1/generations/route.js';
import { IDEMPOTENCY_KEY_RE, MCP_GENERATION_LIMITS, startMcpGeneration } from './mcpGenerate.js';

export { estimatedCredits } from './generationEstimate.js';

const PUBLIC_ORIGIN = process.env.PUBLIC_HOST || 'https://veyrnox.ai';
const UUID = z.string().uuid();
const MODEL_ID = z.string().regex(/^[a-z0-9][a-z0-9.-]{0,63}$/);
const IDEMPOTENCY_KEY = z.string().regex(IDEMPOTENCY_KEY_RE);

const readOnly = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
};

function textResult(value, sentence) {
    return {
        content: [{ type: 'text', text: sentence || JSON.stringify(value, null, 2) }],
        structuredContent: value,
    };
}

function errorResult(status, body) {
    const code = body?.error || `http_${status}`;
    const details = { ok: false, status, ...body };
    return {
        isError: true,
        content: [{
            type: 'text',
            text: `Veyrnox could not complete the request (${code}). No success should be assumed.`,
        }],
        structuredContent: details,
    };
}

function trustedHeaders(source) {
    const headers = new Headers({ 'content-type': 'application/json' });
    // These values were blanked and then written by middleware.js after JWT
    // verification. Never copy arbitrary client headers into an internal API
    // call: the existing routes treat this one as the account boundary.
    for (const name of ['x-veyrnox-auth-id', 'x-veyrnox-auth-email', 'x-veyrnox-auth-role', 'x-veyrnox-auth-client-id',
        'x-veyrnox-auth-aal', 'x-veyrnox-auth-mfa-at', 'x-request-id', 'cf-ipcountry']) {
        const value = source.headers.get(name);
        if (value) headers.set(name, value);
    }
    return headers;
}

async function routeJson(handler, source, path, { method = 'GET', body, params } = {}) {
    const request = new Request(new URL(path, PUBLIC_ORIGIN), {
        method,
        headers: trustedHeaders(source),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const response = await handler(request, params ? { params: Promise.resolve(params) } : undefined);
    const data = await response.json().catch(() => ({ error: `http_${response.status}` }));
    return { response, data };
}

async function findModel(modelId) {
    const models = await readPublicCatalog();
    return { models, model: models.find((entry) => entry.id === modelId) };
}

/**
 * A fresh server is created for every HTTP request by createMcpHandler. Tool
 * closures therefore carry only the verified identity for that request.
 */
export function createVeyrnoxMcpServer(request) {
    const server = new McpServer({
        name: 'veyrnox-ai',
        title: 'Veyrnox.ai',
        version: '1.0.0',
        description: 'Inspect Veyrnox models, credit estimates, generation history and finished assets, and start small text-to-image generations after the price is confirmed.',
        websiteUrl: 'https://veyrnox.ai/mcp',
    }, { maxToolInputElements: 80 });

    server.registerTool('list_models', {
        title: 'List Veyrnox models',
        description: 'List the generation models currently offered by Veyrnox, including modality, controls and the credit price per output or five-second video unit.',
        inputSchema: z.object({
            modality: z.string().min(1).max(64).optional().describe('Optional exact modality filter, such as text-to-image or text-to-video.'),
        }),
        annotations: readOnly,
    }, async ({ modality }) => {
        try {
            const models = await readPublicCatalog();
            const filtered = modality ? models.filter((model) => model.modality === modality) : models;
            return textResult({ models: filtered, count: filtered.length }, `${filtered.length} Veyrnox models are available${modality ? ` for ${modality}` : ''}.`);
        } catch {
            return errorResult(503, { error: 'catalog_unavailable' });
        }
    });

    server.registerTool('estimate_generation', {
        title: 'Estimate generation cost',
        description: 'Return the maximum Veyrnox credit charge before generating. Video prices are calculated in five-second units. A free allowance may reduce the actual charge.',
        inputSchema: z.object({
            model_id: MODEL_ID,
            duration_seconds: z.number().int().positive().max(600).optional(),
        }),
        annotations: readOnly,
    }, async ({ model_id, duration_seconds }) => {
        try {
            const { model } = await findModel(model_id);
            if (!model) return errorResult(404, { error: 'model_not_found' });
            const credits = estimatedCredits(model, duration_seconds);
            if (credits === null) return errorResult(400, { error: 'duration_not_supported', supported_durations: model.durations || [] });
            const estimate = {
                model_id,
                model_name: model.name,
                modality: model.modality,
                duration_seconds: model.modality.endsWith('video') ? (duration_seconds || 5) : null,
                maximum_credits: credits,
                may_use_free_allowance: true,
            };
            return textResult(estimate, `This generation can charge at most ${credits} Veyrnox credits.`);
        } catch {
            return errorResult(503, { error: 'catalog_unavailable' });
        }
    });

    server.registerTool('generate_image', {
        title: 'Generate image',
        description: `Start ONE text-to-image generation on the signed-in Veyrnox account. This tool spends credits. Call estimate_generation first, show the maximum cost to the user, and pass that exact value as confirmed_credits. Limits: images only, at most ${MCP_GENERATION_LIMITS.maxCreditsPerCall} credits per call, and ${MCP_GENERATION_LIMITS.dailyCreditCap} credits per account per rolling 24 hours. Video, audio, image editing and uploaded source files are not available here.`,
        inputSchema: z.object({
            model_id: MODEL_ID,
            prompt: z.string().min(1).max(2000),
            negative_prompt: z.string().max(2000).optional(),
            aspect_ratio: z.enum(['16:9', '9:16', '1:1', '4:3', '3:4', '4:5', '21:9']).optional(),
            seed: z.number().int().min(0).max(2147483647).optional(),
            confirmed_credits: z.number().int().nonnegative().describe('Exact maximum_credits returned by estimate_generation.'),
            idempotency_key: IDEMPOTENCY_KEY.describe('Stable key for safe retries. Reuse it for the same intended generation; a new key is a new charge.'),
        }),
        annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
    }, async (args) => {
        const result = await startMcpGeneration(args, {
            now: () => Date.now(),
            async findModel(modelId) { return (await findModel(modelId)).model; },
            readRecentJobs: () => routeJson(listJobs, request, `/api/v1/jobs?limit=${MCP_GENERATION_LIMITS.jobsPageSize}`),
            createGeneration: (body) => routeJson(createGeneration, request, '/api/v1/generations', { method: 'POST', body }),
        });
        if (!result.ok) return errorResult(result.status, result.body);
        return textResult(result.data, `Veyrnox accepted generation ${result.data.job_id}. Use get_generation to check its status.`);
    });

    server.registerTool('get_generation', {
        title: 'Get generation',
        description: 'Read an owned generation. When it has succeeded, the result includes a short-lived link to the generated asset.',
        inputSchema: z.object({ job_id: UUID }),
        annotations: { ...readOnly, openWorldHint: true },
    }, async ({ job_id }) => {
        const { response, data } = await routeJson(readJob, request, `/api/v1/jobs/${job_id}`, { params: { id: job_id } });
        if (!response.ok) return errorResult(response.status, data);

        const content = [{ type: 'text', text: `Generation ${job_id} is ${data.state}.` }];
        let result = { job_id, ...data };
        if (data.state === 'succeeded') {
            const asset = await routeJson(readJobAsset, request, `/api/v1/jobs/${job_id}/asset`, { params: { id: job_id } });
            if (asset.response.ok) {
                result = { ...result, asset: asset.data };
                content.push({
                    type: 'resource_link',
                    name: `veyrnox-generation-${job_id}`,
                    title: 'Generated Veyrnox asset',
                    description: `Short-lived result URL; expires in ${asset.data.expires_in} seconds.`,
                    uri: asset.data.url,
                    mimeType: asset.data.mime_type,
                    size: Number(asset.data.size_bytes) || undefined,
                });
            } else {
                result = { ...result, asset_error: asset.data?.error || `http_${asset.response.status}` };
            }
        }
        return { content, structuredContent: result };
    });

    server.registerTool('list_generations', {
        title: 'List generations',
        description: 'List the signed-in Veyrnox account’s recent generations, newest first.',
        inputSchema: z.object({
            limit: z.number().int().min(1).max(50).default(24),
            before: z.string().datetime().optional(),
            before_id: UUID.optional(),
        }).refine((value) => Boolean(value.before) === Boolean(value.before_id), {
            message: 'before and before_id must be supplied together',
        }),
        annotations: readOnly,
    }, async ({ limit, before, before_id }) => {
        const url = new URL('/api/v1/jobs', PUBLIC_ORIGIN);
        url.searchParams.set('limit', String(limit));
        if (before && before_id) {
            url.searchParams.set('before', before);
            url.searchParams.set('before_id', before_id);
        }
        const { response, data } = await routeJson(listJobs, request, `${url.pathname}${url.search}`);
        if (!response.ok) return errorResult(response.status, data);
        return textResult(data, `${data.jobs?.length || 0} Veyrnox generations returned.`);
    });

    server.registerTool('get_balance', {
        title: 'Get credit balance',
        description: 'Read the signed-in Veyrnox account’s paid and free credit balances.',
        inputSchema: z.object({}),
        annotations: readOnly,
    }, async () => {
        const { response, data } = await routeJson(readBalance, request, '/api/v1/balance');
        if (!response.ok) return errorResult(response.status, data);
        return textResult(data, `This Veyrnox account has ${data.balance} paid credits and ${data.free_credits} free credits.`);
    });

    return server;
}
