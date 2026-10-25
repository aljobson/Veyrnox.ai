import { isSupported, kindOf, type CatalogModel } from './media';
import { slotsFor, type SlotKind } from './sources';

// The model that can take an attached file of this kind, or null. Only open models
// that need nothing else (every other slot optional) qualify; the same media kind
// as the screen the person is on wins, then the cheapest.
export function modelForAttachment(models: readonly CatalogModel[], current: CatalogModel | null, kind: SlotKind): CatalogModel | null {
    const fits = (model: CatalogModel): boolean => {
        if (!isSupported(model)) return false;
        const slots = slotsFor(model);
        return slots.some((s) => s.slot === kind) && slots.every((s) => s.slot === kind || !s.required);
    };
    const currentKind = current ? kindOf(current.modality) : null;
    return [...models].filter(fits).sort((a, b) =>
        Number(kindOf(b.modality) === currentKind) - Number(kindOf(a.modality) === currentKind) || a.credits - b.credits)[0] ?? null;
}
