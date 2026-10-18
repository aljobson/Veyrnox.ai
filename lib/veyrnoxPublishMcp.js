import { z } from 'zod';
import { cancelPost, getAnalytics, listAccounts, listBrands, listPosts, reschedulePostAt, schedulePost } from './publishAutomation.js';

// ADR-0112. Publish tools for the MCP connector. Registered only while
// PUBLISH_AUTOMATION_ENABLED is on, so the public /mcp page's read-only
// promise stays true until the owner flips it and its copy is updated.

const UUID = z.string().uuid();
const INSTANT = z.string().datetime({ offset: true });
const BRAND = UUID.optional().describe('Optional brand id from publish_list_brands. Defaults to your own brand.');

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

function respond(result, sentence) {
    if (result.status >= 200 && result.status < 300) {
        return { content: [{ type: 'text', text: sentence(result.body) }], structuredContent: result.body };
    }
    const code = result.body?.error || `http_${result.status}`;
    return {
        isError: true,
        content: [{ type: 'text', text: `Veyrnox Publish could not complete the request (${code}). No success should be assumed.` }],
        structuredContent: { ok: false, status: result.status, ...result.body },
    };
}

export function registerPublishTools(server, request) {
    server.registerTool('publish_list_brands', {
        title: 'List Publish brands',
        description: 'List the Publish brands you can act on and your role in each. Only available when team access is open; otherwise use the default brand.',
        inputSchema: z.object({}),
        annotations: readOnly,
    }, async () => respond(await listBrands(request), (body) => `${body.brands?.length || 0} Publish brands.`));

    server.registerTool('publish_list_accounts', {
        title: 'List connected social accounts',
        description: 'List the social accounts connected to a Publish brand, with network, status and whether publishing is open for that network.',
        inputSchema: z.object({ brand_id: BRAND }),
        annotations: readOnly,
    }, async ({ brand_id }) => respond(await listAccounts(request, { brandId: brand_id }),
        (body) => `${body.accounts.length} connected accounts (plan: ${body.plan_tier || 'unknown'}).`));

    server.registerTool('publish_list_posts', {
        title: 'List scheduled or published posts',
        description: 'List posts whose publish time falls in a window of at most 43 days. Without a status, returns the next 43 days. With status published, failed or canceled, returns the previous 43 days unless from and to are given. Each post carries updated_at, which publish_cancel_post needs, plus can_cancel and can_reschedule. Requires a Publish Plan.',
        inputSchema: z.object({
            status: z.enum(['scheduled', 'published', 'failed', 'canceled']).optional(),
            network: z.string().regex(/^[a-z]{2,16}$/).optional(),
            from: INSTANT.optional(),
            to: INSTANT.optional(),
            brand_id: BRAND,
        }),
        annotations: readOnly,
    }, async ({ brand_id, ...rest }) => respond(await listPosts(request, { ...rest, brandId: brand_id }),
        (body) => `${body.posts.length} posts between ${body.from} and ${body.to}.`));

    server.registerTool('publish_get_analytics', {
        title: 'Analytics summary for an account',
        description: 'Summarize analytics for one connected account over a date range of at most 366 days (within your plan’s history): first and last stored day, number of days with data, and the ten most recent posts with metrics. Requires a Publish Plan.',
        inputSchema: z.object({
            account_id: UUID,
            from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            brand_id: BRAND,
        }),
        annotations: readOnly,
    }, async ({ account_id, from, to, brand_id }) => respond(await getAnalytics(request, { accountId: account_id, from, to, brandId: brand_id }),
        (body) => `${body.days_with_data} days of data and ${body.post_count} posts from ${body.from} to ${body.to}.`));

    server.registerTool('publish_schedule_post', {
        title: 'Schedule a post',
        description: 'Schedule one post to publish later to the chosen connected accounts. Media must be your own finished generations (job_id) or verified uploads (upload_id). The time must be at least 10 minutes ahead; this tool never posts immediately. Requires a Publish Plan. The same idempotency_key never creates a second post. Confirm the accounts, text and time with the user before calling.',
        inputSchema: z.object({
            scheduled_at: INSTANT.describe('ISO 8601 time with offset, at least 10 minutes in the future.'),
            account_ids: z.array(UUID).min(1).max(20),
            media: z.array(z.object({
                media_type: z.enum(['image', 'video']),
                job_id: UUID.optional(),
                upload_id: UUID.optional(),
            }).strict()).min(1).max(10),
            text: z.string().max(4000).optional(),
            idempotency_key: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/),
            brand_id: BRAND,
        }).strict(),
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    }, async ({ scheduled_at, account_ids, media, text, idempotency_key, brand_id }) => respond(
        await schedulePost(request, {
            scheduledAt: scheduled_at, accountIds: account_ids, text, idempotencyKey: idempotency_key, brandId: brand_id,
            media: media.map((item) => ({ mediaType: item.media_type, jobId: item.job_id, uploadId: item.upload_id })),
        }),
        (body) => `Post ${body.post_id} is scheduled for ${body.scheduled_at} on ${body.target_count} accounts.`));

    server.registerTool('publish_reschedule_post', {
        title: 'Reschedule a post',
        description: 'Move a scheduled post that has not started publishing to a new time at least 10 minutes ahead. expected_at must be the post’s current scheduled_at from publish_list_posts; a changed post is rejected rather than overwritten. Requires a Publish Plan.',
        inputSchema: z.object({ post_id: UUID, scheduled_at: INSTANT, expected_at: INSTANT, brand_id: BRAND }).strict(),
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    }, async ({ post_id, scheduled_at, expected_at, brand_id }) => respond(
        await reschedulePostAt(request, { postId: post_id, scheduledAt: scheduled_at, expectedAt: expected_at, brandId: brand_id }),
        (body) => `Post ${body.post_id} now publishes at ${body.scheduled_at}.`));

    server.registerTool('publish_cancel_post', {
        title: 'Cancel a scheduled post',
        description: 'Cancel a scheduled post that has not started publishing. expected_updated_at must be the post’s updated_at from publish_list_posts. The post can be restored in the Publish app. Confirm with the user before calling. Requires a Publish Plan.',
        inputSchema: z.object({ post_id: UUID, expected_updated_at: INSTANT, brand_id: BRAND }).strict(),
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    }, async ({ post_id, expected_updated_at, brand_id }) => respond(
        await cancelPost(request, { postId: post_id, expectedUpdatedAt: expected_updated_at, brandId: brand_id }),
        (body) => `Post ${body.post_id} is canceled.`));
}
