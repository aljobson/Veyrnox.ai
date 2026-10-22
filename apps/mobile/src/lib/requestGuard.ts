// A cap on how often one kind of request may leave the app. A screen that re-runs by mistake (a loop of effects or
// remounts) would otherwise send hundreds a second, starve the app of time to draw, and hammer the server. Only
// allowed calls count, so the cap lifts on its own once the window has passed.
export interface RateGuard {
    allow(): boolean;
}

export function createRateGuard(limit: number, windowMs: number, now: () => number = Date.now): RateGuard {
    let stamps: number[] = [];
    return {
        allow() {
            const t = now();
            stamps = stamps.filter((s) => t - s < windowMs);
            if (stamps.length >= limit) return false;
            stamps.push(t);
            return true;
        },
    };
}

// Where a tripped guard says so. The crash reporter is plugged in at start; until then (and in tests) it is silent.
type IssueReporter = (message: string, tags: Record<string, string>) => void;

let reporter: IssueReporter = () => {};

export function setIssueReporter(next: IssueReporter): void {
    reporter = next;
}

export function reportIssue(message: string, tags: Record<string, string>): void {
    try {
        reporter(message, tags);
    } catch {
        // Reporting must never break the screen that tripped it.
    }
}
