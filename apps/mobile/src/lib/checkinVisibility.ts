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
