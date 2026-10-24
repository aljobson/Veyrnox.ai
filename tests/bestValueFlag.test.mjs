import test from 'node:test';
import assert from 'node:assert/strict';
import { toPublicModels } from '../lib/publicCatalog.js';
import { catalogLines } from '../app/veyrnox/_lib/studioSkills.js';
import { modelTag } from '../app/veyrnox/_lib/modelSummaries.js';

const row = (id, provider, endpoint) => ({ id, name: id, modality: 'text-to-video', credits_5s: 5, gated_flag: false, provider, provider_endpoint: endpoint, updated_at: '2026-10-24T10:00:00Z' });

test('a model whose lowest-cost supply serves it is flagged bestValue, and no supplier is returned', () => {
  const [crun, kie] = toPublicModels([row('veo-3.1-lite-kie', 'crun', 'crun:google/veo3-1-lite-t2v'), row('veo-3.1-fast-kie', 'kie', 'veo:veo3_fast')]);
  assert.equal(crun.bestValue, true);
  assert.equal(kie.bestValue, false);
  for (const { id, name, ...rest } of [crun, kie]) assert.doesNotMatch(JSON.stringify(rest), /crun|kie|provider/i);
});

test('the model tag and the assistant list carry it', () => {
  assert.equal(modelTag({ id: 'x', bestValue: true }), 'BEST VALUE');
  assert.equal(modelTag({ id: 'x', bestValue: false }), null);
  const lines = catalogLines([{ id: 'a', kind: 'video', credits: 5, bestValue: true, media: {} }, { id: 'b', kind: 'video', credits: 9, media: {} }]);
  assert.ok(lines[0].endsWith('|best value'));
  assert.ok(!lines[1].includes('best value'));
});
