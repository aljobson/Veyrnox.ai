import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_EDITOR_EXPORT_PREFERENCES, EDITOR_EXPORT_PREFERENCES_KEY, readEditorExportPreferences, writeEditorExportPreferences } from '../app/veyrnox/_lib/editorExportPreferences.mjs';

const memory = initial => {
    const values = new Map(initial ? [[EDITOR_EXPORT_PREFERENCES_KEY, initial]] : []);
    return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), value: () => values.get(EDITOR_EXPORT_PREFERENCES_KEY) };
};

test('web export preferences round-trip only closed-set non-sensitive settings', () => {
    const storage = memory(), value = { height: 2160, frameRate: 60, format: 'mov', quality: 'maximum' };
    assert.equal(writeEditorExportPreferences(storage, value), true);
    assert.deepEqual(readEditorExportPreferences(storage), value);
    assert.deepEqual(Object.keys(JSON.parse(storage.value())).sort(), ['format', 'frameRate', 'height', 'quality']);
});

test('missing, malformed and out-of-range web preferences fail to defaults', () => {
    for (const raw of [undefined, '{', JSON.stringify({ height: 999, frameRate: 60, format: 'mp4', quality: 'maximum' }), JSON.stringify({ ...DEFAULT_EDITOR_EXPORT_PREFERENCES, codec: 'secret' })]) {
        assert.deepEqual(readEditorExportPreferences(memory(raw)), DEFAULT_EDITOR_EXPORT_PREFERENCES);
    }
    assert.equal(writeEditorExportPreferences(memory(), { ...DEFAULT_EDITOR_EXPORT_PREFERENCES, frameRate: 120 }), false);
});
