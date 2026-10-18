import { mapAppLink } from '../lib/appLinks';

// Expo Router calls this for every link the system hands the app (cold start and while open).
// It must never throw: a bad link falls back to Home.
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
    try {
        return mapAppLink(path);
    } catch {
        return '/';
    }
}
