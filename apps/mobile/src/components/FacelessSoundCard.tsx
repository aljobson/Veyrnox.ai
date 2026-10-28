import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { Button, Card, Text } from './ui';
import { fetchCatalogCached } from '../lib/media';
import { slotsFor } from '../lib/sources';
import { stageCreativeSourceHandoff } from '../lib/creativeSourceHandoff';
import { FACELESS_REEL_MODEL, FACELESS_SOUND_MODEL, FACELESS_SOUND_PROMPT } from '../lib/facelessReel';
import { t } from '../lib/i18n';

export function FacelessSoundCard({ jobId, followup, state, modelId, mime }: { jobId: string; followup?: string; state: string; modelId: string | null; mime?: string }) {
    const router = useRouter();
    const [available, setAvailable] = useState(false);
    const eligible = followup === 'faceless-sound' && state === 'succeeded' && modelId === FACELESS_REEL_MODEL && !!mime?.startsWith('video/');
    useEffect(() => {
        let active = true;
        setAvailable(false);
        if (eligible) fetchCatalogCached(models => {
            if (active) setAvailable(models.some(m => m.id === FACELESS_SOUND_MODEL && !m.gated && slotsFor(m).some(s => s.slot === 'video')));
        }).catch(() => { if (active) setAvailable(false); });
        return () => { active = false; };
    }, [eligible]);
    if (!eligible || !available) return null;
    function open() {
        const sourceHandoff = stageCreativeSourceHandoff({ recipe: 'faceless-sound', modelId: FACELESS_SOUND_MODEL, uploaded: {}, fromLibrary: {}, references: [{ slot: 'video', origin: 'asset', asset_id: jobId }] });
        router.push({ pathname: '/create/[modelId]', params: { modelId: FACELESS_SOUND_MODEL, prompt: FACELESS_SOUND_PROMPT, recipe: 'faceless-sound', sourceHandoff } });
    }
    return <Card>
        <Text variant="caption">{t('facelessReel.soundPassEyebrow')}</Text>
        <Text variant="title3" accessibilityRole="header">{t('facelessReel.soundPassTitle')}</Text>
        <Text>{t('facelessReel.soundPassHelp')}</Text>
        <Button label={t('facelessReel.soundPassAction')} onPress={open} />
    </Card>;
}
