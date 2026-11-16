// Tells screens that list projects (the Editor home) that a save, create, rename, delete or restore just succeeded,
// so a list that was fetched a moment earlier can fetch again instead of staying stale until a pull-to-refresh.
type Listener = () => void;
const listeners = new Set<Listener>();
let generation = 0;

export const notifyProjectsChanged = (): void => {
    generation += 1;
    for (const fn of [...listeners]) fn();
};
export const projectsChangedGeneration = (): number => generation;
export const subscribeProjectsChanged = (fn: Listener): (() => void) => {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
};
