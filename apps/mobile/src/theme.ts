// The Veyrnox.ai dark palette: the --vx-* tokens in app/globals.css, as hex.
export const colors = {
    background: '#0a0a0b',
    surface: '#141416',
    border: '#26262a',
    borderStrong: '#3e3e44',
    text: '#f2f2f3',
    body: '#c9c9cf',
    muted: '#9a9aa3',
    accent: '#3ee6c4',
    accentInk: '#06231f',
    money: '#e4a93c',
    danger: '#ff5c47',
} as const;

// Shared sizes, so screens stop repeating literals. Values match what the screens already used.
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
export const radius = { sm: 6, md: 10, lg: 12, pill: 999 } as const;
export const type = {
    caption: { fontSize: 12 },
    small: { fontSize: 13 },
    footnote: { fontSize: 14 },
    callout: { fontSize: 15 },
    body: { fontSize: 16 },
    titleLarge: { fontSize: 32, fontWeight: '700' },
    label: { fontSize: 16, fontWeight: '600' },
} as const;
export const disabledOpacity = 0.4;
