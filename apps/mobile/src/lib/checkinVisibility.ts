// Check-in owns its modal; wins only observes its lifetime to defer celebrations.
const dialogs = new Set<symbol>();
const listeners = new Set<() => void>();
export const checkinDialogOpen = () => dialogs.size > 0;
export function onCheckinVisibilityChange(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}
export function holdCheckinDialog(): () => void {
    const token = Symbol();
    dialogs.add(token);
    listeners.forEach(listener => listener());
    return () => {
        if (dialogs.delete(token)) listeners.forEach(listener => listener());
    };
}

// The invitation may appear on its own only on the screens made for it: Explore (the home tab) and Credits.
export const checkinRouteEligible = (pathname: string | null | undefined): boolean => pathname === '/' || pathname === '/credits';
