import { View } from 'react-native';
import type { ApiClient } from '../../lib/api';
import { t } from '../../lib/i18n';
import { english } from '../../lib/i18n/binding';
import { slotsFor, type GenerationReference, type SlotName } from '../../lib/sources';
import type { CatalogModel } from '../../lib/media';
import { SourcePicker } from '../SourcePicker';
import { Checkbox, Text } from '../ui';

export function MakeSources({ api, model, references, rights, waiting, onReferences, onBusy, onRights }: {
    api: ApiClient; model: CatalogModel; references: readonly GenerationReference[]; rights: boolean; waiting: boolean;
    onReferences: (slot: SlotName, files: readonly GenerationReference[]) => void;
    onBusy: (slot: SlotName, busy: boolean) => void; onRights: (value: boolean) => void;
}) {
    const slots = slotsFor(model);
    if (!slots.length) return null;
    return <View style={{ gap: 12 }}>
        <Text accessibilityRole="header">{t('create.workspace.references')}</Text>
        {slots.map(slot => <SourcePicker key={slot.slot} slot={slot} api={api} drawable={false}
            references={references.filter(ref => ref.slot === slot.slot)}
            onReferences={files => onReferences(slot.slot, files)} onBusy={busy => onBusy(slot.slot, busy)}
            onChange={() => {}} onLibrary={() => {}} />)}
        {references.length ? <View>
            <Checkbox checked={rights} accessibilityLanguage="en" accessibilityLabel={english('form.sourceRights')}
                accessibilityState={{ checked: rights, disabled: waiting }} disabled={waiting} onChange={onRights}>
                <Text variant="caption" tone="secondary">{english('form.sourceRights')}</Text>
            </Checkbox>
            <Text accessibilityLanguage="en" variant="caption" tone="tertiary">{english('form.consent')}</Text>
        </View> : null}
    </View>;
}
