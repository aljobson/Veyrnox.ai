import { useAnnouncement } from '../../lib/useAnnouncement';
import { discardCacheCopy } from '../../lib/cacheFiles';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { Button, Card, Text, themedStyles, useThemedStyles } from '../ui';
import { t } from '../../lib/i18n';
import { useSwapRuntime } from '../../lib/templateSwap/runtime';
import { isOffline, subscribe } from '../../lib/networkState';
import { swapErrorKey, unsettled, type SwapOffer } from '../../../../../app/veyrnox/_lib/templateSwapClient.mjs';
import { SwapVisionHost } from './SwapVisionHost';
import { TemplatePhotoExample } from './TemplatePhotoExample';
export function SwapComposer({ offer, onSubmitted }: { offer: SwapOffer; onSubmitted?: () => void }) {
    const { actions, attempts, accountId, beginSessionTask } = useSwapRuntime(offer.id), router = useRouter();
    const a = attempts.at(-1), offline = useSyncExternalStore(subscribe, isOffline), styles = useThemedStyles(sheets);
    const busy = !!a && ['processing', 'uploading', 'submitting'].includes(a.state);
    const [slow, setSlow] = useState(false), [pickerError, setPickerError] = useState(false), [picking, setPicking] = useState(false);
    useEffect(() => {
        setSlow(false); if (!busy) return;
        const timer = setTimeout(() => setSlow(true), 3000); return () => clearTimeout(timer);
    }, [busy]);
    const people = offer.people === 2 ? 2 : 1;
    const ready = a?.files?.length === people * 2 && ['ready', 'not_charged', 'refunded', 'refund_pending', 'upload_error'].includes(a.state);
    const canReplace = !!accountId && !busy && !picking && !attempts.some(unsettled);
    async function pick(person: 0 | 1 = 0) {
        if (!canReplace || (person === 1 && !a?.files)) return;
        setPickerError(false); setPicking(true); const task = beginSessionTask();
        try {
            const selected = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: false, quality: 1, preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current });
            if (!selected.canceled && selected.assets[0]) {
                if (task.current()) await actions.choose(offer.id, selected.assets[0], person);
                else discardCacheCopy(selected.assets[0].uri);
            }
        } catch { setPickerError(true); }
        finally { setPicking(false); }
    }
    const error = a && ['photo_error', 'upload_error'].includes(a.state) ? a.errorCode : undefined, uploadError = a?.state === 'upload_error';
    const errorKey = error === 'photo_too_large' ? 'mobileSwap.photoTooLarge' : error === 'invalid_image' ? 'mobileSwap.invalidImage' : swapErrorKey(error);
    useAnnouncement(pickerError ? t('mobileSwap.permission') : error ? t(errorKey) : busy ? t(a?.state === 'processing' ? 'presets.swap.processing' : 'presets.swap.sending') : a?.state === 'ready' ? t('presets.swap.generate') : null);
    return <Card>
        <View style={styles.content}>
            <SwapVisionHost />
            <Text variant="title2" accessibilityRole="header">{t('presets.swap.title')}</Text>
            <Text>{people === 2 && offer.roles ? t('presets.swap.roles', { first: offer.roles[0], second: offer.roles[1] }) : t('presets.swap.role', { role: offer.role })}</Text>
            <Text>{t('presets.swap.model', { model: offer.name || t('presets.swap.loading') })}</Text>
            <Text>{t('presets.swap.scene')}</Text>
            <Text>{t('presets.swap.rights')}</Text>
            <Button variant="tertiary" label={t('presets.swap.terms')} onPress={() => router.push('/legal/terms')} />
            <Button variant="tertiary" label={t('presets.swap.aup')} onPress={() => router.push('/legal/aup')} />
            <Text>{t('presets.swap.privacy')}</Text>
            {Array.from({ length: people }, (_, person) => {
                const mine = a?.urls?.slice(person * 2, person * 2 + 2), label = people === 2 && offer.roles ? t('presets.swap.personPhoto', { role: offer.roles[person] }) : t('presets.swap.photo');
                const showError = error && !uploadError && (people === 1 || ((a as { photoPerson?: number } | undefined)?.photoPerson ?? 0) === person);
                return <View key={person} style={styles.content}>
                    <Text variant="bodyStrong">{label}</Text>
                    <Text>{t(people === 2 ? 'presets.swap.twoGuidance' : 'presets.swap.guidance')}</Text>
                    <TemplatePhotoExample limits="swap" />
                    <Button variant="secondary" label={t(mine?.length ? 'presets.swap.replace' : 'presets.swap.choose')} disabled={!canReplace || (person === 1 && !a?.files)} onPress={() => void pick(person as 0 | 1)} />
                    {showError && <Text tone="danger" accessibilityLiveRegion="polite">{t(errorKey)}</Text>}
                    {showError && a?.state === 'photo_error' && <Button variant="secondary" label={t('presets.swap.retry')} disabled={!canReplace} onPress={() => void pick(person as 0 | 1)} />}
                    {mine?.length === 2 && mine.map((uri, i) => <View key={uri} style={styles.content}>
                        <Image source={{ uri }} cachePolicy="none" contentFit="contain" style={styles.preview} accessibilityLabel={t(i ? 'presets.swap.crop' : 'presets.swap.frontal')} />
                        <Text variant="caption">{t(i ? 'presets.swap.crop' : 'presets.swap.frontal')}</Text>
                    </View>)}
                </View>;
            })}
            {pickerError && <Text tone="danger" accessibilityLiveRegion="polite">{t('mobileSwap.permission')}</Text>}
            {a && !a.body && <Button variant="secondary" label={t('presets.swap.cancel')} onPress={() => actions.cancel(a.key)} />}
            {offline && <Text accessibilityLiveRegion="polite">{t('presets.swap.offline')}</Text>}
            {!accountId && <><Text accessibilityLiveRegion="polite">{t('presets.swap.session')}</Text><Button label={t('presets.swap.signin')} onPress={() => router.push('/sign-in')} /></>}
            <Text tone="warning">{t('presets.swap.price', { credits: offer.credits })}</Text>
            <Button label={t('presets.swap.generate')} disabled={!accountId || !offer.name || !ready || busy || offline} onPress={() => { if (!isOffline()) void Promise.resolve(actions.submit(offer.id, offer)).finally(() => requestAnimationFrame(() => onSubmitted?.())); }} />
            {busy && <Text accessibilityLiveRegion="polite">{t(a?.state === 'processing' ? 'presets.swap.processing' : 'presets.swap.sending')}{slow ? ` ${t('presets.swap.slow')}` : ''}</Text>}
            {uploadError && <Text tone="danger" accessibilityLiveRegion="polite">{t(errorKey)}</Text>}
        </View>
    </Card>;
}
const sheets = themedStyles(() => ({ content: { gap: 12 }, preview: { width: '100%', aspectRatio: 1 } }));
