// Which side of the screen Vey sits on. The web stores the same small record (`lib/veyPlacement`): a version and a side,
// left by default. Nothing about the conversation, a task or consent is ever stored with it.
export type VeySide = 'left' | 'right';

export const DEFAULT_SIDE: VeySide = 'left';
// SecureStore keys allow letters, digits, '.', '-' and '_'.
export const VEY_PLACEMENT_SLOT = 'veyrnox.vey.placement.v1';

export function parseSide(raw: string | null | undefined): VeySide {
    if (!raw) return DEFAULT_SIDE;
    try {
        const value = JSON.parse(raw) as { version?: unknown; side?: unknown } | null;
        if (value && !Array.isArray(value) && value.version === 1 && value.side === 'right') return 'right';
    } catch {
        // Not our record: use the default.
    }
    return DEFAULT_SIDE;
}

export const serializeSide = (side: VeySide): string => JSON.stringify({ version: 1, side });

export const otherSide = (side: VeySide): VeySide => (side === 'left' ? 'right' : 'left');
