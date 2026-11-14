const LEGACY_FLAGS = Object.freeze({
  ui: 'MUSIC_UI_ENABLED',
  schema: 'MUSIC_SCHEMA_ENABLED',
  library: 'MUSIC_LIBRARY_ENABLED',
  references: 'MUSIC_REFERENCES_ENABLED',
  generation: 'MUSIC_GENERATION_ENABLED',
  sources: 'MUSIC_SOURCES_ENABLED',
  distribution: 'MUSIC_DISTRIBUTION_ENABLED',
  publication: 'MUSIC_PUBLICATION_ENABLED',
  editing: 'MUSIC_EDITING_ENABLED',
  playlists: 'MUSIC_PLAYLISTS_ENABLED',
  studio: 'MUSIC_STUDIO_ENABLED',
  reuse: 'MUSIC_REUSE_ENABLED',
  collaboration: 'MUSIC_COLLABORATION_ENABLED',
  cover: 'MUSIC_COVER_ENABLED',
  stems: 'MUSIC_STEMS_ENABLED',
  targetStems: 'MUSIC_TARGET_STEMS_ENABLED',
  trackAdd: 'MUSIC_TRACK_ADD_ENABLED',
  extend: 'MUSIC_EXTEND_ENABLED',
  replace: 'MUSIC_REPLACE_ENABLED',
  addSection: 'MUSIC_ADD_SECTION_ENABLED',
  reactions: 'MUSIC_REACTIONS_ENABLED',
  follows: 'MUSIC_FOLLOWS_ENABLED',
});

function runtimeFlags(env) {
  try {
    const parsed = JSON.parse(env?.MUSIC_RUNTIME_FLAGS || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** One production binding carries Music's rollout switches; explicit legacy flags remain valid overrides. */
export function musicRuntimeFlag(name, env = process.env) {
  const legacy = LEGACY_FLAGS[name];
  if (!legacy) return false;
  if (env?.[legacy] !== undefined) return env[legacy] === 'true';
  const value = runtimeFlags(env)[name];
  return value === true || value === 'true';
}

/** Music's pair queue may enable the already-migrated fal recovery schema without enabling generic durable admission. */
export function musicDispatchSchemaEnabled(env = process.env) {
  if (env?.FAL_DISPATCH_SCHEMA_ENABLED !== undefined) return env.FAL_DISPATCH_SCHEMA_ENABLED === 'true';
  const value = runtimeFlags(env).dispatch;
  return value === true || value === 'true';
}
