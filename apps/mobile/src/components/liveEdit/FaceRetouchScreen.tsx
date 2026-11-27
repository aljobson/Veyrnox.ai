import { Stack as RouteStack } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, View, useWindowDimensions } from 'react-native';
import { getCacheUser, subscribeCacheUser } from '../../lib/appCache';
import { discardCacheCopy } from '../../lib/cacheFiles';
import { t } from '../../lib/i18n';
import { DEFAULT_STACK, normalizeStack } from '../../lib/liveEdit/engine';
import { type LocalSource } from '../../lib/liveEdit/media';
import { pickLiveMedia, preparePickedPhoto, photoStatus } from '../../lib/liveEdit/pickedPhoto';
import { sameFrame, type Inference } from '../../lib/liveEdit/protocol';
import { saveEffectsToPhotos } from '../../lib/lookExport';
import { ds } from '../../theme';
import { Button, Checkbox, Text, themedStyles, useThemedStyles } from '../ui';
import { StrengthSlider } from '../StrengthSlider';
import { EffectPhoto } from './EffectPhoto';
import { NativeVision } from './NativeVision';

type Status = 'empty' | 'loading' | 'ready' | 'noFace' | 'multiple' | 'failed' | 'invalid' | 'unsupportedFormat' | 'tooLarge' | 'saved' | 'denied';

/** Local-only face smoothing. The same renderEffectStack draws preview and saved pixels. */
export function FaceRetouchScreen({ owner }: { owner: string }) {
    const s = useThemedStyles(styles), { height } = useWindowDimensions();
    const [rights, setRights] = useState(false), [source, setSource] = useState<LocalSource | null>(null), [inference, setInference] = useState<Inference | null>(null);
    const [strength, setStrength] = useState(0.35), [compare, setCompare] = useState(false), [status, setStatus] = useState<Status>('empty');
    const [busy, setBusy] = useState(false), [renderReady, setRenderReady] = useState(false), [retry, setRetry] = useState(0);
    const sourceRef = useRef<LocalSource | null>(null), generation = useRef(0), mounted = useRef(true);
    const live = (token = generation.current) => mounted.current && token === generation.current && getCacheUser() === owner;
    const clearSource = () => { discardCacheCopy(sourceRef.current?.uri); sourceRef.current = null; };
    const changeRights = (next: boolean) => {
        setRights(next);
        if (next) return;
        generation.current++;
        clearSource(); setSource(null); setInference(null); setStatus('empty'); setCompare(false); setRenderReady(false);
    };

    useEffect(() => {
        mounted.current = true;
        const unsubscribe = subscribeCacheUser(() => { if (getCacheUser() !== owner) {
            generation.current++; clearSource(); setSource(null); setInference(null); setRights(false); setStatus('empty'); setCompare(false); setRenderReady(false);
        } });
        return () => { mounted.current = false; generation.current++; unsubscribe(); clearSource(); };
    }, [owner]);

    async function pick() {
        if (!rights || busy) return;
        setBusy(true); setCompare(false); setStatus('loading'); setInference(null); setRenderReady(false);
        const token = ++generation.current;
        clearSource(); setSource(null);
        try {
            const result = await pickLiveMedia(), asset = result.assets?.[0];
            if (!asset || result.canceled) { if (live(token)) setStatus('empty'); return; }
            if (asset.type !== 'image') throw Error('invalid-local-media');
            const prepared = await preparePickedPhoto(asset, { sourceId: token, frameId: 1 });
            if (!live(token)) { discardCacheCopy(prepared.uri); return; }
            sourceRef.current = prepared; setSource(prepared);
        } catch (error) { if (live(token)) setStatus(photoStatus(error)); }
        finally { if (mounted.current) setBusy(false); }
    }
    const receive = (value: Inference) => {
        if (!sourceRef.current || !live() || !sameFrame(sourceRef.current, value)) return;
        setInference(value); setStatus(value.count === 1 ? 'ready' : value.count > 1 ? 'multiple' : 'noFace');
    };
    const fail = () => { if (live()) { setInference(null); setStatus('failed'); setRenderReady(false); } };
    const changeStrength = (next: number) => { setStrength(next); setStatus(source ? 'ready' : 'empty'); setRenderReady(false); };
    async function save() {
        if (!rights || !source || inference?.count !== 1 || !renderReady || strength <= 0 || busy) return;
        setBusy(true); const token = generation.current;
        try {
            const saved = await saveEffectsToPhotos(source.uri, normalizeStack({ smoothing: strength }), inference, source, () => live(token));
            if (live(token)) setStatus(saved ? 'saved' : 'denied');
        } catch { if (live(token)) setStatus('failed'); }
        finally { if (mounted.current) setBusy(false); }
    }
    const retryInference = () => { if (!source || busy) return; setInference(null); setStatus('loading'); setRenderReady(false); setRetry(value => value + 1); };
    const message: Record<Status, string> = {
        empty: t('liveEdit.intro'), loading: t('liveEdit.loading'), ready: t('liveEdit.ready'), noFace: t('liveEdit.noFace'), multiple: t('liveEdit.multiple'), failed: t('liveEdit.failed'),
        invalid: t('liveEdit.invalid'), unsupportedFormat: t('liveEdit.unsupportedFormat'), tooLarge: t('liveEdit.tooLarge'), saved: t('faceFilters.look.saved'), denied: t('faceFilters.look.denied'),
    };
    const stack = compare ? DEFAULT_STACK : normalizeStack({ smoothing: strength });
    const onReady = useCallback(() => setRenderReady(true), []), onError = useCallback(fail, []); // eslint-disable-line react-hooks/exhaustive-deps
    return <View style={s.screen}>
        <RouteStack.Screen options={{ title: t('liveEdit.tool.retouch') }} />
        <View style={s.top}>
            <Text variant="title2" accessibilityRole="header">{t('liveEdit.tool.retouch')}</Text>
            <Text variant="footnote" tone="secondary">{t('liveEdit.privacy')}</Text>
            <Checkbox checked={rights} disabled={busy} accessibilityLabel={t('form.sourceRights')} onChange={changeRights}><Text>{t('form.sourceRights')}</Text></Checkbox>
            <Button label={t('faceFilters.pick')} disabled={!rights || busy} onPress={() => void pick()} />
        </View>
        <View style={s.canvas}>
            {source ? <Pressable accessibilityRole="imagebutton" accessibilityLabel={t('liveEdit.compare')} disabled={busy}
                onPressIn={() => setCompare(true)} onPressOut={() => setCompare(false)}>
                <EffectPhoto source={source} stack={stack} inference={compare ? null : inference} label={t('faceFilterSwitch.attached')}
                    maxHeight={Math.max(180, height * 0.46)} onError={onError} onReady={onReady} />
            </Pressable> : null}
            {!source ? <Text tone="secondary" style={s.center}>{message[status]}</Text> : null}
        </View>
        <View style={s.controls}>
            <Text accessibilityLiveRegion="polite" tone={['failed', 'invalid', 'unsupportedFormat', 'tooLarge', 'denied'].includes(status) ? 'danger' : 'secondary'} style={s.center}>{message[status]}</Text>
            {source ? <StrengthSlider tone="surface" label={t('liveEdit.smoothing')} value={strength} step={0.05} disabled={busy || inference?.count !== 1 || !rights} onChange={changeStrength} /> : null}
            {source ? <View style={s.row}><Button variant="secondary" size="sm" label={t('editorLook.resetFilter')} disabled={busy || strength === 0} onPress={() => changeStrength(0)} />
                <Button size="sm" label={t('faceFilters.look.save')} loading={busy} disabled={!rights || inference?.count !== 1 || !renderReady || strength <= 0} onPress={() => void save()} /></View> : null}
            {source && status === 'failed' ? <Button variant="tertiary" size="sm" label={t('liveEdit.retry')} disabled={busy} onPress={retryInference} /> : null}
        </View>
        {source && rights ? <NativeVision key={`${source.sourceId}:${source.frameId}:${retry}`} frame={source.frame} onResult={receive} onError={fail} /> : null}
    </View>;
}

const styles = themedStyles(p => ({
    screen: { flex: 1, backgroundColor: p.bg }, top: { padding: ds.space.gutter, gap: ds.space.sm },
    canvas: { flex: 1, justifyContent: 'center', paddingHorizontal: ds.space.sm }, controls: { padding: ds.space.gutter, gap: ds.space.sm, backgroundColor: p.bgElevated1 },
    center: { textAlign: 'center' }, row: { flexDirection: 'row', justifyContent: 'space-between', gap: ds.space.sm },
}));
