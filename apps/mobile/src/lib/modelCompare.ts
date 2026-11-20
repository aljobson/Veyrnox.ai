import { t } from './i18n';
import type { CatalogModel } from './media';
import { modelFacts, priceUnit } from './modelFacts';
import { publicModelId } from './publicModelIds';

export function isPromptGenerator(model: CatalogModel): boolean {
    const caps = model.capabilities;
    return Boolean(caps?.inputs?.prompt) && !Object.values(caps?.media ?? {}).some(slot => slot?.required);
}

export function canCompare(a: CatalogModel, b: CatalogModel): boolean {
    return a.id !== b.id && a.modality === b.modality && !a.gated && !b.gated
        && isPromptGenerator(a) && isPromptGenerator(b);
}

export function comparableWith(model: CatalogModel, all: readonly CatalogModel[]): CatalogModel[] {
    return all.filter(peer => canCompare(model, peer)).sort((a, b) => a.name.localeCompare(b.name));
}

export function compareHref(x: string, y: string) {
    const [a, b] = [publicModelId(x), publicModelId(y)].sort();
    return { pathname: '/model/compare' as const, params: { a, b } };
}

export function compareRows(a: CatalogModel, b: CatalogModel): { label: string; values: [string, string] }[] {
    const firstFacts = (model: CatalogModel) => {
        const facts = new Map<string, string>();
        for (const { label, value } of modelFacts(model)) {
            if (!facts.has(label)) facts.set(label, value);
        }
        return facts;
    };
    const left = firstFacts(a);
    const right = firstFacts(b);
    const labels = [...new Set([...left.keys(), ...right.keys()])];
    const price = (model: CatalogModel) => `${t('modelPage.price', { credits: model.credits })} ${priceUnit(model)}`;
    return [
        { label: t('modelCompare.price'), values: [price(a), price(b)] },
        ...labels.map(label => ({ label, values: [left.get(label) ?? '–', right.get(label) ?? '–'] as [string, string] })),
    ];
}
