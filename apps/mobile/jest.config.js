const expo = require('jest-expo/jest-preset');
module.exports = {
    preset: 'jest-expo',
    testMatch: ['<rootDir>/__tests__/**/*.test.ts?(x)'],
    maxWorkers: 2,
    modulePaths: ['<rootDir>/node_modules'],
    // The phone agent shares the pure web document validator and its .mjs dependencies.
    transform: { '\\.mjs$': expo.transform['\\.[jt]sx?$'] },
};
