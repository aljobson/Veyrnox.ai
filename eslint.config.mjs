import { FlatCompat } from '@eslint/eslintrc';
const compat = new FlatCompat({ baseDirectory: import.meta.dirname });
export default [
    { ignores: ['node_modules/**', '.next/**', '.open-next/**', '.wrangler/**', 'worker-configuration.d.ts'] },
    { files: ['**/*.js', '**/*.jsx', '**/*.mjs'] },
    ...compat.extends('next/core-web-vitals'),
];
