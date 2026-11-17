// Offline provenance only; never import the source metadata into a Worker route.
import { SEEDANCE_200_TEMPLATE_METADATA } from '../../app/veyrnox/_lib/seedanceTemplateMetadata.js';
import { recordLookup } from '../../app/veyrnox/_lib/templateIds.js';
export const seedanceOrigin = recordLookup(SEEDANCE_200_TEMPLATE_METADATA);
export function clipOrigin(id, records = []) {
  const origins = [seedanceOrigin(id)?.sourcePlatform, ...records.flatMap(r =>
    [seedanceOrigin(r.id)?.sourcePlatform, r.sourcePlatform, r.origin])]
    .filter(Boolean).map(s => s.toLowerCase());
  return origins.includes('syntx') ? 'syntx' : origins[0] || null;
}
