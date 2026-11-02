import test from 'node:test';
import assert from 'node:assert/strict';
import { nearestShape, templateSourceAspect } from '../lib/templateFraming.js';
import { templateDetail } from '../lib/clientTemplates.js';
import { toPublicPresets } from '../lib/publicPresets.js';
import { MODELS, modelIdForName } from '../app/veyrnox/_lib/tokens.js';
import { PRESETS } from '../app/veyrnox/_lib/templates.js';

test('a preview shape maps to the nearest of 1:1, 9:16 and 16:9', () => {
    assert.equal(nearestShape('600 / 1066'), '9:16');
    assert.equal(nearestShape('406 / 720'), '9:16');
    assert.equal(nearestShape('600 / 338'), '16:9');
    assert.equal(nearestShape('1:1'), '1:1');
    assert.equal(nearestShape('1000 / 980'), '1:1');
    for (const bad of [null, undefined, '', 'wide', '0 / 5', '5 / 0', 42]) assert.equal(nearestShape(bad), null, String(bad));
});

test('a template keeps its own sourceAspect, and a start-image model falls back to the preview shape', () => {
    assert.equal(templateSourceAspect({ model: 'Kling 3.0 · I2V', sourceAspect: '1:1', previewAspect: '9 / 16' }), '1:1');
    assert.equal(templateSourceAspect({ model: 'Kling 3.0 · I2V', previewAspect: '9 / 16' }), '9:16');
    assert.equal(templateSourceAspect({ model: 'Kling 3.0 · I2V' }), null);
    assert.equal(templateSourceAspect(null), null);
});

test('models that choose their own aspect or take many pictures get no fallback hint', () => {
    for (const name of ['Seedance 2.0 Fast', 'Seedance 2.0 · Reference']) {
        assert.equal(templateSourceAspect({ model: name, previewAspect: '9 / 16' }), null, name);
    }
    assert.ok(MODELS.find((m) => m.id === 'seedance-2.0-fast').aspects, 'fixture assumption: Fast has its own aspect option');
});

test('a Kling 3.0 I2V template with no recorded hint carries one on the web detail and in the public list', () => {
    const catalog = MODELS.map((m) => ({ id: m.id, name: m.name, modality: m.kind, credits: m.credits + 1, gated: !!m.gated }));
    const publicList = toPublicPresets(catalog);
    const before = PRESETS.find((p) => modelIdForName(p.model) === 'kling-3.0-i2v' && !p.sourceAspect && p.previewAspect);
    assert.ok(before, 'fixture: at least one Kling I2V template records no sourceAspect of its own');
    const detail = templateDetail(before.id);
    assert.match(detail.sourceAspect, /^(?:1:1|9:16|16:9)$/);
    assert.equal(publicList.find((p) => p.id === before.id).sourceAspect, detail.sourceAspect);
});

test('every Kling 3.0 I2V template with a readable preview now has a hint that agrees with its preview orientation', () => {
    const catalog = MODELS.map((m) => ({ id: m.id, name: m.name, modality: m.kind, credits: m.credits + 1, gated: !!m.gated }));
    const kling = toPublicPresets(catalog).filter((p) => p.modelId === 'kling-3.0-i2v');
    assert.ok(kling.length > 100);
    for (const p of kling) {
        assert.match(p.sourceAspect ?? '', /^(?:1:1|9:16|16:9)$/, p.id);
        const [w, h] = p.previewAspect.split('/').map(Number);
        if (p.sourceAspect === '16:9') assert.ok(w > h, p.id);
        if (p.sourceAspect === '9:16') assert.ok(w < h, p.id);
    }
});

test('the public template page and the Create card both read the derived hint, not the raw field', async () => {
    const { readFileSync } = await import('node:fs');
    const page = readFileSync(new URL('../app/veyrnox/presets/[id]/page.js', import.meta.url), 'utf8');
    assert.match(page, /templateSourceAspect\(template/);
    assert.doesNotMatch(page, /template\.sourceAspect/);
});
