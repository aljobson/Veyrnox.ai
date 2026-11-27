import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    SAFE_AREA_GUIDE_IDS,
    SAFE_AREA_GUIDES,
    contentGuideFor,
    safeAreaPercentStyle,
} from '../app/veyrnox/_lib/editorSafeAreas.mjs';

test('short-form guide uses one original grid-derived model across portrait canvases', () => {
    assert.deepEqual(SAFE_AREA_GUIDE_IDS, ['off', 'short-form']);
    assert.equal(SAFE_AREA_GUIDES[1].grid.columns, 20);
    assert.deepEqual(contentGuideFor({ width: 9, height: 16 }), {
        id: 'short-form',
        portrait: true,
        content: { top: 0.1, right: 0.2, bottom: 0.2, left: 0.1 },
        avoidZones: SAFE_AREA_GUIDES[1].avoidZones,
    });
    assert.deepEqual(contentGuideFor({ width: 4, height: 5 })?.content, { top: 0.1, right: 0.2, bottom: 0.2, left: 0.1 });
    assert.deepEqual(safeAreaPercentStyle('short-form', 9, 16), { top: '10%', right: '20%', bottom: '20%', left: '10%' });
});

test('short-form guide is portrait-only, optional and validates dimensions', () => {
    assert.equal(contentGuideFor({ width: 16, height: 9 })?.portrait, false);
    assert.equal(safeAreaPercentStyle('short-form', 16, 9), null);
    assert.equal(contentGuideFor({ width: 9, height: 16, preset: 'off' }), null);
    assert.throws(() => contentGuideFor({ width: 0, height: 16 }), /positive preview dimensions required/);
    assert.throws(() => contentGuideFor({ width: 9, height: Number.NaN }), /positive preview dimensions required/);
});

test('safe-area previews stay presentation-only on web and mobile', () => {
    const workspace = readFileSync(new URL('../app/veyrnox/_components/editor/MultitrackWorkspace.js', import.meta.url), 'utf8');
    const exporter = readFileSync(new URL('../app/veyrnox/_lib/editorExport.mjs', import.meta.url), 'utf8');
    const mobileScreen = readFileSync(new URL('../apps/mobile/src/components/editor/FullEditorScreen.tsx', import.meta.url), 'utf8');
    const mobileExporter = readFileSync(new URL('../apps/mobile/src/components/editor/useServerExport.ts', import.meta.url), 'utf8');
    assert.ok(workspace.indexOf('<SafeAreaOverlay') < workspace.indexOf('<CanvasHandles'));
    assert.match(workspace, /const \[safeAreaGuideId, setSafeAreaGuideId\] = useState\('off'\)/);
    assert.doesNotMatch(exporter, /SafeAreaOverlay|safeAreaGuideId|editorSafeAreas/);
    assert.ok(mobileScreen.indexOf('<PlaybackPreview') < mobileScreen.indexOf('<EditorSafeAreaOverlay'));
    assert.match(mobileScreen, /compositionFrame=\{safeGuideFrame === null\}/);
    assert.match(mobileScreen, /safeGuideSize\.height > safeGuideSize\.width/);
    assert.doesNotMatch(mobileExporter, /EditorSafeAreaOverlay|safeAreaGuideId|editorSafeArea/);
});
