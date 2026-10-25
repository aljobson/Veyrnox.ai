import { isSupported, kindOf, type CatalogModel } from './media';
import { SLOT_ORDER, slotsFor, type SlotKind, type SlotName } from './sources';

export interface AttachItem {
    readonly kind: SlotKind;
}

export interface AttachPlan<T extends AttachItem> {
    readonly model: CatalogModel;
    readonly assignments: readonly { readonly slot: SlotName; readonly item: T }[];
    readonly unused: readonly T[];
}

// Hand the files, in the order given, to the slots a model declares: the first picture
// to the start image, the next to the end image, and so on. Null when a required slot stays empty.
function assign<T extends AttachItem>(model: CatalogModel, items: readonly T[]): { slot: SlotName; item: T }[] | null {
    const left = [...items];
    const out: { slot: SlotName; item: T }[] = [];
    for (const slot of slotsFor(model).sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot))) {
        const at = left.findIndex((item) => item.kind === slot.kind);
        if (at >= 0) out.push({ slot: slot.slot, item: left.splice(at, 1)[0] });
        else if (slot.required) return null;
    }
    return out;
}

// The model that places the most attached files wins; a tie keeps the current model, then the same
// media kind, then the cheapest. Gated and unsupported models never qualify.
export function planAttachments<T extends AttachItem>(models: readonly CatalogModel[], current: CatalogModel | null, items: readonly T[]): AttachPlan<T> | null {
    const currentKind = current ? kindOf(current.modality) : null;
    const candidates = models
        .filter(isSupported)
        .map((model) => ({ model, assignments: assign(model, items) }))
        .filter((c): c is { model: CatalogModel; assignments: { slot: SlotName; item: T }[] } => c.assignments !== null && c.assignments.length > 0)
        .sort((a, b) =>
            b.assignments.length - a.assignments.length
            || Number(b.model.id === current?.id) - Number(a.model.id === current?.id)
            || Number(kindOf(b.model.modality) === currentKind) - Number(kindOf(a.model.modality) === currentKind)
            || a.model.credits - b.model.credits);
    const best = candidates[0];
    if (!best) return null;
    const used = new Set<T>(best.assignments.map((a) => a.item));
    return { model: best.model, assignments: best.assignments, unused: items.filter((item) => !used.has(item)) };
}
