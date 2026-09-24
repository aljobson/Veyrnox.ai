/** @type {import('tailwindcss').Config} */
module.exports = {
    // Only directories that exist. src/ and the design-agent package went with
    // ADR-0015; globs for missing paths cost a filesystem walk on every build
    // and quietly suggest code lives somewhere it does not.
    content: [
        "./index.html",
        "./app/**/*.{js,ts,jsx,tsx}",
        "./components/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                primary: {
                    DEFAULT: '#22d3ee',
                    hover: '#06b6d4',
                },
                'app-bg': '#050505',
                'panel-bg': '#0a0a0a',
                'card-bg': '#141414',
                secondary: '#a1a1aa',
                muted: '#52525b',
                // Theme tokens. The literal values live in app/globals.css as
                // space-separated RGB channels so a `data-theme` swap on <html>
                // repaints the whole site (dark default, light opt-in) without
                // touching a single class name. The `<alpha-value>` placeholder
                // keeps every existing `/opacity` modifier working.
                vx: {
                    base: 'rgb(var(--vx-base) / <alpha-value>)',
                    panel: 'rgb(var(--vx-panel) / <alpha-value>)',
                    border: 'rgb(var(--vx-border) / <alpha-value>)',
                    fg: 'rgb(var(--vx-fg) / <alpha-value>)',
                    'fg-body': 'rgb(var(--vx-fg-body) / <alpha-value>)',
                    'fg-muted': 'rgb(var(--vx-fg-muted) / <alpha-value>)',
                    // Dark 4.82:1 on vx-panel, 5.19:1 on vx-base — WCAG AA for
                    // body text. #5A5A61 sat at 2.69:1 and failed the audit on
                    // every surface. The light values are pinned to the same bar.
                    'fg-faint': 'rgb(var(--vx-fg-faint) / <alpha-value>)',
                    accent: 'rgb(var(--vx-accent) / <alpha-value>)',
                    'accent-hover': 'rgb(var(--vx-accent-hover) / <alpha-value>)',
                    'accent-ink': 'rgb(var(--vx-accent-ink) / <alpha-value>)',
                    money: 'rgb(var(--vx-money) / <alpha-value>)',
                    'money-ink': 'rgb(var(--vx-money-ink) / <alpha-value>)',
                    danger: 'rgb(var(--vx-danger) / <alpha-value>)',
                },
            },
            fontFamily: {
                sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
                vx: ['var(--font-archivo)', 'system-ui', 'sans-serif'],
                'vx-mono': ['var(--font-jetbrains)', 'ui-monospace', 'monospace'],
            },
            borderRadius: {
                'xl': '1rem',
                '2xl': '1.5rem',
                '3xl': '2rem',
            },
            boxShadow: {
                'glow': '0 0 20px rgba(34, 211, 238, 0.4)',
                'glow-accent': '0 0 20px rgba(168, 85, 247, 0.4)',
                '3xl': '0 35px 60px -15px rgba(0, 0, 0, 0.8)',
            }
        },
    },
    plugins: [],
}
