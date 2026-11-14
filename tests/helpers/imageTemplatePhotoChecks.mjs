import test from 'node:test';
import assert from 'node:assert/strict';
import { ornament, ornamentModel, ornamentCapability, photoKey } from './imageTemplatePhoto.mjs';
import { readGenerationSources, resolveGenerationSources } from '../../lib/generationSources.js';
import { fromFallback } from '../../app/veyrnox/_lib/useCatalog.js';

export function registerPhotoArrivalTests({ harness, generate, prompt, sourcePickers }) {
  test('Create sends the handed photo as an ordinary ornament image reference, including edited text', async () => {
    for (const edited of [false, true]) {
      const photo = new File(['photo'], 'portrait.png', { type: 'image/png' });
      const uploads = [];
      const h = harness({ preset: ornament.id, model: ornament.model }, {
        fetchedPreset: ornament, models: [ornamentModel], handoff: photo,
        handoffTemplateId: ornament.id, upload: async file => { uploads.push(file); return photoKey; },
      });
      try {
        let tree = await h.settle();
        assert.equal(sourcePickers(tree).props.sources.image.file, photo);
        if (edited) {
          prompt(tree).props.onChange({ target: { value: 'My edited ornament prompt' } });
          tree = await h.settle();
        }
        assert.equal(generate(tree).props.disabled, false);
        await generate(tree).props.onClick();
        assert.deepEqual(uploads, [photo]);
        const request = h.requests[0];
        assert.equal(request.model_id, 'nano-banana-pro-edit-grsai');
        assert.equal(request.inputs.prompt, edited ? 'My edited ornament prompt' : ornament.prompt);
        assert.equal(request.inputs.aspect_ratio, '3:4');
        assert.equal('duration_seconds' in request.inputs, false);
        assert.equal('template_id' in request, false);
        assert.equal('preset' in request, false);
        assert.deepEqual(request.references, [{ slot: 'image', origin: 'upload', key: photoKey }]);
        const parsed = readGenerationSources(request);
        assert.equal(parsed.ok, true);
        const resolved = await resolveGenerationSources({ record: ornamentCapability, references: parsed.references }, {
          upload: async (_owner, key) => { assert.equal(key, photoKey); return { ok: true, field: 'image_url', contentType: 'image/png', sizeBytes: 100, url: 'https://signed.test/photo' }; },
        });
        assert.equal(resolved.ok, true);
        assert.deepEqual(resolved.references, request.references);
      } finally { h.close(); }
    }
  });

  test('Create blocks missing, removed, mismatched and unavailable ornament photos without a request', async () => {
    const photo = new File(['photo'], 'portrait.png', { type: 'image/png' });
    for (const extra of [
      {}, { handoff: photo, handoffModelId: 'nano-banana-pro-grsai' },
      { handoff: photo, handoffTemplateId: 'flying-elf' },
      { models: fromFallback() }, { models: [{ ...ornamentModel, media: {} }] },
      { handoff: photo, remove: true },
    ]) {
      const h = harness({ preset: ornament.id, model: ornament.model }, {
        fetchedPreset: ornament, models: [ornamentModel], handoffTemplateId: ornament.id,
        upload: async () => { throw Error('must not upload'); }, ...extra,
      });
      try {
        let tree = await h.settle();
        if (extra.remove) {
          sourcePickers(tree).props.onPick('image', null);
          tree = await h.settle();
        }
        assert.equal(generate(tree).props.disabled, true);
        await generate(tree).props.onClick();
        assert.deepEqual(h.requests, []);
      } finally { h.close(); }
    }
  });
}

export function registerSyntxOverrideArrivalTests({ harness, generate, sourcePickers, templates }) {
  for (const id of ['the-glass', 'a-clear-bottle']) test(`${id}: Generate needs a photo and sends the handed image reference`, async () => {
    const preset = templates.find(p => p.id === id);
    assert.deepEqual(preset.photo, { required: true, count: 1 });
    for (const withPhoto of [false, true]) {
      const photo = new File(['photo'], 'product.png', { type: 'image/png' });
      const h = harness({ preset: id, model: preset.model }, { fetchedPreset: preset, models: [ornamentModel],
        handoff: withPhoto ? photo : undefined, handoffTemplateId: id, upload: async file => {
          assert.equal(file, photo); return photoKey;
        } });
      try {
        const tree = await h.settle();
        assert.equal(generate(tree).props.disabled, !withPhoto);
        if (withPhoto) assert.equal(sourcePickers(tree).props.sources.image.file, photo);
        await generate(tree).props.onClick();
        assert.equal(h.requests.length, withPhoto ? 1 : 0);
        if (withPhoto) {
          const request = h.requests[0];
          assert.equal(request.model_id, preset.model);
          assert.equal(request.inputs.prompt, preset.prompt);
          assert.equal(request.inputs.aspect_ratio, preset.aspect);
          assert.deepEqual(request.references, [{ slot: 'image', origin: 'upload', key: photoKey }]);
          assert.equal(request.template_id, undefined);
        }
      } finally { h.close(); }
    }
  });
}
