#!/usr/bin/env node
import { fileURLToPath } from 'node:url';

const BASE = 'https://api.cloudflare.com/client/v4/accounts/fb18d9f7052afbea5a5e0eae69948af2/queues';
export const STAGING_QUEUES = Object.freeze([
    Object.freeze({ id: '93f44fe046034ccda42a6014ccdaa6f7', name: 'veyrnox-fal-dispatch-staging', dlq: false }),
    Object.freeze({ id: '25500fbb12af4b558982e08d6b337ab8', name: 'veyrnox-fal-dispatch-staging-dlq', dlq: true }),
]);
const MAX_AGE_MS = 300_000;

export function assessQueueMetrics(value, { dlq, now }) {
    for (const field of ['backlog_count', 'backlog_bytes', 'oldest_message_timestamp_ms']) {
        if (!Number.isSafeInteger(value?.[field]) || value[field] < 0) throw Error('invalid metrics');
    }
    const count = value.backlog_count;
    const timestamp = value.oldest_message_timestamp_ms;
    if (!Number.isSafeInteger(now) || timestamp > now + 5_000) throw Error('invalid clock');
    // Zero means unknown, not newly enqueued. DLQ presence is actionable
    // regardless of age; the source queue needs an age to assess its backlog.
    if (count > 0 && timestamp === 0 && !dlq) throw Error('unknown backlog age');
    const ageSeconds = count > 0 && timestamp > 0 ? Math.floor(Math.max(0, now - timestamp) / 1000) : null;
    return {
        count, ageSeconds,
        issue: dlq ? count > 0 : count > 0 && now - timestamp >= MAX_AGE_MS,
    };
}

export async function checkFalQueueHealth({ token, fetchImpl = fetch, now = Date.now } = {}) {
    if (typeof token !== 'string' || !token.trim()) {
        return { exitCode: 2, report: 'Staging fal queue monitoring unreadable: missing Cloudflare token.' };
    }
    async function request(path) {
        const response = await fetchImpl(`${BASE}/${path}`, {
            method: 'GET', headers: { Authorization: `Bearer ${token}` },
            redirect: 'error', signal: AbortSignal.timeout(8_000),
        });
        if (!response.ok) throw Error('unreadable response');
        const envelope = await response.json();
        if (envelope?.success !== true || (envelope.errors !== undefined &&
            (!Array.isArray(envelope.errors) || envelope.errors.length > 0))) throw Error('invalid envelope');
        return envelope.result;
    }
    const results = await Promise.allSettled(STAGING_QUEUES.map(async queue => {
        const metadata = await request(queue.id);
        if (metadata?.queue_id !== queue.id || metadata?.queue_name !== queue.name) throw Error('wrong queue');
        const metrics = await request(`${queue.id}/metrics`);
        return assessQueueMetrics(metrics, { dlq: queue.dlq, now: now() });
    }));
    let unreadable = false;
    let issue = false;
    const lines = ['Staging fal queue metrics (best effort; approximate snapshot):'];
    results.forEach((result, index) => {
        const queue = STAGING_QUEUES[index];
        if (result.status === 'rejected') {
            unreadable = true;
            // Never interpolate API bodies, exceptions, credentials or message data.
            lines.push(`${queue.name}: monitoring unreadable.`);
            return;
        }
        const value = result.value;
        issue ||= value.issue;
        lines.push(`${queue.name}: backlog=${value.count}; oldest age seconds=${value.ageSeconds ?? 'unavailable'}; ${value.issue ? 'INVESTIGATE' : 'no threshold breached'}.`);
    });
    lines.push(unreadable ? 'Monitoring incomplete; investigate access, response schema and backlog age.' :
        issue ? 'Investigate queue backlog; do not automatically redrive provider work.' : 'No queue issues observed in this metrics snapshot.');
    return { exitCode: unreadable ? 2 : issue ? 1 : 0, report: lines.join('\n') };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const result = await checkFalQueueHealth({ token: process.env.CLOUDFLARE_API_TOKEN });
    console.log(result.report);
    process.exitCode = result.exitCode;
}
