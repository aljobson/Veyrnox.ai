// Mounted chips refresh immediately after a credit mutation, without navigation.
type Listener = (userId: string, balance: number) => void;
const listeners = new Set<Listener>();
export function subscribeBalance(listener: Listener): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}
export function publishBalance(userId: string, balance: number): void {
    listeners.forEach(listener => listener(userId, balance));
}
