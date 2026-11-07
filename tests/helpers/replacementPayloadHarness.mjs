// Offline integration: real UseTemplate, TemplateGenerate, generation hook,
// request/source helpers and provider builders. Only external services and
// initial React state are fixtures; no provider submission or network is used.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as React from 'react';
import { fixture } from './publicSiteRender.mjs';
import { templateById } from '../../app/veyrnox/_lib/templates.js';
import { MODELS, modelIdForName } from '../../app/veyrnox/_lib/tokens.js';
import { FALLBACK_MODEL_ENDPOINTS } from '../../lib/fallbackModelCapabilities.js';
import { capabilityFor, declaredInputs, checkInputs, checkSource, shapePayload } from '../../lib/modelCapabilities.js';
import { readGenerationSources, resolveGenerationSources } from '../../lib/generationSources.js';
import { buildRequest, parseEndpoint } from '../../packages/adapters/crun.js';

export const PHOTO_URL = 'https://fixtures.invalid/replacement-photo.jpg';
export const PHOTO_KEY = 'fixture/replacement-photo.jpg';
// A repository-owned JPEG is a transport stand-in, not identity/visual proof.
export const PHOTO = new File([readFileSync(new URL('../../public/showcase/creator-on-the-wave.jpg', import.meta.url))], 'replacement-photo.jpg', { type: 'image/jpeg' });

export function pageHarness(id, { photo = null, rightsConfirmed = true } = {}) {
  const preset = templateById(id);
  assert.ok(preset, id + ': no public template');
  const model = MODELS.find(m => m.id === modelIdForName(preset.model));
  assert.ok(model, id + ': no model');
  const requests = [], uploads = [], jobs = [];
  let hook, props, render;
  const moduleMocks = {
    '../_lib/useCatalog': { useCatalog: () => ({ models: MODELS, live: false }) },
    './gateway': {
      gatewayFetch: async (path, init) => {
        assert.equal(path, '/generations');
        requests.push(JSON.parse(init.body));
        return { job_id: 'offline-fixture-job' };
      },
      makeIdempotencyKey: () => 'offline-fixture-key', notifyBalanceChanged() {},
      GatewayError: class GatewayError extends Error {}, ACCOUNT_PAUSED_COPY: '', ACCOUNT_ON_HOLD_COPY: '',
    },
    './jobHistory': { pushJobHistory() {} },
    './useStudioJobs': { useStudioJobs: () => ({ jobs: [], generating: false, startJobs: job => jobs.push(job), clearJobs() {} }) },
    './useFreeAllowance': { useFreeAllowance: () => ({}) },
    './uploadSourceFile': { uploadSourceFile: async file => { uploads.push(file); return PHOTO_KEY; } },
    // Capture the real component's hook result, without replacing its logic.
    '../_lib/useTemplateGenerate': { useTemplateGenerate: value => {
      props = value;
      hook = render.load('app/veyrnox/_lib/useTemplateGenerate.js').useTemplateGenerate(value);
      return hook;
    } },
  };
  render = fixture('en', '/presets/' + id, { moduleMocks, states: {
    'app/veyrnox/_components/UseTemplate.js': [model.id, preset.aspect, preset.durationSeconds, 60, '', false, photo, false, rightsConfirmed],
    'app/veyrnox/_lib/useTemplateGenerate.js': [10000, null, false, null],
  } });
  const html = render.render(React.createElement(render.load('app/veyrnox/_components/UseTemplate.js').UseTemplate, { preset }));
  assert.ok(props && hook, id + ': Generate must be exposed');
  const prepare = withPhoto => render.load('app/veyrnox/_lib/templateGenerate.js').templateInputs(preset, model, { ...props, withPhoto });
  return { preset, model, html, props, hook, requests, uploads, jobs, prepare };
}

export async function providerPayload(modelId, inputs, references) {
  const endpoint = FALLBACK_MODEL_ENDPOINTS[modelId], record = capabilityFor(endpoint);
  assert.ok(record, 'capability exists');
  const parsed = readGenerationSources({ references });
  assert.equal(parsed.ok, true);
  const lookedUp = [];
  const resolved = await resolveGenerationSources({ authId: 'fixture-owner', references: parsed.references, record }, {
    upload: async (owner, key) => {
      assert.equal(owner, 'fixture-owner');
      assert.equal(key, PHOTO_KEY);
      lookedUp.push(key);
      return { ok: true, url: PHOTO_URL, field: 'image_url', contentType: PHOTO.type, sizeBytes: PHOTO.size };
    },
    asset: async () => { throw new Error('No library asset expected'); },
  });
  if (!resolved.ok) return { resolved, lookedUp };
  const declared = declaredInputs(record, { ...inputs, ...resolved.inputs });
  assert.deepEqual(checkSource(record, resolved.sources), { ok: true });
  const checked = checkInputs(record, declared);
  if (!checked.ok) return { resolved, declared, checked, lookedUp };
  // Same builder split as packages/provider-sdk/registry.js: fal shapes its
  // body with shapePayload; Crun uses its adapter's buildRequest.
  let body;
  if (record.provider === 'fal') body = shapePayload(record, declared, resolved.sources);
  else {
    assert.equal(record.provider, 'crun');
    const built = buildRequest(parseEndpoint(endpoint), declared);
    assert.equal(built.ok, true);
    body = built.body;
  }
  return { endpoint, resolved, declared, checked, lookedUp, body, payload: record.provider === 'fal' ? body : body.input };
}
