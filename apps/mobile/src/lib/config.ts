// Public values only: both Supabase keys below are the same ones the web app
// ships in wrangler.jsonc and packages/security/environments.js.
export type AppEnv = 'production' | 'staging';

export interface EnvConfig {
    readonly apiBase: string;
    readonly supabaseUrl: string;
    readonly publishableKey: string;
}

const ENVIRONMENTS: Record<AppEnv, EnvConfig> = {
    production: {
        apiBase: 'https://veyrnox.ai',
        supabaseUrl: 'https://xdxdzmsztyzbnzeforxx.supabase.co',
        publishableKey: 'sb_publishable_HwEQqi6FXJOmWpy5eqR9-A_Zvy8_ii1',
    },
    staging: {
        apiBase: 'https://veyrnox-ai-staging.al-jobson.workers.dev',
        supabaseUrl: 'https://yrqzwqywxfesmbvhzjgj.supabase.co',
        publishableKey: 'sb_publishable_bAxQiodzBhI6bV7lmo9gMQ_Hlg9_Ish',
    },
};

export function resolveAppEnv(value: string | undefined): AppEnv {
    return value === 'staging' ? 'staging' : 'production';
}

export const APP_ENV: AppEnv = resolveAppEnv(process.env.EXPO_PUBLIC_APP_ENV);
// Development only: point the app at dev/mock-server.mjs to preview every signed-in screen without an account.
const DEV_API = __DEV__ ? process.env.EXPO_PUBLIC_DEV_API_BASE : undefined;
export const DEV_MOCK = Boolean(DEV_API);
export const config: EnvConfig = DEV_API
    ? { ...ENVIRONMENTS[APP_ENV], apiBase: DEV_API, supabaseUrl: DEV_API }
    : ENVIRONMENTS[APP_ENV];

// Registered as the app scheme in app.json. The sign-in session ends when the
// browser reaches this address.
export const AUTH_REDIRECT_URL = 'ai.veyrnox.app://auth/callback';

// Where Supabase sends the browser after Google or Apple. It is on the site's
// own origin, which Supabase always allows, and forwards the code to
// AUTH_REDIRECT_URL (app/auth/mobile/route.js, ADR-0106 amendment 1).
export const OAUTH_BRIDGE_URL = `${config.apiBase}/auth/mobile`;
