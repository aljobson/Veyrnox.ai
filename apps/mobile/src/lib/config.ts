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
export const config: EnvConfig = ENVIRONMENTS[APP_ENV];

// Registered as the app scheme in app.json. Supabase must list this exact URL
// as an allowed redirect (ADR-0106, owner prerequisite).
export const AUTH_REDIRECT_URL = 'veyrnox://auth/callback';
