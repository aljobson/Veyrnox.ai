#!/usr/bin/env node

const token = process.env.CLOUDFLARE_API_TOKEN;
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const zoneName = process.env.CLOUDFLARE_ZONE_NAME || 'veyrnox.ai';
const apply = process.argv.includes('--apply');

if (!token) throw new Error('CLOUDFLARE_API_TOKEN is required');

const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
};

async function api(path, init = {}) {
    const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
        ...init,
        headers: { ...headers, ...init.headers },
        signal: AbortSignal.timeout(15_000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.success !== true) {
        const codes = Array.isArray(body.errors) ? body.errors.map((error) => error.code).filter(Boolean).join(',') : '';
        throw new Error(`Cloudflare API ${response.status}${codes ? ` (${codes})` : ''}`);
    }
    return body.result;
}

const query = new URLSearchParams({ name: zoneName, status: 'active', ...(accountId ? { 'account.id': accountId } : {}) });
const zones = await api(`/zones?${query}`);
if (!Array.isArray(zones) || zones.length !== 1) throw new Error(`Expected one active ${zoneName} zone`);
const zoneId = zones[0].id;

const required = new Map([
    ['always_use_https', 'on'],
    ['min_tls_version', '1.2'],
]);

for (const [setting, wanted] of required) {
    let current = await api(`/zones/${zoneId}/settings/${setting}`);
    if (current?.value !== wanted && apply) {
        current = await api(`/zones/${zoneId}/settings/${setting}`, {
            method: 'PATCH',
            body: JSON.stringify({ value: wanted }),
        });
    }
    if (current?.value !== wanted) throw new Error(`${setting} is ${current?.value || 'unknown'}; expected ${wanted}`);
    console.log(`${setting}=${current.value}`);
}
