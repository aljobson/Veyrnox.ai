import type { CatalogModel } from './media';

// ADR-0221: the web's /tools page (app/veyrnox/_lib/tools.js) on the phone: models that work on a file you already
// have, grouped by the job they do. Which models exist, what they cost and what they need come from the live catalog;
// only the task names, blurbs and the order live here. __tests__/toolDirectory.test.ts reads the web file and fails if
// the tasks, their order or their models differ.

export interface ToolTask {
    readonly key: string;
    readonly label: string;
    readonly blurb: string;
    readonly ids: readonly string[];
}

export const TOOL_TASKS: readonly ToolTask[] = [
    { key: 'upscale', label: 'Upscale', blurb: 'Make an image larger and sharper.', ids: ['topaz-upscale'] },
    { key: 'background', label: 'Remove background', blurb: 'Cut the subject out of a photo.', ids: ['bria-bg-remove'] },
    { key: 'expand', label: 'Expand', blurb: 'Extend an image beyond its edges.', ids: ['bria-expand'] },
    { key: 'edit', label: 'Edit with a prompt', blurb: 'Change an image by describing the change.', ids: ['nano-banana-pro-edit', 'nano-banana-pro-edit-grsai'] },
    { key: 'face-filters', label: 'Face filters', blurb: 'Retouch, relight or restyle the face in your own photo.', ids: ['face-retouch', 'face-enhance', 'face-relight', 'face-makeup', 'face-age'] },
    { key: 'animate', label: 'Photo to video', blurb: 'Turn a still image into a moving clip.', ids: ['kling-3.0-i2v', 'kling-3.0-i2v-kie'] },
    { key: 'avatar', label: 'Talking avatar', blurb: 'Make a photo speak a voice clip.', ids: ['kling-avatar-v2'] },
    { key: 'lipsync', label: 'Lip sync', blurb: "Match a video's lips to new speech.", ids: ['latentsync'] },
    { key: 'audio-separation', label: 'Separate vocals and instruments', blurb: 'Split your own audio into six separate tracks.', ids: ['demucs-stems'] },
    { key: 'video-sound', label: 'Add sound to a video', blurb: 'Generate sound that fits a short clip.', ids: ['mmaudio-v2-video'] },
    { key: 'video-upscale', label: 'Upscale video', blurb: 'Make a short clip larger and sharper.', ids: ['topaz-upscale-video'] },
];

const OTHER: Omit<ToolTask, 'ids'> = { key: 'other', label: 'More tools', blurb: 'Other models that start from your own file.' };

const SLOT_WORDS: Readonly<Record<string, string>> = { image: 'an image', video: 'a video', audio: 'audio' };

type Media = Record<string, { readonly required?: boolean } | undefined>;
const mediaOf = (m: CatalogModel): Media => (m.capabilities?.media ?? {}) as Media;

// True for a model that cannot run without an upload.
export const isTool = (m: CatalogModel): boolean => Object.values(mediaOf(m)).some((spec) => spec?.required);

// Input-first entry points use this to show only tools that accept the file the person chose to start with.
export const requiresSource = (m: CatalogModel, source: 'image' | 'video'): boolean => mediaOf(m)[source]?.required === true;

// "an image and audio": the uploads a tool requires, in words.
export function toolNeeds(m: CatalogModel): string {
    const slots = Object.entries(mediaOf(m))
        .filter(([, spec]) => spec?.required)
        .map(([slot]) => SLOT_WORDS[slot] ?? slot);
    return slots.reduce((joined, slot) => (joined ? `${joined} and ${slot}` : slot), '');
}

export interface ToolGroup {
    readonly key: string;
    readonly label: string;
    readonly blurb: string;
    readonly tools: readonly CatalogModel[];
}

// Non-empty groups in TOOL_TASKS order. A tool the table does not name still shows, under "More tools", so a model
// added to the catalog is never hidden.
export function toolGroups(models: readonly CatalogModel[]): ToolGroup[] {
    const tools = models.filter(isTool);
    const named = new Set(TOOL_TASKS.flatMap((t) => t.ids));
    const groups: ToolGroup[] = TOOL_TASKS.map((t) => ({ key: t.key, label: t.label, blurb: t.blurb, tools: tools.filter((m) => t.ids.includes(m.id)) }));
    groups.push({ ...OTHER, tools: tools.filter((m) => !named.has(m.id)) });
    return groups.filter((g) => g.tools.length > 0);
}
