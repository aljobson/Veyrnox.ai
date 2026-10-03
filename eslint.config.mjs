import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';

// eslint-config-next 16 ships a flat config; the FlatCompat shim it used to
// need cannot load it.
export default [
    { ignores: ['node_modules/**', '.next/**', '.open-next/**', '.wrangler/**', 'worker-configuration.d.ts'] },
    { files: ['**/*.js', '**/*.jsx', '**/*.mjs'] },
    ...nextCoreWebVitals,
    {
        // New with eslint-plugin-react-hooks 6 (React Compiler rules). They flag
        // 78 existing places; warnings until those are worked through.
        rules: {
            'react-hooks/set-state-in-effect': 'warn',
            'react-hooks/refs': 'warn',
            'react-hooks/static-components': 'warn',
            'react-hooks/purity': 'warn',
        },
    },
    {
        // Every <img> here shows a presigned R2 object (15-minute URL), a blob:
        // preview of a file the user just picked, or a social network's avatar.
        // next/image would route them through /_next/image, which this Worker
        // does not serve, and would cache a URL that is meant to expire.
        rules: { '@next/next/no-img-element': 'off' },
    },
];
