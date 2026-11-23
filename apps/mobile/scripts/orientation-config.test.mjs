import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { PHONE_ORIENTATIONS } from './sync-generated-ios-plist.mjs';

const app = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8'));
const require = createRequire(import.meta.url);
const { IOSConfig, compileModsAsync, withPlugins } = require('expo/config-plugins');
const IPAD_ORIENTATIONS = Object.freeze([
    'UIInterfaceOrientationPortrait',
    'UIInterfaceOrientationPortraitUpsideDown',
    'UIInterfaceOrientationLandscapeLeft',
    'UIInterfaceOrientationLandscapeRight',
]);

test('source config enables both phone layouts with the exact iOS mask used by generated builds', () => {
    assert.equal(app.expo.orientation, 'default');
    assert.deepEqual(app.expo.ios.infoPlist.UISupportedInterfaceOrientations, PHONE_ORIENTATIONS);
    assert.equal(PHONE_ORIENTATIONS.includes('UIInterfaceOrientationPortraitUpsideDown'), false);
});

test('Expo prebuild introspection preserves the explicit three-mask iPhone orientation contract', async () => {
    let configured = IOSConfig.Orientation.withOrientation(structuredClone(app.expo));
    configured = IOSConfig.RequiresFullScreen.withRequiresFullScreen(configured);
    const evaluated = await compileModsAsync(configured, {
        projectRoot: fileURLToPath(new URL('..', import.meta.url)),
        platforms: ['ios'],
        introspect: true,
    });
    assert.deepEqual(evaluated._internal.modResults.ios.infoPlist.UISupportedInterfaceOrientations, PHONE_ORIENTATIONS);
    assert.deepEqual(evaluated._internal.modResults.ios.infoPlist['UISupportedInterfaceOrientations~ipad'], IPAD_ORIENTATIONS);
});

test('the fresh-install CI path evaluates every configured plugin before asserting final orientation masks', async (context) => {
    const projectRoot = fileURLToPath(new URL('..', import.meta.url));
    let configured = structuredClone(app.expo);
    configured._internal = { projectRoot };
    try {
        configured = withPlugins(configured, configured.plugins);
    } catch (error) {
        if (process.env.CI) throw error;
        context.skip(`this source-only checkout cannot resolve its fresh-lock plugins: ${error instanceof Error ? error.message : String(error)}`);
        return;
    }
    configured = IOSConfig.Orientation.withOrientation(configured);
    configured = IOSConfig.RequiresFullScreen.withRequiresFullScreen(configured);
    const evaluated = await compileModsAsync(configured, { projectRoot, platforms: ['ios'], introspect: true });
    const plist = evaluated._internal.modResults.ios.infoPlist;
    assert.deepEqual(plist.UISupportedInterfaceOrientations, PHONE_ORIENTATIONS);
    assert.deepEqual(plist['UISupportedInterfaceOrientations~ipad'], IPAD_ORIENTATIONS);
});
