import { MUSIC_RUNTIME_FLAG_NAMES } from './musicRuntime.js';

export const MUSIC_PARITY_STATUS_CREDIT = Object.freeze({
  shipped: 1,
  qualified: 0.5,
  intentionally_different: 1,
  externally_blocked: 0,
  missing: 0,
});

export const MUSIC_PARITY_AREA_WEIGHTS = Object.freeze({
  creation: 25,
  editing: 20,
  daw: 20,
  library: 15,
  community: 10,
  ios: 10,
});

const row = (id, area, weight, current, target, proof) => Object.freeze({
  id, area, weight, current, target, proof,
});

export const MUSIC_PARITY_ROWS = Object.freeze([
  row('create.simple-custom', 'creation', 15, 'shipped', 'shipped', 'reticle_simulator'),
  row('create.advanced-musical-controls', 'creation', 15, 'shipped', 'shipped', 'contract_reticle_simulator'),
  row('create.lyrics-instrumental', 'creation', 10, 'shipped', 'shipped', 'contract_reticle_simulator'),
  row('create.quote-rights-recovery', 'creation', 10, 'shipped', 'shipped', 'contract'),
  row('create.audio-reference-input', 'creation', 10, 'shipped', 'shipped', 'contract_ui'),
  row('create.models-personalization', 'creation', 10, 'intentionally_different', 'intentionally_different', 'lyricist_profile_contract'),
  row('create.production-route-health', 'creation', 8, 'qualified', 'qualified', 'production_route_probe_candidate_cancel_contract_ui'),
  row('create.native-qualification', 'creation', 12, 'qualified', 'qualified', 'simulator_physical_audio'),
  row('create.multimodal-inspiration', 'creation', 5, 'missing', 'shipped', 'scan_quota_contract_reticle_simulator'),
  row('create.daily-challenge', 'creation', 5, 'qualified', 'shipped', 'utc_contract_reticle_simulator'),

  row('edit.cover-reuse-remix', 'editing', 15, 'shipped', 'shipped', 'contract_ui'),
  row('edit.sections-extend-crop', 'editing', 20, 'shipped', 'shipped', 'contract_ui'),
  row('edit.stems-target-stems', 'editing', 15, 'qualified', 'shipped', 'contract_physical_fidelity'),
  row('edit.export-playback', 'editing', 10, 'qualified', 'shipped', 'contract_physical_fidelity'),
  row('edit.version-lineage', 'editing', 10, 'shipped', 'shipped', 'contract'),
  row('edit.rights-takedown', 'editing', 10, 'shipped', 'shipped', 'contract'),
  row('edit.cross-provider-format-fidelity', 'editing', 10, 'qualified', 'qualified', 'production_route_physical_fidelity'),
  row('edit.advanced-stem-selection', 'editing', 5, 'missing', 'missing', 'verified_provider_contract'),
  row('edit.surgical-lyric-change', 'editing', 5, 'missing', 'missing', 'verified_provider_contract'),

  row('daw.arrangement-transport', 'daw', 15, 'shipped', 'shipped', 'contract_simulator'),
  row('daw.piano-instruments', 'daw', 15, 'shipped', 'shipped', 'contract_simulator'),
  row('daw.mixer-effects-automation', 'daw', 15, 'qualified', 'shipped', 'physical_fidelity_dropout'),
  row('daw.recording-takes', 'daw', 10, 'qualified', 'shipped', 'physical_mic'),
  row('daw.mixdown-share', 'daw', 10, 'qualified', 'shipped', 'physical_fidelity_memory'),
  row('daw.beat-ai', 'daw', 5, 'shipped', 'shipped', 'quote_recovery_ui'),
  row('daw.external-midi', 'daw', 10, 'qualified', 'shipped', 'physical_midi_hotplug'),
  row('daw.native-adaptive-accessibility', 'daw', 10, 'qualified', 'shipped', 'simulator_voiceover_device'),
  row('daw.conversational-local-actions', 'daw', 5, 'qualified', 'shipped', 'gate_parser_reticle_simulator'),
  row('daw.generative-chat-and-plugins', 'daw', 5, 'qualified', 'qualified', 'dual_gate_no_plugin_execution'),

  row('library.songs-history-hooks', 'library', 15, 'shipped', 'shipped', 'contract_ui'),
  row('library.playlists-workspaces', 'library', 15, 'shipped', 'shipped', 'contract_ui'),
  row('library.search-sort-filters', 'library', 10, 'shipped', 'shipped', 'reticle_simulator'),
  row('library.discovery-profiles', 'library', 10, 'shipped', 'shipped', 'viewer_filtered_contract_ui'),
  row('library.publication-share', 'library', 10, 'shipped', 'shipped', 'moderation_contract_ui'),
  row('library.queue-public-slugs', 'library', 5, 'shipped', 'shipped', 'existing_contract'),
  row('library.native-signed-assets', 'library', 10, 'qualified', 'shipped', 'physical_playback_account_fence'),
  row('library.discovery-native-polish', 'library', 10, 'qualified', 'shipped', 'simulator_accessibility'),
  row('library.albums-releases', 'library', 10, 'missing', 'shipped', 'database_moderation_reticle_simulator'),
  row('library.account-fenced-audio-queue', 'library', 5, 'missing', 'shipped', 'storage_account_ui'),

  row('community.public-tracks-creators', 'community', 15, 'shipped', 'shipped', 'viewer_filtered_contract_ui'),
  row('community.comments-reports-blocks', 'community', 15, 'shipped', 'shipped', 'moderation_contract_ui'),
  row('community.likes-play-counts', 'community', 10, 'shipped', 'shipped', 'contract_ui'),
  row('community.listen-links-app-handoff', 'community', 10, 'shipped', 'shipped', 'contract_ui'),
  row('community.music-mcp', 'community', 5, 'missing', 'shipped', 'mcp_music_contract'),
  row('community.mobile-social-polish', 'community', 10, 'qualified', 'shipped', 'simulator_device_accessibility'),
  row('community.discovery-ranking', 'community', 10, 'qualified', 'shipped', 'production_capability_ui'),
  row('community.public-albums', 'community', 10, 'missing', 'shipped', 'moderation_reticle_simulator'),
  row('community.daily-challenge-participation', 'community', 5, 'missing', 'shipped', 'utc_contract_ui'),
  row('community.album-profile-shelves', 'community', 5, 'missing', 'shipped', 'viewer_filtered_contract_ui'),
  row('community.challenge-discovery-shelf', 'community', 5, 'missing', 'shipped', 'reticle_simulator'),

  row('ios.navigation-core-create', 'ios', 15, 'shipped', 'shipped', 'simulator'),
  row('ios.song-actions-library', 'ios', 15, 'qualified', 'shipped', 'simulator_physical_signed_assets'),
  row('ios.beats-source-contracts', 'ios', 10, 'shipped', 'shipped', 'contract'),
  row('ios.orientation-layout', 'ios', 8, 'qualified', 'shipped', 'simulator_device_rotation'),
  row('ios.voiceover-dynamic-type-rtl', 'ios', 8, 'qualified', 'shipped', 'simulator_voiceover_device'),
  row('ios.audio-playback-export-fidelity', 'ios', 8, 'qualified', 'shipped', 'physical_device'),
  row('ios.mic-interruption-latency', 'ios', 8, 'qualified', 'shipped', 'physical_device'),
  row('ios.external-midi-hotplug', 'ios', 8, 'qualified', 'shipped', 'physical_device_midi'),
  row('ios.revenuecat-app-store-sandbox', 'ios', 6, 'missing', 'shipped', 'physical_app_store_sandbox'),
  row('ios.release-build-route-health', 'ios', 14, 'missing', 'qualified', 'exact_commit_xcode_route'),
]);

export const MUSIC_PARITY_FLAG_EXEMPTIONS = Object.freeze(['ui', 'schema', 'dispatch']);

export const MUSIC_PARITY_FLAG_ROWS = Object.freeze({
  library: ['library.songs-history-hooks'], libraryTabs: ['library.search-sort-filters'],
  sources: ['create.audio-reference-input'], references: ['create.audio-reference-input'],
  generation: ['create.production-route-health'], distribution: ['library.publication-share'], publication: ['library.publication-share'],
  playlists: ['library.playlists-workspaces'], collaboration: ['library.playlists-workspaces'],
  editing: ['edit.sections-extend-crop'], reverse: ['edit.sections-extend-crop'], cover: ['edit.cover-reuse-remix'],
  reuse: ['edit.cover-reuse-remix'], remix: ['edit.cover-reuse-remix'], stems: ['edit.stems-target-stems'],
  targetStems: ['edit.stems-target-stems'], trackAdd: ['edit.sections-extend-crop'], extend: ['edit.sections-extend-crop'],
  replace: ['edit.sections-extend-crop'], addSection: ['edit.sections-extend-crop'], longSongs: ['edit.sections-extend-crop'], lyrics: ['create.lyrics-instrumental'],
  studio: ['daw.arrangement-transport'], beatEditor: ['daw.arrangement-transport'], beatAi: ['daw.beat-ai'],
  magicBar: ['daw.generative-chat-and-plugins'], beatCloud: ['daw.generative-chat-and-plugins'],
  beatLibrarySave: ['daw.generative-chat-and-plugins'], beatV5Writes: ['daw.generative-chat-and-plugins'], blocks: ['daw.generative-chat-and-plugins'],
  labs: ['community.discovery-ranking'], ranking: ['community.discovery-ranking'], bestOf: ['community.discovery-ranking'],
  reactions: ['community.likes-play-counts'], follows: ['community.public-tracks-creators'], comments: ['community.comments-reports-blocks'],
  notifications: ['community.public-tracks-creators'], plays: ['community.likes-play-counts'], songReports: ['community.comments-reports-blocks'], rails: ['library.queue-public-slugs'],
  albums: ['library.albums-releases', 'community.public-albums', 'community.album-profile-shelves'],
  inspiration: ['create.multimodal-inspiration'], studioChat: ['daw.conversational-local-actions', 'daw.generative-chat-and-plugins'],
  dailyChallenge: ['create.daily-challenge', 'community.daily-challenge-participation', 'community.challenge-discovery-shelf'],
  persistentQueue: ['library.account-fenced-audio-queue'],
  dailyCredits: ['create.quote-rights-recovery'],
});

export function calculateMusicParity(field = 'current') {
  if (field !== 'current' && field !== 'target') throw new TypeError('invalid parity field');
  const areas = {};
  for (const area of Object.keys(MUSIC_PARITY_AREA_WEIGHTS)) {
    areas[area] = MUSIC_PARITY_ROWS.filter((item) => item.area === area).reduce(
      (sum, item) => sum + item.weight * MUSIC_PARITY_STATUS_CREDIT[item[field]], 0,
    );
  }
  const total = Object.entries(MUSIC_PARITY_AREA_WEIGHTS).reduce(
    (sum, [area, weight]) => sum + areas[area] * weight / 100, 0,
  );
  return Object.freeze({ areas: Object.freeze(areas), total });
}

export function validateMusicParityInventory() {
  const ids = new Set();
  const errors = [];
  for (const item of MUSIC_PARITY_ROWS) {
    if (ids.has(item.id)) errors.push(`duplicate:${item.id}`);
    ids.add(item.id);
    if (!(item.area in MUSIC_PARITY_AREA_WEIGHTS)) errors.push(`area:${item.id}`);
    if (!(item.current in MUSIC_PARITY_STATUS_CREDIT)) errors.push(`current:${item.id}`);
    if (!(item.target in MUSIC_PARITY_STATUS_CREDIT)) errors.push(`target:${item.id}`);
  }
  for (const area of Object.keys(MUSIC_PARITY_AREA_WEIGHTS)) {
    const weight = MUSIC_PARITY_ROWS.filter((item) => item.area === area).reduce((sum, item) => sum + item.weight, 0);
    if (weight !== 100) errors.push(`weight:${area}:${weight}`);
  }
  const exempt = new Set(MUSIC_PARITY_FLAG_EXEMPTIONS);
  for (const flag of MUSIC_RUNTIME_FLAG_NAMES) {
    const mapped = MUSIC_PARITY_FLAG_ROWS[flag];
    if (!exempt.has(flag) && !mapped) errors.push(`flag:${flag}`);
    for (const id of mapped || []) if (!ids.has(id)) errors.push(`flag-row:${flag}:${id}`);
  }
  for (const flag of Object.keys(MUSIC_PARITY_FLAG_ROWS)) {
    if (!MUSIC_RUNTIME_FLAG_NAMES.includes(flag)) errors.push(`unknown-flag:${flag}`);
  }
  return Object.freeze(errors);
}
