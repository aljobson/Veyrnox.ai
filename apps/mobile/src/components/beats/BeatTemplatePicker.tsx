import { useRef, useState } from 'react';
import { View } from 'react-native';
import { Button, Text } from '../ui';
import { BeatModal } from './BeatModal';
import { BEAT_TEMPLATES, type TemplateId } from '../../lib/beatNative/labs';
import { t } from '../../lib/i18n';
export function BeatTemplatePicker({ onPick, onClose }: { onPick(id: TemplateId): Promise<void>; onClose(): void }) {
    const locked = useRef(false);
    const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
    async function pick(id: TemplateId) {
        if (locked.current) return;
        locked.current = true; setBusy(true); setFailed(false);
        try { await onPick(id); } catch { setFailed(true); }
        finally { locked.current = false; setBusy(false); }
    }
    return <BeatModal title={t('beatLabs.templates')} onClose={() => { if (!locked.current) onClose(); }}>
        {BEAT_TEMPLATES.map(item => <View key={item.id}><Button label={t(`beatLabs.template.${item.id}`)}
            accessibilityHint={t(`beatLabs.template.${item.id}.description`)} disabled={busy} onPress={() => void pick(item.id)} /><Text>{t(`beatLabs.template.${item.id}.description`)}</Text></View>)}
        {failed ? <Text accessibilityLiveRegion="polite">{t('beatLabs.createFailed')}</Text> : null}
        <Button label={t('beatLabs.cancel')} disabled={busy} onPress={onClose} />
    </BeatModal>;
}
