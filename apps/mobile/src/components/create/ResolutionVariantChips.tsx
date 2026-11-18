import { View } from 'react-native';

import { rawText } from '../../lib/i18n/translate';
import { estimateCredits, type CatalogModel } from '../../lib/media';
import { resolutionVariants } from '../../lib/modelVariants';
import { ds } from '../../theme';
import { Chip } from '../ui';

interface Props {
    readonly model: CatalogModel;
    readonly catalog: readonly CatalogModel[];
    readonly duration: number | null;
    readonly onPick: (id: string) => void;
}

export const hasResolutionVariants = (model: CatalogModel, catalog: readonly CatalogModel[]): boolean => resolutionVariants(model.id, catalog).length > 0;

/** "720p · 24 / 1080p · 32": switches between two catalog models that differ in resolution. Prices are the catalog's. */
export function ResolutionVariantChips({ model, catalog, duration, onPick }: Props) {
    const variants = resolutionVariants(model.id, catalog);
    if (variants.length === 0) return null;
    return (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: ds.space.sm }}>
            {variants.map((variant) => {
                const label = `${variant.label} · ${estimateCredits(variant.model, duration)}`;
                return (
                    <Chip key={variant.model.id} label={label} accessibilityLabel={rawText(label)} selected={variant.model.id === model.id}
                        onPress={() => { if (variant.model.id !== model.id) onPick(variant.model.id); }} />
                );
            })}
        </View>
    );
}
