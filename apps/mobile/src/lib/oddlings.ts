// Oddlings: the 72 original, fictional adult characters the web shows in its gallery. The data is generated from the web
// files (scripts/sync-oddlings-cast.mjs) and a test fails when the copy drifts. Nothing here calls the server.
import cast from './oddlings/cast.json';

export type OddlingKind = 'human' | 'creature';

export interface Oddling {
    readonly id: string;
    readonly kind: OddlingKind;
    readonly name: string;
    readonly hook: string;
    readonly accent: string;
    readonly collections: readonly string[];
    readonly premise: { readonly obsession: string; readonly voice: string; readonly voiceNote: string; readonly show: string; readonly showNote: string };
    readonly identity: readonly string[];
    readonly traits: readonly string[];
    readonly picks: Readonly<Record<string, string>>;
}

export interface OddlingTab {
    readonly id: string;
    readonly label: string;
}

export const ODDLING_TABS: readonly OddlingTab[] = cast.tabs;
export const ODDLINGS: readonly Oddling[] = cast.characters as unknown as Oddling[];

export const KIND_FILTERS: readonly { id: OddlingKind; labelKey: string }[] = [
    { id: 'human', labelKey: 'oddlings.kind.human' },
    { id: 'creature', labelKey: 'oddlings.kind.creature' },
];

// The web serves the portraits as static files from the public site. They are loaded on demand and cached by the image
// component, never bundled, so the app does not grow with the cast.
export const PORTRAIT_HOST = 'https://veyrnox.ai';
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function findOddling(id: string | undefined): Oddling | null {
    if (typeof id !== 'string' || id.length > 64 || !ID_PATTERN.test(id)) return null;
    return ODDLINGS.find((item) => item.id === id) ?? null;
}

export function portraitUrl(id: string): string {
    return `${PORTRAIT_HOST}/oddlings/portraits/${encodeURIComponent(id)}.webp`;
}

export function inTab(tabId: string): readonly Oddling[] {
    return tabId === 'all' ? ODDLINGS : ODDLINGS.filter((item) => item.collections.includes(tabId));
}

export function visibleOddlings(tabId: string, kind: OddlingKind | null): readonly Oddling[] {
    const list = inTab(tabId);
    return kind ? list.filter((item) => item.kind === kind) : list;
}

export function kindCount(tabId: string, kind: OddlingKind): number {
    return inTab(tabId).filter((item) => item.kind === kind).length;
}

// Pressing the active chip clears the filter; any other chip selects it.
export function toggleKind(current: OddlingKind | null, next: OddlingKind): OddlingKind | null {
    return current === next ? null : next;
}

// A filter that would leave a newly opened collection empty is dropped.
export function reconcileKind(tabId: string, kind: OddlingKind | null): OddlingKind | null {
    return kind && kindCount(tabId, kind) > 0 ? kind : null;
}

// The public page for a character on the site. Only an id from the cast ever reaches here (findOddling), so the link
// is always one of the 72 original characters and never a user-made one.
export const shareUrl = (id: string): string => `${PORTRAIT_HOST}/oddlings/${encodeURIComponent(id)}`;

export const shareMessage = (name: string, hook: string): string => `${name}: ${hook} An original fictional character on Veyrnox.ai.`;
