import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MUSIC_POLICY_VERSION,
  MUSIC_LYRICS_MAX,
  MUSIC_STYLES_MAX,
  MUSIC_TITLE_MAX,
  MUSIC_MOVE_MAX,
  MUSIC_WORKSPACE_NAME_MAX,
  musicEntitlementProjection,
  musicGenerationEnabled,
  musicCoverEnabled,
  musicStemsEnabled,
  musicDistributionEnabled,
  musicSourcesEnabled,
  musicLibraryEnabled,
  musicPromptPolicy,
  musicRpcStatus,
  musicSchemaEnabled,
  musicUiEnabled,
  parseMusicGeneration,
  parseMusicCustomDraft,
  parseMusicExportQuote,
  parseMusicExportStart,
  parseMusicShareLinkCreate,
  parseMusicShareLinkRevoke,
  parseMusicSongMove,
  parseMusicWorkspaceCreate,
  parseMusicQuote,
  publicMusicError,
} from '../lib/musicBackend.js';

test('music generation needs all server-side rollout gates', () => {
  const ready = {
    MUSIC_SCHEMA_ENABLED: 'true',
    MUSIC_GENERATION_ENABLED: 'true',
    FAL_DISPATCH_SCHEMA_ENABLED: 'true',
  };
  assert.equal(musicSchemaEnabled(ready), true);
  assert.equal(musicGenerationEnabled(ready), true);
  for (const key of Object.keys(ready)) {
    assert.equal(musicGenerationEnabled({ ...ready, [key]: 'false' }), false, key);
  }
  const coverReady = { ...ready, MUSIC_LIBRARY_ENABLED: 'true', MUSIC_COVER_ENABLED: 'true' };
  assert.equal(musicCoverEnabled(coverReady), true);
  assert.equal(musicCoverEnabled({ ...coverReady, MUSIC_COVER_ENABLED: 'false' }), false);
  assert.equal(musicStemsEnabled({ ...coverReady, MUSIC_STEMS_ENABLED: 'true' }), true);
  assert.equal(musicStemsEnabled({ ...coverReady, MUSIC_STEMS_ENABLED: 'false' }), false);
  assert.equal(musicUiEnabled({ MUSIC_UI_ENABLED: 'true' }), true);
  assert.equal(musicUiEnabled({ MUSIC_UI_ENABLED: 'false' }), false);
  assert.equal(musicLibraryEnabled({ MUSIC_SCHEMA_ENABLED: 'true', MUSIC_LIBRARY_ENABLED: 'true' }), true);
  assert.equal(musicLibraryEnabled({ MUSIC_SCHEMA_ENABLED: 'false', MUSIC_LIBRARY_ENABLED: 'true' }), false);
  assert.equal(musicDistributionEnabled({ MUSIC_SCHEMA_ENABLED: 'true', MUSIC_LIBRARY_ENABLED: 'true', MUSIC_DISTRIBUTION_ENABLED: 'true' }), true);
  assert.equal(musicDistributionEnabled({ MUSIC_SCHEMA_ENABLED: 'true', MUSIC_LIBRARY_ENABLED: 'false', MUSIC_DISTRIBUTION_ENABLED: 'true' }), false);
  assert.equal(musicSourcesEnabled({ MUSIC_SCHEMA_ENABLED: 'true', MUSIC_LIBRARY_ENABLED: 'true', MUSIC_SOURCES_ENABLED: 'true' }), true);
  assert.equal(musicSourcesEnabled({ MUSIC_SCHEMA_ENABLED: 'true', MUSIC_LIBRARY_ENABLED: 'true', MUSIC_SOURCES_ENABLED: 'false' }), false);
});

test('one Music runtime binding opens the production-safe surface and legacy flags can still stop it', () => {
  const flags = {
    ui: true, schema: true, library: true, generation: true, dispatch: true,
    sources: true, distribution: true, publication: true, editing: true,
    playlists: true, studio: true, reuse: true, collaboration: true,
  };
  const env = { MUSIC_RUNTIME_FLAGS: JSON.stringify(flags) };
  assert.equal(musicUiEnabled(env), true);
  assert.equal(musicSchemaEnabled(env), true);
  assert.equal(musicLibraryEnabled(env), true);
  assert.equal(musicGenerationEnabled(env), true);
  assert.equal(musicSourcesEnabled(env), true);
  assert.equal(musicDistributionEnabled(env), true);
  assert.equal(musicGenerationEnabled({ ...env, MUSIC_GENERATION_ENABLED: 'false' }), false);
  assert.equal(musicGenerationEnabled({ MUSIC_RUNTIME_FLAGS: '{invalid' }), false);
});

test('music entitlements expose verified pair models and fail closed on paid access', () => {
  const result = musicEntitlementProjection({
    models: [
      { id: 'ace-step', name: 'ACE-Step', modality: 'text-to-audio', credits: 5, gated: false, capabilities: { inputs: { prompt: { type: 'string' }, seed: { type: 'number' } } } },
      { id: 'ace-step-1.5', name: 'ACE-Step 1.5', modality: 'text-to-audio', credits: 3, gated: false, capabilities: { inputs: { prompt: { type: 'string' } } } },
      { id: 'gated-audio', name: 'Hidden', modality: 'text-to-audio', credits: 9, gated: true },
      { id: 'image', name: 'Wrong modality', modality: 'text-to-image', credits: 3, gated: false },
    ],
    credits: { balance: 23, free_credits: 4, free_expires_at: '2026-11-11T00:00:00Z' },
    generationEnabled: false,
    subscription: { status: 'active', current_period_end: '2026-11-09T00:00:00Z' },
    now: Date.parse('2026-11-10T00:00:00Z'),
  });
  assert.deepEqual(result.models, [{
    id: 'ace-step',
    name: 'ACE-Step',
    credits_per_candidate: 5,
    total_credits: 10,
    instrumental_only: true,
    generation_modes: ['simple'],
    controls: {
      description: true,
      seed: true,
      variety: false,
      style_influence: false,
      exclude_styles: false,
      duration_seconds: { min: 10, max: 60, default: 60 },
      lyrics: false,
      styles: false,
      instrumental: 'required',
    },
    requires_paid_plan: false,
    available: true,
  }, {
    id: 'ace-step-1.5',
    name: 'ACE-Step 1.5',
    credits_per_candidate: 3,
    total_credits: 6,
    instrumental_only: false,
    generation_modes: ['simple', 'custom'],
    controls: {
      description: true,
      seed: false,
      variety: true,
      style_influence: true,
      exclude_styles: true,
      duration_seconds: { min: 10, max: 60, default: 60 },
      lyrics: true,
      styles: true,
      instrumental: 'optional',
    },
    requires_paid_plan: true,
    available: false,
  }]);
  assert.equal(result.available, false);
  assert.equal(result.output_count, 2);
  assert.equal(result.concurrency_limit, 4);
  assert.equal(result.balance, 23);
  assert.equal(result.free_credits, 4);
  assert.equal(result.policy.version, MUSIC_POLICY_VERSION);
  assert.deepEqual(result.custom_drafts, {
    available: true,
    autosave: true,
    generation_supported: false,
    lyrics_max: MUSIC_LYRICS_MAX,
    styles_max: MUSIC_STYLES_MAX,
    title_max: 80,
  });

  const paid = musicEntitlementProjection({
    models: [{ id: 'ace-step-1.5', name: 'ACE-Step 1.5', modality: 'text-to-audio', credits: 3, gated: false }],
    credits: { balance: 7 },
    generationEnabled: true,
    subscription: { status: 'active', current_period_end: '2026-12-01T00:00:00Z' },
    now: Date.parse('2026-11-10T00:00:00Z'),
  });
  assert.equal(paid.models[0].available, true);
  assert.equal(paid.available, true);
  assert.equal(paid.custom_drafts.generation_supported, true);
});

test('custom lyric drafts preserve formatting and reject stale or oversized shapes', () => {
  assert.deepEqual(parseMusicCustomDraft({
    revision: 3,
    model_id: 'ace-step',
    lyrics: '[Verse]\nCafé lights ✨\n',
    styles: 'Warm piano, 84 bpm',
    title: 'Harbour Frame',
  }), {
    ok: true,
    revision: 3,
    modelId: 'ace-step',
    lyrics: '[Verse]\nCafé lights ✨\n',
    styles: 'Warm piano, 84 bpm',
    title: 'Harbour Frame',
  });
  assert.equal(parseMusicCustomDraft({ revision: -1, model_id: 'ace-step', lyrics: '', styles: '', title: '' }).error, 'revision_invalid');
  assert.equal(parseMusicCustomDraft({ revision: 0, model_id: 'ace-step', lyrics: 'x'.repeat(MUSIC_LYRICS_MAX + 1), styles: '', title: '' }).error, 'lyrics_invalid');
  assert.equal(parseMusicCustomDraft({ revision: 0, model_id: 'ace-step', lyrics: '', styles: 'x'.repeat(MUSIC_STYLES_MAX + 1), title: '' }).error, 'styles_invalid');
  assert.equal(parseMusicCustomDraft({ revision: 0, model_id: 'ace-step', lyrics: '', styles: '', title: '', admin: true }).error, 'invalid_request');
});

test('custom draft boundary rejects type confusion and accepts exact limits as inert text', () => {
  const boundary = {
    revision: Number.MAX_SAFE_INTEGER,
    model_id: 'catalog.model_v1-safe',
    lyrics: '<script>not executable</script>\n' + 'x'.repeat(MUSIC_LYRICS_MAX - 32),
    styles: 's'.repeat(MUSIC_STYLES_MAX),
    title: 't'.repeat(MUSIC_TITLE_MAX),
  };
  assert.equal(boundary.lyrics.length, MUSIC_LYRICS_MAX);
  assert.deepEqual(parseMusicCustomDraft(boundary), {
    ok: true,
    revision: boundary.revision,
    modelId: boundary.model_id,
    lyrics: boundary.lyrics,
    styles: boundary.styles,
    title: boundary.title,
  });
  for (const revision of [1.5, Number.MAX_SAFE_INTEGER + 1, NaN, '0', null]) {
    assert.equal(parseMusicCustomDraft({ ...boundary, revision }).error, 'revision_invalid');
  }
  for (const model_id of ['', 'bad/model', 'bad model', 'x'.repeat(101), 42]) {
    assert.equal(parseMusicCustomDraft({ ...boundary, model_id }).error, 'model_invalid');
  }
  assert.equal(parseMusicCustomDraft({ ...boundary, lyrics: null }).error, 'lyrics_invalid');
  assert.equal(parseMusicCustomDraft({ ...boundary, styles: [] }).error, 'styles_invalid');
  assert.equal(parseMusicCustomDraft({ ...boundary, title: {} }).error, 'title_invalid');
  assert.equal(parseMusicCustomDraft([]).error, 'invalid_request');
  assert.equal(parseMusicCustomDraft(null).error, 'invalid_request');
});

test('workspace creation and atomic move parsers reject ambiguous ownership shapes', () => {
  const workspaceId = 'a5ed2d0d-8276-4fbb-9c4f-39f401a3158b';
  const songA = 'b6ed2d0d-8276-4fbb-9c4f-39f401a3158c';
  const songB = 'c7ed2d0d-8276-4fbb-9c4f-39f401a3158d';
  assert.deepEqual(parseMusicWorkspaceCreate({
    name: `  ${'W'.repeat(MUSIC_WORKSPACE_NAME_MAX)}  `,
    idempotency_key: 'workspace.123456',
  }), { ok: true, name: 'W'.repeat(MUSIC_WORKSPACE_NAME_MAX), idempotencyKey: 'workspace.123456' });
  assert.equal(parseMusicWorkspaceCreate({ name: '', idempotency_key: 'workspace.123456' }).error, 'name_invalid');
  assert.equal(parseMusicWorkspaceCreate({ name: 'x'.repeat(MUSIC_WORKSPACE_NAME_MAX + 1), idempotency_key: 'workspace.123456' }).error, 'name_invalid');
  assert.equal(parseMusicWorkspaceCreate({ name: 'Studio', idempotency_key: 'short' }).error, 'idempotency_key_invalid');
  assert.equal(parseMusicWorkspaceCreate({ name: 'Studio', idempotency_key: 'workspace.123456', user_id: workspaceId }).error, 'invalid_request');

  assert.deepEqual(parseMusicSongMove({
    destination_workspace_id: workspaceId,
    idempotency_key: 'move.12345678', // gitleaks:allow -- synthetic idempotency fixture
    songs: [{ id: songA, revision: 0 }, { id: songB, revision: 3 }],
  }), {
    ok: true,
    destinationWorkspaceId: workspaceId,
    idempotencyKey: 'move.12345678', // gitleaks:allow -- synthetic idempotency fixture
    songs: [{ id: songA, revision: 0 }, { id: songB, revision: 3 }],
  });
  const moveBase = { destination_workspace_id: workspaceId, idempotency_key: 'move.12345678' }; // gitleaks:allow -- synthetic idempotency fixture
  assert.equal(parseMusicSongMove({ ...moveBase, songs: [] }).error, 'songs_invalid');
  assert.equal(parseMusicSongMove({ ...moveBase, songs: [{ id: songA, revision: 0 }, { id: songA, revision: 0 }] }).error, 'songs_invalid');
  assert.equal(parseMusicSongMove({ ...moveBase, songs: [{ id: songA, revision: -1 }] }).error, 'songs_invalid');
  assert.equal(parseMusicSongMove({ ...moveBase, songs: [{ id: songA, revision: 2_147_483_648 }] }).error, 'songs_invalid');
  const exactMoveLimit = Array.from({ length: MUSIC_MOVE_MAX }, (_, index) => ({
    id: `${index.toString(16).padStart(8, '0')}-8276-4fbb-9c4f-39f401a3158c`,
    revision: 2_147_483_647,
  }));
  assert.equal(parseMusicSongMove({ ...moveBase, songs: exactMoveLimit }).ok, true);
  assert.equal(parseMusicSongMove({ ...moveBase, songs: Array.from({ length: MUSIC_MOVE_MAX + 1 }, (_, index) => ({ id: `${String(index).padStart(8, '0')}-8276-4fbb-9c4f-39f401a3158c`, revision: 0 })) }).error, 'songs_invalid');
  assert.equal(parseMusicSongMove({ ...moveBase, destination_workspace_id: 'not-a-workspace', songs: [{ id: songA, revision: 0 }] }).error, 'workspace_id_invalid');
  assert.equal(parseMusicSongMove({ destination_workspace_id: workspaceId, songs: [{ id: songA, revision: 0 }] }).error, 'idempotency_key_invalid');
  assert.equal(parseMusicSongMove({ ...moveBase, idempotency_key: 'short', songs: [{ id: songA, revision: 0 }] }).error, 'idempotency_key_invalid');
  assert.equal(parseMusicSongMove({ ...moveBase, songs: [{ id: songA, revision: 0, owner_id: workspaceId }] }).error, 'songs_invalid');
});

test('the narrow pre-debit music policy is normalized and returns one public refusal', () => {
  assert.deepEqual(musicPromptPolicy('  Slow instrumental harbour lights  '), {
    ok: true,
    version: MUSIC_POLICY_VERSION,
  });
  assert.deepEqual(musicPromptPolicy('an erotic song about an underage child'), {
    ok: false,
    error: 'prompt_not_allowed',
    version: MUSIC_POLICY_VERSION,
  });
  assert.deepEqual(musicPromptPolicy('sexual soundtrack celebrating non-consensual assault'), {
    ok: false,
    error: 'prompt_not_allowed',
    version: MUSIC_POLICY_VERSION,
  });
});

test('the proof quote accepts only bounded simple instrumental requests', () => {
  assert.deepEqual(parseMusicQuote({ prompt: '  harbour lights  ' }), {
    ok: true,
    prompt: 'harbour lights',
    title: null,
    mode: 'simple',
    modelId: 'ace-step',
    instrumental: true,
    variety: null,
    styleInfluence: null,
    excludeStyles: null,
    durationSeconds: 60,
  });
  assert.equal(parseMusicQuote({ prompt: 'harbour lights', model_id: 'ace-step-1.5' }).modelId, 'ace-step-1.5');
  assert.equal(parseMusicQuote({ prompt: 'harbour lights', model_id: 'ace-step-1.5', variety: 0 }).variety, 0);
  assert.equal(parseMusicQuote({ prompt: 'harbour lights', model_id: 'ace-step-1.5', variety: 100 }).variety, 100);
  assert.equal(parseMusicQuote({ prompt: 'harbour lights', model_id: 'ace-step', variety: 50 }).error, 'advanced_controls_invalid');
  assert.equal(parseMusicQuote({ prompt: 'harbour lights', model_id: 'ace-step-1.5', variety: 50.5 }).error, 'variety_invalid');
  assert.equal(parseMusicQuote({ prompt: 'harbour lights', model_id: 'ace-step-1.5', variety: 101 }).error, 'variety_invalid');
  assert.deepEqual(parseMusicQuote({
    prompt: 'harbour lights', model_id: 'ace-step-1.5', style_influence: 72,
    exclude_styles: '  distorted guitar, orchestral strings  ',
  }), {
    ok: true, prompt: 'harbour lights', title: null, mode: 'simple', modelId: 'ace-step-1.5',
    instrumental: true, variety: null, styleInfluence: 72,
    excludeStyles: 'distorted guitar, orchestral strings', durationSeconds: 60,
  });
  assert.equal(parseMusicQuote({ prompt: 'x', model_id: 'ace-step-1.5', style_influence: -1 }).error, 'style_influence_invalid');
  assert.equal(parseMusicQuote({ prompt: 'x', model_id: 'ace-step-1.5', style_influence: 1.5 }).error, 'style_influence_invalid');
  assert.equal(parseMusicQuote({ prompt: 'x', model_id: 'ace-step-1.5', exclude_styles: ' ' }).excludeStyles, null);
  assert.equal(parseMusicQuote({ prompt: 'x', model_id: 'ace-step-1.5', exclude_styles: 'x'.repeat(501) }).error, 'exclude_styles_invalid');
  assert.equal(parseMusicQuote({ prompt: 'x', duration_seconds: 10 }).durationSeconds, 10);
  assert.equal(parseMusicQuote({ prompt: 'x', duration_seconds: 60 }).durationSeconds, 60);
  assert.equal(parseMusicQuote({ prompt: 'x', duration_seconds: 9 }).error, 'duration_invalid');
  assert.equal(parseMusicQuote({ prompt: 'x', duration_seconds: 60.5 }).error, 'duration_invalid');
  assert.equal(parseMusicQuote({ prompt: 'x', duration_seconds: 65 }).error, 'duration_invalid');
  assert.deepEqual(parseMusicQuote({
    mode: 'custom', draft_revision: 7, instrumental: false,
    rights_confirmed: true, duration_seconds: 45,
  }), {
    ok: true, mode: 'custom', draftRevision: 7, instrumental: false,
    rightsConfirmed: true, durationSeconds: 45,
  });
  assert.deepEqual(parseMusicQuote({
    mode: 'custom', draft_revision: 7, instrumental: true,
    rights_confirmed: false, duration_seconds: 30,
  }), {
    ok: true, mode: 'custom', draftRevision: 7, instrumental: true,
    rightsConfirmed: false, durationSeconds: 30,
  });
  assert.equal(parseMusicQuote({ mode: 'custom', draft_revision: 7, instrumental: false, rights_confirmed: false }).error, 'lyrics_rights_required');
  assert.equal(parseMusicQuote({ mode: 'custom', draft_revision: 7, instrumental: true, rights_confirmed: true }).error, 'lyrics_rights_not_applicable');
  assert.equal(parseMusicQuote({ mode: 'custom', draft_revision: 7, rights_confirmed: true }).error, 'custom_mode_invalid');
  assert.equal(parseMusicQuote({ mode: 'custom', draft_revision: -1, instrumental: false, rights_confirmed: true }).error, 'revision_invalid');
  assert.equal(parseMusicQuote({ mode: 'custom', draft_revision: 7, instrumental: false, rights_confirmed: true, lyrics: 'forged' }).error, 'invalid_request');
  assert.equal(parseMusicQuote({ prompt: 'harbour lights', model_id: 'unknown' }).error, 'model_not_supported');
  assert.equal(parseMusicQuote({ mode: 'custom', prompt: 'lyrics' }).error, 'invalid_request');
  assert.equal(parseMusicQuote({ prompt: 'music', instrumental: false }).error, 'instrumental_required');
  assert.equal(parseMusicQuote({ prompt: 'music', admin: true }).error, 'invalid_request');
  assert.equal(parseMusicQuote({ prompt: 'x'.repeat(501) }).error, 'prompt_invalid');
  assert.equal(parseMusicQuote({ prompt: 'music', title: 'x'.repeat(81) }).error, 'title_invalid');
});

test('pair confirmation requires a UUID quote and a constrained idempotency key', () => {
  const quoteId = 'a5ed2d0d-8276-4fbb-9c4f-39f401a3158b';
  assert.deepEqual(parseMusicGeneration({ quote_id: quoteId, idempotency_key: 'music.123456' }), {
    ok: true, quoteId, idempotencyKey: 'music.123456',
  });
  assert.equal(parseMusicGeneration({ quote_id: 'bad', idempotency_key: 'music.123456' }).error, 'quote_id_invalid');
  assert.equal(parseMusicGeneration({ quote_id: quoteId, idempotency_key: 'short' }).error, 'idempotency_key_invalid');
  assert.equal(parseMusicGeneration({ quote_id: quoteId, idempotency_key: 'music.123456', credits: 0 }).error, 'invalid_request');
});

test('private distribution parsers bind share tokens, versions and export quotes exactly', () => {
  const versionId = 'a5ed2d0d-8276-4fbb-9c4f-39f401a3158b';
  const quoteId = 'b6ed2d0d-8276-4fbb-9c4f-39f401a3158c';
  const token = 'A'.repeat(43);
  assert.deepEqual(parseMusicShareLinkCreate({
    version_id: versionId, token, idempotency_key: 'share.12345678',
  }), { ok: true, versionId, token, idempotencyKey: 'share.12345678' });
  assert.deepEqual(parseMusicShareLinkRevoke({ idempotency_key: 'revoke.12345678' }), { // gitleaks:allow -- synthetic idempotency fixture
    ok: true, idempotencyKey: 'revoke.12345678', // gitleaks:allow -- synthetic idempotency fixture
  });
  assert.deepEqual(parseMusicExportQuote({ version_id: versionId, format: 'mp3' }), {
    ok: true, versionId, format: 'mp3',
  });
  assert.deepEqual(parseMusicExportQuote({ version_id: versionId, format: 'wav' }), {
    ok: true, versionId, format: 'wav',
  });
  assert.deepEqual(parseMusicExportStart({ quote_id: quoteId, idempotency_key: 'export.12345678' }), {
    ok: true, quoteId, idempotencyKey: 'export.12345678',
  });
  assert.equal(parseMusicShareLinkCreate({ version_id: versionId, token: 'weak', idempotency_key: 'share.12345678' }).error, 'share_token_invalid');
  assert.equal(parseMusicShareLinkCreate({ version_id: versionId, token, idempotency_key: 'share.12345678', public: true }).error, 'invalid_request');
  assert.equal(parseMusicExportQuote({ version_id: versionId, format: 'flac' }).error, 'format_not_supported');
  assert.equal(parseMusicExportStart({ quote_id: quoteId, idempotency_key: 'short' }).error, 'idempotency_key_invalid');
});

test('money and replay failures cross the API boundary with stable statuses', () => {
  assert.equal(musicRpcStatus('INSUFFICIENT_BALANCE'), 402);
  assert.equal(musicRpcStatus('DOWNLOAD_ALLOWANCE_EXHAUSTED'), 402);
  assert.equal(musicRpcStatus('ACCOUNT_FROZEN'), 403);
  assert.equal(musicRpcStatus('QUOTE_EXPIRED'), 409);
  assert.equal(musicRpcStatus('CONCURRENCY_LIMIT'), 409);
  assert.equal(musicRpcStatus('RATE_LIMITED'), 429);
  assert.equal(musicRpcStatus('MODEL_UNAVAILABLE'), 503);
  assert.equal(musicRpcStatus('PLAN_UNAVAILABLE'), 503);
  assert.equal(publicMusicError('QUOTE_EXPIRED'), 'quote_expired');
  assert.equal(publicMusicError('not safe!'), 'music_request_rejected');
});
