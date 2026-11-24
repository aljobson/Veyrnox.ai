type Owner = string | symbol;
let active: { id: Owner; pause(): void } | null = null;

export function claimAudioFocus(id: Owner, pause: () => void): void {
    if (active?.id !== id) active?.pause();
    active = { id, pause };
}

export function releaseAudioFocus(id: Owner): void {
    if (active?.id === id) active = null;
}

export function isAudioFocusOwner(id: Owner): boolean {
    return active?.id === id;
}

export function resetAudioFocusForTests(): void { active = null; }
