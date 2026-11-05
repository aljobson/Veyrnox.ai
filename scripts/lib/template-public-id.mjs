// Offline collision checks include retained evidence and independent landing keys.
import assert from 'node:assert/strict';
import { publicTemplateId } from '../../app/veyrnox/_lib/templateIds.js';
import { SOURCE_TEMPLATES } from '../../app/veyrnox/_lib/sourceTemplates.js';
import { EFFECT_CONCEPT_TEMPLATES } from '../../app/veyrnox/_lib/effectConceptTemplates.js';
import { REFERENCE_TEMPLATES } from '../../app/veyrnox/_lib/referenceTemplates.js';
import { SOURCE_PROMPT_RECORDS } from '../../app/veyrnox/_lib/sourcePromptRecords.js';
import { AUDIT_SHOWCASE_CLIPS, MODEL_SHOWCASE_KEYS } from '../../app/veyrnox/_lib/showcase.js';
import { SEEDANCE_200_TEMPLATE_METADATA } from '../../app/veyrnox/_lib/seedanceTemplateMetadata.js';
import { FEATURE_CARDS } from '../../app/veyrnox/_lib/tokens.js';

export function assertAvailablePublicIds(ids, ownIds) {
  const owned = new Set(ownIds);
  const occupied = new Set([
    ...[...SOURCE_TEMPLATES.filter(t => !owned.has(t.id)), ...EFFECT_CONCEPT_TEMPLATES, ...REFERENCE_TEMPLATES].flatMap(t => [t.id, t.clipKey]),
    ...Object.keys(SOURCE_PROMPT_RECORDS).filter(id => !owned.has(id)),
    ...Object.keys(AUDIT_SHOWCASE_CLIPS).filter(id => !owned.has(id)),
    ...Object.keys(SEEDANCE_200_TEMPLATE_METADATA),
    ...FEATURE_CARDS.map(card => card.key), ...Object.values(MODEL_SHOWCASE_KEYS),
  ].filter(Boolean).flatMap(key => [key, publicTemplateId(key)]));
  assert.equal(new Set(ids).size, ids.length, 'public ids must be unique within the import');
  for (const id of ids) {
    assert.match(id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(id.length <= 40, id + ': public detail id limit');
    assert.equal(occupied.has(id), false, id + ': collision with another catalog or placement');
  }
}
