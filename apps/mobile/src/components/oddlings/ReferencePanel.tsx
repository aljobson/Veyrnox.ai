import { View } from 'react-native';
import type { ApiClient } from '../../lib/api';
import { t } from '../../lib/i18n';
import type { GenerationReference, Slot } from '../../lib/sources';
import { SourcePicker } from '../SourcePicker';
import { Text, TextField } from '../ui';
interface Props {
    api: ApiClient; slot: Slot; references: readonly GenerationReference[]; referenceNote: string;
    onReferences: (references: readonly GenerationReference[]) => void; onBusy: (busy: boolean) => void; onNote: (note: string) => void;
}
export function ReferencePanel({ api, slot, references, referenceNote, onReferences, onBusy, onNote }: Props) {
    return <View style={{ gap: 10, marginTop: 20 }}>
        <Text accessibilityRole="header">{t('oddlingsStudio.optionalReference')}</Text>
        <Text>{t('oddlingsStudio.moodboard')}</Text>
        <SourcePicker api={api} slot={{ ...slot, required: false }} references={references} onReferences={onReferences} onChange={() => {}} onBusy={onBusy} />
        <TextField value={referenceNote} onChangeText={onNote} maxLength={180} placeholder={t('oddlingsStudio.referencePlaceholder')} accessibilityLabel={t('oddlingsStudio.referencePlaceholder')} />
    </View>;
}
