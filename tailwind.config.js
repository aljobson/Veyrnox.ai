/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
        "./app/**/*.{js,ts,jsx,tsx}",
        "./components/**/*.{js,ts,jsx,tsx}",
        "./packages/studio/src/**/*.{js,jsx}",
        "./packages/Open-AI-Design-Agent/packages/design-agent/src/**/*.{js,jsx}",
        "./packages/Open-Poe-AI/packages/agents/src/**/*.{js,jsx,ts,tsx}",
        "./packages/Vibe-Workflow/packages/workflow-builder/src/**/*.{js,jsx,ts,tsx}",
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
                vx: {
                    base: '#0A0A0B',
                    panel: '#141416',
                    border: '#26262A',
                    fg: '#F2F2F3',
                    'fg-body': '#C9C9CF',
                    'fg-muted': '#9A9AA3',
                    'fg-faint': '#5A5A61',
                    accent: '#3EE6C4',
                    'accent-hover': '#6FF2D8',
                    'accent-ink': '#06231F',
                    money: '#E4A93C',
                    'money-ink': '#231703',
                    danger: '#FF5C47',
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
