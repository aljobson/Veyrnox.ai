import { createBrowserSessionHandler } from '../../../../lib/browserSession.js';

export async function POST(req) {
    return createBrowserSessionHandler({
        supabaseUrl: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
        anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    })(req);
}
