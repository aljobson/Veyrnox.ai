import * as React from 'react';
import { fixture } from './publicSiteRender.mjs';
export const files = {
  enhance: 'app/veyrnox/app/enhance/page.js',
  controls: 'app/veyrnox/_components/editor/EditorControls.js',
  commerce: 'app/veyrnox/app/publish/commerce/page.js',
  autolists: 'app/veyrnox/app/publish/autolists/page.js',
  character: 'app/veyrnox/_components/CharacterPanel.js',
  sheet: 'app/veyrnox/_components/EditSheet.js',
  settings: 'app/veyrnox/_components/chat/SettingsPanel.js',
  chat: 'app/veyrnox/_components/chat/ChatWorkspace.js',
  media: 'app/veyrnox/_components/chat/MediaComposer.js',
  pack: 'app/veyrnox/_components/editor/AssetPackPanel.js',
  transcript: 'app/veyrnox/_components/editor/TranscriptPanel.js',
  motion: 'app/veyrnox/_components/editor/MotionProcessingControls.js',
};
const noop = () => {};
const model = { id: 'fixture', name: 'Model name unchanged', maker_label: 'Model family unchanged', credits_per_reply: 1, max_reply_tokens: 1024, options: { thinking: { extra_credits: 1 }, web: { extra_credits: 2 }, images: { extra_credits: 1 }, research: { extra_credits: 4 } } };
const mediaModel = { id: 'video', kind: 'video', name: 'Video model unchanged', credits: 3, durations: [5, 10], aspects: ['16:9', '9:16'], resolutions: ['720p', '1080p'], audioOptions: [false, true], media: {} };
const mediaProps = { kind: 'video', prompt: 'User prompt unchanged', onPrompt: noop, media: { availableModels: [mediaModel], model: mediaModel, sources: {}, duration: 5, aspect: '16:9', resolution: '720p', count: 1, audio: true, balance: 20, cost: 3, freeLeft: 0, jobs: [], catalogLive: true, generate: noop } };
const timeline = { media: {}, video: [], audio: [], text: [], tracks: [] };
const caption = { id: 'cue', trackId: 'text', caption: true, start: 0, len: 60, text: 'User transcript unchanged', wordsEstimated: true, words: [{ text: 'User', start: 0, len: 15 }, { text: 'transcript', start: 15, len: 25 }, { text: 'unchanged', start: 40, len: 20 }] };
export const scenarios = [
  { area: 'enhance', name: 'default' },
  { area: 'enhance', name: 'Editor' },
  { area: 'enhance', name: 'Editor', states: [{ file: { name: 'User video unchanged' }, url: 'blob:fixture' }, 10.5, 16/9, '', { smoothing: 30, look: 'natural', intensity: 100 }, { time: 1.2, faces: 1, playing: false }, 'ready', '', null] },
  { area: 'controls', name: 'VisualControls', props: { item: { start: 0, len: 90 }, frame: 0, onChange: noop } },
  { area: 'controls', name: 'SoundControls', props: { item: { len: 90, volume: 1 }, onChange: noop, onRate: noop, onExtract: noop } },
  { area: 'controls', name: 'TextControls', props: { item: { start: 0, len: 90, size: 10, x: .5, y: .5 }, frame: 0, onChange: noop } },
  { area: 'commerce', name: 'CommerceWorkspace', states: [[{ id: 'p', title: 'User product unchanged', currency: 'GBP', price_cents: 12345, inventory_quantity: 1234, variants: [{ title: 'User variant' }] }], 'owner'] },
  { area: 'commerce', name: 'VariantEditor', props: { variants: [{ title: 'User variant unchanged', sku: 'MY-SKU', price: '10', inventoryQuantity: 2 }], onAdd: noop, onChange: noop, onRemove: noop } },
  { area: 'autolists', name: 'Autolists', states: [[{ id: 'feed', name: 'User feed unchanged', queue_name: 'User queue unchanged', refresh_interval_minutes: 360, enabled: true, auto_schedule: true }], [{ id: 'queue', name: 'User queue unchanged' }], { id: null, name: '', feedUrl: '', queueId: 'queue', captionTemplate: '{{title}}\n{{link}}', refreshIntervalMinutes: 360, enabled: true, autoSchedule: true }, 'owner'] },
  { area: 'character', name: 'CharacterPanel', props: { enabled: true, picks: { oddling_name: 'User Oddling unchanged' }, onToggle: noop, onChange: noop } },
  { area: 'sheet', name: 'EditSheet', props: { clips: [{ job_id: 'clip', name: 'User clip unchanged' }], audios: [], credits5s: 3, onClose: noop, onSubmitted: noop } },
  { area: 'settings', name: 'SettingsPanel', props: { models: [model], model, tiers: new Set(), opts: { thinking: true, web: true }, offer: model.options, instr: 'User instructions unchanged', maxPrompt: 4000, onOpts: noop }, states: [{ persona: true, filter: true, model: true, caps: true, tools: true, prompt: true, about: true }] },
  { area: 'chat', name: 'Footer', props: { m: { status: 'canceled', credits: 1, content: 'Provider response unchanged' }, starred: true, onStar: noop } },
  { area: 'chat', name: 'ChatWorkspace', states: [[model], [], null, '*', null, [{ id: 'reply', role: 'assistant', content: 'Provider response unchanged', status: 'complete', credits: 1 }], model.id, 'User draft unchanged', [], false, { thinking: true, web: true }, { maxAttachments: 4, maxEdge: 2048 }, false, [], null, false, '', false, 'chat', '', null, false, false, false, 0, true] },
  { area: 'media', name: 'MediaComposer', props: mediaProps },
  { area: 'media', name: 'MediaComposer', props: { ...mediaProps, media: { ...mediaProps.media, model: { ...mediaModel, media: { image: true } }, sources: { image: { id: 'asset' } }, consent: false } } },
  { area: 'pack', name: 'AssetPackPanel', props: { onIngest: noop } },
  { area: 'transcript', name: 'TranscriptPanel', props: { tl: timeline, blobs: { current: new Map() }, frame: 0 } },
  { area: 'transcript', name: 'TranscriptPanel', props: { tl: { ...timeline, text: [caption], tracks: [{ id: 'text', kind: 'text', name: 'User track unchanged' }] }, blobs: { current: new Map() }, frame: 0 } },
  ...['stabilize', 'track-reframe', 'camera-movement'].map(tool => ({ area: 'motion', name: 'MotionProcessingControls', props: { media: { kind: 'video' }, blob: null, timeline, onBusy: noop }, states: [tool] })),
];
import { visibleText } from './visibleText.mjs';
export { visibleText };
export function renderScenario(scenario, locale, messages, sourceOverrides = {}) {
  const file = files[scenario.area];
  const f = fixture(locale, '/app/' + scenario.area, {
    messages, signedIn: true, sourceOverrides,
    expose: { [files.enhance]: ['Editor'], [files.autolists]: ['Autolists'], [files.chat]: ['Footer'] },
    states: scenario.states ? { [file]: scenario.states } : {},
    moduleMocks: {
      // Imported child controls have separate entries in the strict inventory.
      './WordTimingControls': { WordTimingControls: () => null }, './TypographyControls': { TypographyControls: () => null },
      './AnimationControls': { AnimationControls: () => null, MotionControls: () => null, ParameterControls: () => null },
      './ColourControls': { ColourControls: () => null }, './MaskControls': { MaskControls: () => null },
      './ModelPicker': { ModelPicker: () => null, Dots: () => null, CostFilter: () => null },
      './PersonaPicker': { PersonaPicker: () => null }, './ThreadList': { ThreadList: () => null },
      './StudioDraftCards': { StudioDraftCards: () => null }, './ComposerControls': { ComposerControls: () => null, ComposerTypeTabs: () => null },
      './AttachBar': { AttachButton: () => null, AttachChips: () => null, useAttachments: () => ({ items: [], notice: '', clear: noop }) },
      '../SourcePickers': { SourcePickers: () => null }, './CompletionFlags': { useEditorCompletionFlags: () => ({ localInference: false }) },
      '../../_lib/useVideoEnhancePreview': { useVideoEnhancePreview: () => false },
      '../_lib/useAssetUrl': { useAssetUrl: () => ({ url: 'blob:fixture', onLoad: noop, onError: noop }) },
      '../../_lib/useCatalog': { useCatalog: () => ({ models: [], live: true, loading: false }) },
      '../../_lib/useFreeAllowance': { useFreeAllowance: () => ({}) },
      './useChatMediaGeneration': { useChatMediaGeneration: () => ({}) },
      './useChatSend': { useChatSend: () => ({ send: noop, stop: noop, busy: false }) },
    },
  });
  return f.render(React.createElement(f.load(file)[scenario.name], scenario.props || {}));
}
