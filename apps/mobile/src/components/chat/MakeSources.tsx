import { View } from 'react-native';
import type { ApiClient } from '../../lib/api';
import { t } from '../../lib/i18n';
import { slotsFor, type GenerationReference, type SlotName } from '../../lib/sources';
import type { CatalogModel } from '../../lib/media';
import { SourcePicker } from '../SourcePicker';
import { Text } from '../ui';

export function MakeSources({ api, model, references, onReferences, onBusy }: {
    api: ApiClient; model: CatalogModel; references: readonly GenerationReference[];
    onReferences: (slot: SlotName, files: readonly GenerationReference[]) => void;
    onBusy: (slot: SlotName, busy: boolean) => void;
}) {
    const slots = slotsFor(model);
    if (!slots.length) return null;
    return <View style={{ gap: 12 }}>
        <Text accessibilityRole="header">{t('create.workspace.references')}</Text>
        {slots.map(slot => <SourcePicker key={slot.slot} slot={slot} api={api} drawable={false}
            references={references.filter(ref => ref.slot === slot.slot)}
            onReferences={files => onReferences(slot.slot, files)} onBusy={busy => onBusy(slot.slot, busy)}
            onChange={() => {}} onLibrary={() => {}} />)}
    </View>;
}
