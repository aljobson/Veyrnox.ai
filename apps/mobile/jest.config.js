const expo = require('jest-expo/jest-preset');
module.exports = {
    preset: 'jest-expo',
    testMatch: ['<rootDir>/__tests__/**/*.test.ts?(x)'],
    maxWorkers: 2,
    modulePaths: ['<rootDir>/node_modules'],
    moduleNameMapper: {
        '^react-native-audio-worklets$': '<rootDir>/__tests__/helpers/mockAudioWorklets.ts',
        '^expo-widgets$': '<rootDir>/__tests__/helpers/mockExpoWidgets.ts',
    },
    // The phone agent shares the pure web document validator and its .mjs dependencies.
    transform: { '\\.mjs$': expo.transform['\\.[jt]sx?$'] },
};
