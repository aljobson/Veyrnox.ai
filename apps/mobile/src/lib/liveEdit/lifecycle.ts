// Inactive is a system overlay (including save permission), not a background transition.
// Generation is also an export lease: backgrounding invalidates an already-open save.
export function createInferenceLifecycle() {
    let background = false, ready = false, generation = 0;
    return {
        get generation() { return generation; },
        get canSave() { return ready && !background; },
        reset() { ready = false; return ++generation; },
        accept(token: number) { if (background || token !== generation) return false; ready = true; return true; },
        fail(token: number) { if (token === generation) ready = false; },
        owns(token: number) { return ready && !background && token === generation; },
        transition(state: string): 'suspend' | 'refresh' | null {
            if (state === 'background' && !background) { background = true; ready = false; generation++; return 'suspend'; }
            if (state === 'active' && background) { background = false; return 'refresh'; }
            return null;
        },
    };
}
