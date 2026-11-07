import { useRef } from 'react';
import { View } from 'react-native';
import { Text } from './ui';
import { SourcePicker } from './SourcePicker';
import type { ApiClient } from '../lib/api';
import type { CatalogModel } from '../lib/media';
import { slotsFor, type GenerationReference } from '../lib/sources';
import { t } from '../lib/i18n';
import { ds } from '../theme';

export function TemplatePhotoSlots({ count, hints = [], model, api, references, onReferences, onBusy }: {
    count: number; hints?: readonly string[]; model: CatalogModel; api: ApiClient; references: readonly GenerationReference[];
    onReferences: (refs: readonly GenerationReference[]) => void; onBusy: (busy: boolean) => void;
}) {
    const positions = useRef<(GenerationReference | undefined)[]>(Array.from({ length: count }, (_, i) => references[i]));
    const busy = useRef(new Set<number>());
    const spec = slotsFor(model).find(slot => slot.slot === 'image');
    if (!spec || (spec.maxFiles ?? 1) < count) return <Text accessibilityLiveRegion="polite">{t('presets.fidelity.photosUnavailable')}</Text>;
    function change(index: number, key: string | undefined) {
        positions.current[index] = key ? { slot: 'image', origin: 'upload', key } : undefined;
        // Partial positions never become a compressed list that another screen can misinterpret.
        onReferences(positions.current.every(Boolean) ? [...positions.current] as GenerationReference[] : []);
    }
    return <View style={{ gap: ds.space.md }}>
        <Text>{t('presets.fidelity.orderedPhotos', { count })}</Text>
        {Array.from({ length: count }, (_, index) => <View key={index} style={{ gap: ds.space.sm }}>
            {hints[index] ? <Text>{hints[index]}</Text> : null}
            <SourcePicker
            slot={{ ...spec, label: t('presets.fidelity.photoSlot', { number: index + 1 }), required: true, maxFiles: 1, minSide: Math.max(256, spec.minSide || 0) }}
            api={api} drawable={false} replaceable initialReady={!!positions.current[index]}
            onChange={key => change(index, key)}
            onBusy={value => { if (value) busy.current.add(index); else busy.current.delete(index); onBusy(busy.current.size > 0); }} /></View>)}
        {references.length !== count && <Text accessibilityLiveRegion="polite">{t('presets.fidelity.photosRequired', { count })}</Text>}
    </View>;
}
