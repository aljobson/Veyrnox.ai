import { MUSIC_RUNTIME_FLAG_NAMES } from './musicRuntime.js';

export const MUSIC_PARITY_STATUS_CREDIT = Object.freeze({ shipped: 1, qualified: 0.5, intentionally_different: 1, externally_blocked: 0, missing: 0 });
export const MUSIC_PARITY_AREA_WEIGHTS = Object.freeze({ creation: 25, editing: 20, daw: 20, library: 15, community: 10, ios: 10 });

const E = (source, test) => Object.freeze([source, test]);
const ROW_EVIDENCE = Object.freeze({
  'create.simple-custom': E('apps/mobile/src/app/(app)/music/create.tsx', 'apps/mobile/__tests__/musicCreateScreens.test.tsx'),
  'create.advanced-musical-controls': E('apps/mobile/src/components/music/MusicAdvancedControls.tsx', 'apps/mobile/__tests__/music/sunoScreens.test.tsx'),
  'create.lyrics-instrumental': E('apps/mobile/src/components/music/MusicLyricsPanel.tsx', 'apps/mobile/__tests__/music/sunoScreens.test.tsx'),
  'create.quote-rights-recovery': E('apps/mobile/src/components/music/MusicQuoteCard.tsx', 'apps/mobile/__tests__/musicCreateFlow.test.ts'),
  'create.audio-reference-input': E('apps/mobile/src/components/music/MusicSunoControls.tsx', 'apps/mobile/__tests__/music/sunoContract.test.ts'),
  'create.models-personalization': E('app/veyrnox/_components/music/MusicLyricistProfiles.jsx', 'tests/musicLyricist.test.mjs'),
  'create.production-route-health': E('apps/mobile/src/components/music/MusicCandidateCancel.tsx', 'apps/mobile/__tests__/musicCandidateCancel.test.tsx'),
  'create.native-qualification': E('apps/mobile/src/app/(app)/music/create.tsx', 'apps/mobile/__tests__/musicCreateGuards.test.ts'),
  'create.multimodal-inspiration': E('docs/product/MUSIC-PARITY-100-PLAN.md', 'tests/musicParityInventory.test.mjs'),
  'create.daily-challenge': E('apps/mobile/src/lib/music/dailyChallenge.ts', 'apps/mobile/__tests__/musicDailyChallenge.test.ts'),
  'edit.cover-reuse-remix': E('apps/mobile/src/app/(app)/music/cover.tsx', 'apps/mobile/__tests__/musicActionScreens.test.tsx'),
  'edit.sections-extend-crop': E('apps/mobile/src/app/(app)/music/extend.tsx', 'apps/mobile/__tests__/musicSectionActionScreens.test.tsx'),
  'edit.stems-target-stems': E('apps/mobile/src/app/(app)/music/stems.tsx', 'apps/mobile/__tests__/musicTargetStemScreens.test.tsx'),
  'edit.export-playback': E('apps/mobile/src/app/(app)/music/export.tsx', 'apps/mobile/__tests__/musicExportScreens.test.tsx'),
  'edit.version-lineage': E('apps/mobile/src/app/(app)/music/[id].tsx', 'apps/mobile/__tests__/musicScreens.test.tsx'),
  'edit.rights-takedown': E('apps/mobile/src/components/music/MusicPublication.tsx', 'apps/mobile/__tests__/musicPublicationScreens.test.tsx'),
  'edit.cross-provider-format-fidelity': E('apps/mobile/src/lib/music/exportFlow.ts', 'apps/mobile/__tests__/musicExportFlow.test.ts'),
  'edit.advanced-stem-selection': E('docs/product/MUSIC-PARITY-100-PLAN.md', 'tests/musicParityInventory.test.mjs'),
  'edit.surgical-lyric-change': E('docs/product/MUSIC-PARITY-100-PLAN.md', 'tests/musicParityInventory.test.mjs'),
  'daw.arrangement-transport': E('apps/mobile/src/components/beats/BeatArrangement.tsx', 'apps/mobile/__tests__/beatNativeArrangement.test.tsx'),
  'daw.piano-instruments': E('apps/mobile/src/components/beats/BeatPianoRoll.tsx', 'apps/mobile/__tests__/beatNativePiano.test.tsx'),
  'daw.mixer-effects-automation': E('apps/mobile/src/components/beats/BeatMixerSheet.tsx', 'apps/mobile/__tests__/beatNativeMixer.test.tsx'),
  'daw.recording-takes': E('apps/mobile/src/components/beats/BeatRecordPanel.tsx', 'apps/mobile/__tests__/beatNativeRecording.test.ts'),
  'daw.mixdown-share': E('apps/mobile/src/components/beats/BeatExportSheet.tsx', 'apps/mobile/__tests__/beatNativeExportSheet.test.tsx'),
  'daw.beat-ai': E('apps/mobile/src/components/beats/ai/BeatAiPanel.tsx', 'apps/mobile/__tests__/beatAi/sheet.test.tsx'),
  'daw.external-midi': E('apps/mobile/src/components/beats/BeatExternalMidiCapture.tsx', 'apps/mobile/__tests__/beatExternalMidi.test.ts'),
  'daw.native-adaptive-accessibility': E('apps/mobile/src/components/beats/BeatControlsSheet.tsx', 'apps/mobile/__tests__/mobileQaAccessibility.test.tsx'),
  'daw.conversational-local-actions': E('apps/mobile/src/components/beats/BeatStudioAssistant.tsx', 'tests/musicStudioNativeContract.test.mjs'),
  'daw.generative-chat-and-plugins': E('apps/mobile/src/components/beats/BeatStudioAssistant.tsx', 'tests/musicStudioActions.test.mjs'),
  'library.songs-history-hooks': E('apps/mobile/src/app/(app)/music/index.tsx', 'apps/mobile/__tests__/musicScreens.test.tsx'),
  'library.playlists-workspaces': E('apps/mobile/src/app/(app)/music/playlists/index.tsx', 'apps/mobile/__tests__/musicPlaylistScreens.test.tsx'),
  'library.search-sort-filters': E('apps/mobile/src/app/(app)/music/index.tsx', 'apps/mobile/__tests__/musicScreens.test.tsx'),
  'library.discovery-profiles': E('apps/mobile/src/app/(app)/music/creator/[handle].tsx', 'apps/mobile/__tests__/musicPublicScreens.test.tsx'),
  'library.publication-share': E('apps/mobile/src/components/music/MusicPublication.tsx', 'apps/mobile/__tests__/musicPublicationFlow.test.ts'),
  'library.queue-public-slugs': E('apps/mobile/src/lib/music/queue.ts', 'apps/mobile/__tests__/musicQueue.test.ts'),
  'library.native-signed-assets': E('apps/mobile/src/components/music/MusicPlayer.tsx', 'apps/mobile/__tests__/musicListenPrivacy.test.ts'),
  'library.discovery-native-polish': E('apps/mobile/src/app/(app)/music/discover.tsx', 'apps/mobile/__tests__/musicDiscover.test.ts'),
  'library.albums-releases': E('apps/mobile/src/app/(app)/music/albums/index.tsx', 'apps/mobile/__tests__/musicAlbumsClient.test.ts'),
  'library.account-fenced-audio-queue': E('apps/mobile/src/components/music/PersistentAudioQueue.tsx', 'apps/mobile/__tests__/persistentAudioQueue.test.ts'),
  'community.public-tracks-creators': E('apps/mobile/src/app/(app)/music/track/[slug].tsx', 'apps/mobile/__tests__/musicPublicScreens.test.tsx'),
  'community.comments-reports-blocks': E('apps/mobile/src/components/music/PublicComments.tsx', 'apps/mobile/__tests__/musicPublicFlow.test.ts'),
  'community.likes-play-counts': E('apps/mobile/src/components/music/PublicSocial.tsx', 'apps/mobile/__tests__/musicPublicClient.test.ts'),
  'community.listen-links-app-handoff': E('apps/mobile/src/lib/music/musicLinks.ts', 'apps/mobile/__tests__/musicLinks.test.tsx'),
  'community.music-mcp': E('lib/mcpMusic.js', 'tests/musicMcp.test.mjs'),
  'community.mobile-social-polish': E('apps/mobile/src/components/music/PublicShell.tsx', 'apps/mobile/__tests__/musicPublicScreens.test.tsx'),
  'community.discovery-ranking': E('apps/mobile/src/app/(app)/music/discover.tsx', 'apps/mobile/__tests__/musicDiscover.test.ts'),
  'community.public-albums': E('apps/mobile/src/app/(app)/music/album/[slug].tsx', 'apps/mobile/__tests__/musicAlbumsValidation.test.ts'),
  'community.daily-challenge-participation': E('docs/product/MUSIC-PARITY-100-PLAN.md', 'tests/musicParityInventory.test.mjs'),
  'community.album-profile-shelves': E('apps/mobile/src/app/(app)/music/creator/[handle].tsx', 'apps/mobile/__tests__/musicAlbumsClient.test.ts'),
  'community.challenge-discovery-shelf': E('docs/product/MUSIC-PARITY-100-PLAN.md', 'tests/musicParityInventory.test.mjs'),
  'ios.navigation-core-create': E('apps/mobile/src/app/(app)/music/index.tsx', 'apps/mobile/__tests__/liveNavigation.test.ts'),
  'ios.song-actions-library': E('apps/mobile/src/components/music/MusicSongActions.tsx', 'apps/mobile/__tests__/musicScreens.test.tsx'),
  'ios.beats-source-contracts': E('apps/mobile/src/app/(app)/beats/index.tsx', 'apps/mobile/__tests__/beatNativeScreens.test.tsx'),
  'ios.orientation-layout': E('apps/mobile/src/lib/beatNative/editorLayout.ts', 'apps/mobile/__tests__/orientationLayout.test.ts'),
  'ios.voiceover-dynamic-type-rtl': E('apps/mobile/src/components/music/PublicShell.tsx', 'apps/mobile/__tests__/mobileQaAccessibility.test.tsx'),
  'ios.audio-playback-export-fidelity': E('apps/mobile/src/components/music/MusicPlayer.tsx', 'apps/mobile/__tests__/musicPlayer.test.ts'),
  'ios.mic-interruption-latency': E('apps/mobile/src/lib/beatNative/latencyStore.ts', 'apps/mobile/__tests__/beatNativeLatency.test.ts'),
  'ios.external-midi-hotplug': E('apps/mobile/src/lib/beatNative/nativeExternalMidi.ts', 'apps/mobile/__tests__/beatExternalMidi.test.ts'),
  'ios.revenuecat-app-store-sandbox': E('apps/mobile/src/billing/storePurchaseStore.ts', 'apps/mobile/__tests__/purchasesNativeBuild.test.ts'),
  'ios.release-build-route-health': E('apps/mobile/app.json', 'docs/product/MUSIC-PARITY-100-PLAN.md'),
});
const ROW_ROUTE = Object.freeze({
  'create.simple-custom': 'ios:/(app)/music/create', 'create.advanced-musical-controls': 'ios:/(app)/music/create', 'create.lyrics-instrumental': 'ios:/(app)/music/create',
  'create.quote-rights-recovery': 'ios:/(app)/music/create', 'create.audio-reference-input': 'ios:/(app)/music/create', 'create.models-personalization': 'planned:ios:/(app)/music/create',
  'create.production-route-health': 'ios:/(app)/music/create', 'create.native-qualification': 'ios:/(app)/music/create', 'create.multimodal-inspiration': 'planned:ios:/(app)/music/create', 'create.daily-challenge': 'ios:/(app)/music/create',
  'edit.cover-reuse-remix': 'ios:/(app)/music/cover', 'edit.sections-extend-crop': 'ios:/(app)/music/extend', 'edit.stems-target-stems': 'ios:/(app)/music/stems', 'edit.export-playback': 'ios:/(app)/music/export',
  'edit.version-lineage': 'ios:/(app)/music/[id]', 'edit.rights-takedown': 'ios:/(app)/music/[id]', 'edit.cross-provider-format-fidelity': 'ios:/(app)/music/export',
  'edit.advanced-stem-selection': 'externally-blocked:provider', 'edit.surgical-lyric-change': 'externally-blocked:provider',
  'daw.arrangement-transport': 'ios:/(app)/beats/[id]', 'daw.piano-instruments': 'ios:/(app)/beats/piano/[id]', 'daw.mixer-effects-automation': 'ios:/(app)/beats/[id]',
  'daw.recording-takes': 'ios:/(app)/beats/[id]', 'daw.mixdown-share': 'ios:/(app)/beats/[id]', 'daw.beat-ai': 'ios:/(app)/beats/[id]', 'daw.external-midi': 'ios:/(app)/beats/[id]',
  'daw.native-adaptive-accessibility': 'ios:/(app)/beats/[id]', 'daw.conversational-local-actions': 'ios:/(app)/beats/[id]', 'daw.generative-chat-and-plugins': 'ios:/(app)/beats/[id]',
  'library.songs-history-hooks': 'ios:/(app)/music', 'library.playlists-workspaces': 'ios:/(app)/music/playlists', 'library.search-sort-filters': 'ios:/(app)/music',
  'library.discovery-profiles': 'ios:/(app)/music/creator/[handle]', 'library.publication-share': 'ios:/(app)/music/[id]', 'library.queue-public-slugs': 'ios:/(app)/music',
  'library.native-signed-assets': 'ios:/(app)/music/[id]', 'library.discovery-native-polish': 'ios:/(app)/music/discover', 'library.albums-releases': 'ios:/(app)/music/albums',
  'library.account-fenced-audio-queue': 'ios:/(app)/music', 'community.public-tracks-creators': 'ios:/(app)/music/track/[slug]', 'community.comments-reports-blocks': 'ios:/(app)/music/track/[slug]',
  'community.likes-play-counts': 'ios:/(app)/music/track/[slug]', 'community.listen-links-app-handoff': 'ios:/music/listen/[token]', 'community.music-mcp': 'backend:/mcp/music',
  'community.mobile-social-polish': 'ios:/(app)/music/track/[slug]', 'community.discovery-ranking': 'ios:/(app)/music/discover', 'community.public-albums': 'ios:/(app)/music/album/[slug]',
  'community.daily-challenge-participation': 'planned:ios:/(app)/music/create', 'community.album-profile-shelves': 'ios:/(app)/music/creator/[handle]', 'community.challenge-discovery-shelf': 'planned:ios:/(app)/music/discover',
  'ios.navigation-core-create': 'ios:/(app)/music', 'ios.song-actions-library': 'ios:/(app)/music/[id]', 'ios.beats-source-contracts': 'ios:/(app)/beats',
  'ios.orientation-layout': 'ios:/(app)/beats/[id]', 'ios.voiceover-dynamic-type-rtl': 'ios:/(app)/music', 'ios.audio-playback-export-fidelity': 'ios:/(app)/music/export',
  'ios.mic-interruption-latency': 'ios:/(app)/beats/[id]', 'ios.external-midi-hotplug': 'ios:/(app)/beats/[id]', 'ios.revenuecat-app-store-sandbox': 'ios:/credits',
  'ios.release-build-route-health': 'ios:xcode:release',
});
const row = (id, area, weight, current, target, proof, options = {}) => Object.freeze({
  id, area, weight, baseline: options.baseline ?? current, current, target, proof,
  evidence: Object.freeze([...(options.evidence ?? ROW_EVIDENCE[id] ?? [])]),
  route: options.route ?? ROW_ROUTE[id] ?? '', outcomeEvidence: Object.freeze([...(options.outcomeEvidence ?? [])]),
  requiredGates: Object.freeze([...(options.requiredGates ?? [])]),
});

export const MUSIC_PARITY_ROWS = Object.freeze([
  row('create.simple-custom', 'creation', 15, 'shipped', 'shipped', 'ios_simulator'),
  row('create.advanced-musical-controls', 'creation', 15, 'shipped', 'shipped', 'contract_ios_simulator'),
  row('create.lyrics-instrumental', 'creation', 10, 'shipped', 'shipped', 'contract_ios_simulator'),
  row('create.quote-rights-recovery', 'creation', 10, 'shipped', 'shipped', 'contract'),
  row('create.audio-reference-input', 'creation', 10, 'shipped', 'shipped', 'contract_ios_ui'),
  row('create.models-personalization', 'creation', 10, 'missing', 'intentionally_different', 'native_lyricist_profile_required', { requiredGates: ['PERSONAS_ENABLED'] }),
  row('create.production-route-health', 'creation', 8, 'qualified', 'qualified', 'production_route_probe_candidate_cancel_contract_ios_ui'),
  row('create.native-qualification', 'creation', 12, 'qualified', 'qualified', 'simulator_physical_audio'),
  row('create.multimodal-inspiration', 'creation', 5, 'missing', 'shipped', 'scan_quota_contract_ios_simulator'),
  row('create.daily-challenge', 'creation', 5, 'qualified', 'shipped', 'utc_contract_ios_simulator', { baseline: 'missing' }),

  row('edit.cover-reuse-remix', 'editing', 15, 'shipped', 'shipped', 'contract_ios_ui'),
  row('edit.sections-extend-crop', 'editing', 20, 'shipped', 'shipped', 'contract_ios_ui'),
  row('edit.stems-target-stems', 'editing', 15, 'qualified', 'shipped', 'contract_physical_fidelity'),
  row('edit.export-playback', 'editing', 10, 'qualified', 'shipped', 'contract_physical_fidelity'),
  row('edit.version-lineage', 'editing', 10, 'shipped', 'shipped', 'contract'),
  row('edit.rights-takedown', 'editing', 10, 'shipped', 'shipped', 'contract'),
  row('edit.cross-provider-format-fidelity', 'editing', 10, 'qualified', 'qualified', 'production_route_physical_fidelity'),
  row('edit.advanced-stem-selection', 'editing', 5, 'missing', 'missing', 'verified_provider_contract'),
  row('edit.surgical-lyric-change', 'editing', 5, 'missing', 'missing', 'verified_provider_contract'),

  row('daw.arrangement-transport', 'daw', 15, 'shipped', 'shipped', 'contract_ios_simulator'),
  row('daw.piano-instruments', 'daw', 15, 'shipped', 'shipped', 'contract_ios_simulator'),
  row('daw.mixer-effects-automation', 'daw', 15, 'qualified', 'shipped', 'physical_fidelity_dropout'),
  row('daw.recording-takes', 'daw', 10, 'qualified', 'shipped', 'physical_mic'),
  row('daw.mixdown-share', 'daw', 10, 'qualified', 'shipped', 'physical_fidelity_memory'),
  row('daw.beat-ai', 'daw', 5, 'shipped', 'shipped', 'quote_recovery_ios_ui'),
  row('daw.external-midi', 'daw', 10, 'qualified', 'shipped', 'physical_midi_hotplug'),
  row('daw.native-adaptive-accessibility', 'daw', 10, 'qualified', 'shipped', 'simulator_voiceover_device'),
  row('daw.conversational-local-actions', 'daw', 5, 'qualified', 'shipped', 'gate_parser_ios_simulator', { baseline: 'missing' }),
  row('daw.generative-chat-and-plugins', 'daw', 5, 'qualified', 'qualified', 'dual_gate_no_plugin_execution', { baseline: 'missing' }),

  row('library.songs-history-hooks', 'library', 15, 'shipped', 'shipped', 'contract_ios_ui'),
  row('library.playlists-workspaces', 'library', 15, 'shipped', 'shipped', 'contract_ios_ui'),
  row('library.search-sort-filters', 'library', 10, 'shipped', 'shipped', 'ios_simulator'),
  row('library.discovery-profiles', 'library', 10, 'shipped', 'shipped', 'viewer_filtered_contract_ios_ui'),
  row('library.publication-share', 'library', 10, 'shipped', 'shipped', 'moderation_contract_ios_ui'),
  row('library.queue-public-slugs', 'library', 5, 'shipped', 'shipped', 'existing_contract'),
  row('library.native-signed-assets', 'library', 10, 'qualified', 'shipped', 'physical_playback_account_fence'),
  row('library.discovery-native-polish', 'library', 10, 'qualified', 'shipped', 'ios_simulator_accessibility'),
  row('library.albums-releases', 'library', 10, 'qualified', 'shipped', 'database_moderation_ios_simulator', {
    baseline: 'missing', evidence: ['packages/db/schema/supabase/0600_music_albums.sql', 'packages/db/schema/supabase/0605_music_album_privacy_and_artwork.sql', 'apps/mobile/src/app/(app)/music/albums/index.tsx', 'apps/mobile/src/app/(app)/music/albums/[id].tsx', 'tests/musicAlbums.test.mjs'], route: 'ios:/(app)/music/albums',
  }),
  row('library.account-fenced-audio-queue', 'library', 5, 'qualified', 'shipped', 'storage_account_ios_ui_device', { baseline: 'missing' }),

  row('community.public-tracks-creators', 'community', 15, 'shipped', 'shipped', 'viewer_filtered_contract_ios_ui'),
  row('community.comments-reports-blocks', 'community', 15, 'shipped', 'shipped', 'moderation_contract_ios_ui'),
  row('community.likes-play-counts', 'community', 10, 'shipped', 'shipped', 'contract_ios_ui'),
  row('community.listen-links-app-handoff', 'community', 10, 'shipped', 'shipped', 'contract_ios_ui'),
  row('community.music-mcp', 'community', 5, 'shipped', 'shipped', 'mcp_music_contract', { baseline: 'missing' }),
  row('community.mobile-social-polish', 'community', 10, 'qualified', 'shipped', 'ios_simulator_device_accessibility'),
  row('community.discovery-ranking', 'community', 10, 'qualified', 'shipped', 'production_capability_ios_ui'),
  row('community.public-albums', 'community', 10, 'qualified', 'shipped', 'moderation_ios_simulator', {
    baseline: 'missing', evidence: ['packages/db/schema/supabase/0600_music_albums.sql', 'packages/db/schema/supabase/0605_music_album_privacy_and_artwork.sql', 'apps/mobile/src/app/(app)/music/album/[slug].tsx', 'tests/musicAlbums.test.mjs'], route: 'ios:/(app)/music/album/[slug]',
  }),
  row('community.daily-challenge-participation', 'community', 5, 'missing', 'shipped', 'utc_contract_ios_ui'),
  row('community.album-profile-shelves', 'community', 5, 'qualified', 'shipped', 'viewer_filtered_contract_ios_ui', {
    baseline: 'missing', evidence: ['packages/db/schema/supabase/0600_music_albums.sql', 'apps/mobile/src/app/(app)/music/creator/[handle].tsx', 'apps/mobile/__tests__/musicPublicScreens.test.tsx'], route: 'ios:/(app)/music/creator/[handle]',
  }),
  row('community.challenge-discovery-shelf', 'community', 5, 'missing', 'shipped', 'ios_simulator'),

  row('ios.navigation-core-create', 'ios', 15, 'shipped', 'shipped', 'ios_simulator'),
  row('ios.song-actions-library', 'ios', 15, 'qualified', 'shipped', 'ios_simulator_physical_signed_assets'),
  row('ios.beats-source-contracts', 'ios', 10, 'shipped', 'shipped', 'contract'),
  row('ios.orientation-layout', 'ios', 8, 'qualified', 'shipped', 'ios_simulator_device_rotation'),
  row('ios.voiceover-dynamic-type-rtl', 'ios', 8, 'qualified', 'shipped', 'ios_simulator_voiceover_device'),
  row('ios.audio-playback-export-fidelity', 'ios', 8, 'qualified', 'shipped', 'physical_device'),
  row('ios.mic-interruption-latency', 'ios', 8, 'qualified', 'shipped', 'physical_device'),
  row('ios.external-midi-hotplug', 'ios', 8, 'qualified', 'shipped', 'physical_device_midi'),
  row('ios.revenuecat-app-store-sandbox', 'ios', 6, 'missing', 'shipped', 'physical_app_store_sandbox'),
  row('ios.release-build-route-health', 'ios', 14, 'missing', 'qualified', 'exact_commit_xcode_route'),
]);

export const MUSIC_PARITY_FLAG_EXEMPTIONS = Object.freeze(['ui', 'schema', 'dispatch']);
const required = (rows) => Object.freeze({ disposition: 'required', rows: Object.freeze(rows) });
const dark = (rows) => Object.freeze({ disposition: 'dark', rows: Object.freeze(rows) });
const libraryRows = ['library.songs-history-hooks', 'library.search-sort-filters'];
export const MUSIC_PARITY_FLAG_ROWS = Object.freeze({
  library: required(libraryRows), libraryTabs: required(libraryRows), sources: required(['create.audio-reference-input']), references: dark(['create.audio-reference-input']),
  generation: required(['create.production-route-health']), distribution: required(['library.publication-share']), publication: required(['library.publication-share']),
  playlists: required(['library.playlists-workspaces']), collaboration: required(['library.playlists-workspaces']), editing: required(['edit.sections-extend-crop']), reverse: required(['edit.sections-extend-crop']),
  cover: required(['edit.cover-reuse-remix']), reuse: required(['edit.cover-reuse-remix']), remix: required(['edit.cover-reuse-remix']), stems: required(['edit.stems-target-stems']),
  targetStems: required(['edit.stems-target-stems']), trackAdd: required(['edit.sections-extend-crop']), extend: required(['edit.sections-extend-crop']), replace: required(['edit.sections-extend-crop']),
  addSection: required(['edit.sections-extend-crop']), longSongs: dark(['edit.sections-extend-crop']), lyrics: required(['create.lyrics-instrumental']), studio: required(['daw.arrangement-transport']),
  beatEditor: required(['daw.arrangement-transport']), beatAi: required(['daw.beat-ai']), magicBar: dark(['daw.generative-chat-and-plugins']), beatCloud: dark(['daw.generative-chat-and-plugins']),
  beatLibrarySave: dark(['daw.generative-chat-and-plugins']), beatV5Writes: dark(['daw.generative-chat-and-plugins']), blocks: dark(['daw.generative-chat-and-plugins']),
  labs: required(['community.discovery-ranking']), ranking: required(['community.discovery-ranking']), bestOf: required(['community.discovery-ranking']), reactions: required(['community.likes-play-counts']),
  follows: required(['community.public-tracks-creators']), comments: required(['community.comments-reports-blocks']), notifications: required(['community.public-tracks-creators']),
  plays: required(['community.likes-play-counts']), songReports: required(['community.comments-reports-blocks']), rails: required(['library.queue-public-slugs']),
  albums: required(['library.albums-releases', 'community.public-albums', 'community.album-profile-shelves']), inspiration: required(['create.multimodal-inspiration']),
  studioChat: required(['daw.conversational-local-actions', 'daw.generative-chat-and-plugins']), dailyChallenge: required(['create.daily-challenge', 'community.daily-challenge-participation', 'community.challenge-discovery-shelf']),
  persistentQueue: required(['library.account-fenced-audio-queue']), dailyCredits: dark(['create.quote-rights-recovery']),
  // Independent ownership verification is dark groundwork. It does not
  // satisfy the existing lyricist/persona row and earns no score by itself.
  voices: dark([]),
});

const PRODUCTION_ENABLED_FLAGS = new Set(['ui', 'schema', 'library', 'generation', 'dispatch', 'sources', 'distribution', 'publication', 'editing', 'playlists', 'studio', 'reuse', 'collaboration', 'cover', 'stems', 'targetStems', 'trackAdd', 'extend', 'replace', 'addSection', 'comments', 'reactions', 'follows', 'rails', 'beatEditor', 'beatAi', 'remix', 'libraryTabs', 'plays', 'songReports', 'reverse', 'lyrics', 'bestOf', 'notifications', 'labs', 'ranking']);
export const MUSIC_PARITY_PRODUCTION_SNAPSHOT = Object.freeze({
  observedAt: '2026-11-24', source: 'wrangler.jsonc production vars.MUSIC_RUNTIME_FLAGS',
  flags: Object.freeze(Object.fromEntries(MUSIC_RUNTIME_FLAG_NAMES.map((name) => [name, PRODUCTION_ENABLED_FLAGS.has(name)]))),
  gates: Object.freeze({ PERSONAS_ENABLED: true }),
});
export const MUSIC_PARITY_PREACTIVATION_FLAGS = Object.freeze(['albums', 'inspiration', 'studioChat', 'dailyChallenge', 'persistentQueue']);
const preactivationRows = new Set(MUSIC_PARITY_PREACTIVATION_FLAGS.flatMap((flag) => MUSIC_PARITY_FLAG_ROWS[flag].rows));

function statusCredit(item, status) {
  if (status === 'intentionally_different') return item.outcomeEvidence.length > 0 ? 1 : 0;
  return MUSIC_PARITY_STATUS_CREDIT[status];
}
function statusFor(item, field) {
  if (field !== 'preactivation') return item[field];
  return preactivationRows.has(item.id) && item.target === 'shipped' ? 'qualified' : item.target;
}
export function calculateMusicParity(field = 'current') {
  if (!['baseline', 'current', 'target', 'preactivation'].includes(field)) throw new TypeError('invalid parity field');
  const areas = {};
  for (const area of Object.keys(MUSIC_PARITY_AREA_WEIGHTS)) {
    areas[area] = MUSIC_PARITY_ROWS.filter((item) => item.area === area).reduce((sum, item) => {
      const status = statusFor(item, field);
      return sum + item.weight * statusCredit(item, status);
    }, 0);
  }
  const total = Object.entries(MUSIC_PARITY_AREA_WEIGHTS).reduce((sum, [area, weight]) => sum + areas[area] * weight / 100, 0);
  return Object.freeze({ areas: Object.freeze(areas), total });
}

export function validateMusicParityInventory() {
  const ids = new Set(); const errors = [];
  for (const item of MUSIC_PARITY_ROWS) {
    if (ids.has(item.id)) errors.push(`duplicate:${item.id}`); ids.add(item.id);
    if (!(item.area in MUSIC_PARITY_AREA_WEIGHTS)) errors.push(`area:${item.id}`);
    for (const field of ['baseline', 'current', 'target']) if (!(item[field] in MUSIC_PARITY_STATUS_CREDIT)) errors.push(`${field}:${item.id}`);
    if (!item.evidence.length || item.evidence.some((path) => typeof path !== 'string' || !path)) errors.push(`evidence:${item.id}`);
    if (typeof item.route !== 'string' || !item.route) errors.push(`route:${item.id}`);
    if ([item.baseline, item.current].includes('intentionally_different') && !item.outcomeEvidence.length) errors.push(`outcome-evidence:${item.id}`);
    if (['shipped', 'qualified'].includes(item.current) && !item.route.startsWith('backend:')
      && !item.evidence.some((path) => path.startsWith('apps/mobile/'))) errors.push(`native-evidence:${item.id}`);
    for (const gate of item.requiredGates) {
      if (!(gate in MUSIC_PARITY_PRODUCTION_SNAPSHOT.gates)) errors.push(`unknown-gate:${item.id}:${gate}`);
      if (['shipped', 'qualified', 'intentionally_different'].includes(item.current) && !MUSIC_PARITY_PRODUCTION_SNAPSHOT.gates[gate]) errors.push(`credited-gate-off:${item.id}:${gate}`);
    }
  }
  for (const area of Object.keys(MUSIC_PARITY_AREA_WEIGHTS)) {
    const weight = MUSIC_PARITY_ROWS.filter((item) => item.area === area).reduce((sum, item) => sum + item.weight, 0);
    if (weight !== 100) errors.push(`weight:${area}:${weight}`);
  }
  const exempt = new Set(MUSIC_PARITY_FLAG_EXEMPTIONS);
  for (const flag of MUSIC_RUNTIME_FLAG_NAMES) {
    const mapping = MUSIC_PARITY_FLAG_ROWS[flag];
    if (!exempt.has(flag) && !mapping) errors.push(`flag:${flag}`);
    if (mapping && !['required', 'dark'].includes(mapping.disposition)) errors.push(`flag-disposition:${flag}`);
    for (const id of mapping?.rows || []) {
      if (!ids.has(id)) errors.push(`flag-row:${flag}:${id}`);
      const item = MUSIC_PARITY_ROWS.find((candidate) => candidate.id === id);
      if (mapping.disposition === 'required' && item?.current === 'shipped' && !MUSIC_PARITY_PRODUCTION_SNAPSHOT.flags[flag]) errors.push(`shipped-flag-off:${flag}:${id}`);
    }
  }
  for (const flag of Object.keys(MUSIC_PARITY_FLAG_ROWS)) if (!MUSIC_RUNTIME_FLAG_NAMES.includes(flag)) errors.push(`unknown-flag:${flag}`);
  return Object.freeze(errors);
}
