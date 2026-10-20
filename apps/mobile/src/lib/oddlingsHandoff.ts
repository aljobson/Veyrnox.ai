// Sending an Oddling on to Create. Nothing here charges or sends anything: it only works out which catalog model to
// open, the words to fill in and the price to show first. Create shows the price again and charges only on its own
// Generate button; the price is the catalog's, never worked out here.
import { promptHref } from './explore';
import { estimateCredits, isSupported, kindOf, textInput, type CatalogModel } from './media';
import { MOTIONS, buildStudioPrompt, characterTraits, oddlingIdentity, type Picks } from './oddlingsBuilder';

// The model the web hands a portrait to.
export const PORTRAIT_MODEL_ID = 'flux-2-pro';
const SHORT_FALLBACK_MAX = 2000;
const LOOK_TRAITS = 6;

const open = (models: readonly CatalogModel[]) => models.filter((m) => !m.gated && isSupported(m));

export function portraitModel(models: readonly CatalogModel[]): CatalogModel | null {
    const usable = open(models);
    return usable.find((m) => m.id === PORTRAIT_MODEL_ID) ?? null;
}

// Auto Short is the catalog model that takes a topic instead of a prompt.
export function shortModel(models: readonly CatalogModel[]): CatalogModel | null {
    return open(models).find((m) => kindOf(m.modality) === 'video' && textInput(m)?.key === 'topic') ?? null;
}

export interface Offer {
    readonly model: CatalogModel;
    readonly credits: number;
}

export function offerFor(model: CatalogModel | null): Offer | null {
    return model ? { model, credits: estimateCredits(model, null) } : null;
}

const clean = (text: string, max: number) => text.replace(/\s+/g, ' ').trim().slice(0, max);

// The words for Auto Short: who the creator is, their voice and show, the look and the first scene, longest parts last,
// cut to the model's own limit so the creator is never the part that is lost.
export function shortTopic(picks: Picks, scene: string, max: number = SHORT_FALLBACK_MAX, motionId = ''): string {
    const name = clean(picks.oddling_name || '', 40);
    const who = name ? `A vertical short starring ${name}, an original fictional adult creator` : 'A vertical short starring an original fictional adult creator';
    const parts = [who, ...oddlingIdentity(picks).filter((line) => !line.startsWith('fictional creator named') && !line.startsWith('immutable'))];
    const look = characterTraits(picks).slice(0, LOOK_TRAITS);
    const motion = MOTIONS.find((m) => m.id === motionId) ?? MOTIONS[0];
    const tail = [look.length ? `Look: ${look.join(', ')}` : '', clean(scene, 300) ? `Scene: ${clean(scene, 300)}` : '', `Opening: the character ${motion.phrase}`].filter(Boolean);
    const head = parts.join('. ');
    for (let keep = tail.length; keep > 0; keep -= 1) {
        const text = [head, ...tail.slice(0, keep)].join('. ');
        if (text.length <= max) return text;
    }
    return head.slice(0, max);
}

export function portraitLink(model: CatalogModel, picks: Picks, scene: string) {
    return promptHref(model.id, buildStudioPrompt({ picks, scene }));
}

export function shortLink(model: CatalogModel, picks: Picks, scene: string, motionId = '') {
    return promptHref(model.id, shortTopic(picks, scene, textInput(model)?.max ?? SHORT_FALLBACK_MAX, motionId));
}
