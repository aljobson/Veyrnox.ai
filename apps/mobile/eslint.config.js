// Expo's flat config, run by `npm run lint` (expo lint).
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
    expoConfig,
    {
        // Node tooling (mock servers, build scripts) and generated output are not app code.
        ignores: ['dist/*', '.expo/*', 'dev/**', 'scripts/**'],
    },
    {
        // New with eslint-plugin-react-hooks 6 (React Compiler rules). They flag long-standing patterns across the
        // app; kept visible as warnings until each is reworked on purpose, matching the web app's lint config.
        rules: {
            'react-hooks/set-state-in-effect': 'warn',
            'react-hooks/refs': 'warn',
            'react-hooks/globals': 'warn',
            'react-hooks/purity': 'warn',
            'react-hooks/static-components': 'warn',
            // expo-video, expo-audio and similar players are mutated by design (player.currentTime = ...).
            'react-hooks/immutability': 'warn',
            // TypeScript resolves namespace members (e.g. Notifications.AndroidImportance); this rule cannot.
            'import/namespace': 'off',
        },
    },
    {
        // Jest mocks name modules that only exist at test time.
        files: ['__tests__/**', 'tests/**'],
        rules: { 'import/no-unresolved': 'off' },
    },
]);
