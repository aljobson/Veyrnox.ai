// The public address of the auth service, per project URL.
//
// The Supabase custom domain serves the same endpoints as the raw project host,
// so anything we print or send people to uses it and never the *.supabase.co
// project address. A constant, not a var: the production Worker is at its var
// budget (tests/workerBindingBudget.test.mjs). A project with no entry here
// falls back to its own URL.
const AUTH_HOSTS = new Map([['https://xdxdzmsztyzbnzeforxx.supabase.co', 'https://auth.veyrnox.ai']]);

export function publicAuthOrigin(projectUrl) {
    const url = String(projectUrl || '').replace(/\/$/, '');
    return AUTH_HOSTS.get(url) || url;
}
