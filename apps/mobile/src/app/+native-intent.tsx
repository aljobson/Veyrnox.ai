import { resolveAppLink } from '../lib/resolveAppLink';

// Expo Router calls this for every link the system hands the app (cold start and while open).
// It must never throw: a bad link falls back to Home.
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string | Promise<string> {
    try {
        return resolveAppLink(path);
    } catch {
        return '/';
    }
}
