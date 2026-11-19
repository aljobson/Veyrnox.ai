import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { Button, Text, themedStyles, useThemedStyles } from '../ui';
import { VeyLoader } from '../VeyLoader';
import { useMusicPlayer } from '../../lib/music/useMusicPlayer';
import type { PlaybackInput } from '../../lib/music/player';
import { t } from '../../lib/i18n';
import { ds } from '../../theme';
import { useAnnouncement } from '../../lib/useAnnouncement';

export function MusicPlayer({ input, onDuration, autoPlay = false }: { input: PlaybackInput; onDuration?: (seconds: number) => void; autoPlay?: boolean }) {
    const s = useThemedStyles(sheets);
    const player = useMusicPlayer();
    const { state } = player;
    const play = useRef(player.play);
    play.current = player.play;
    useEffect(() => {
        if (autoPlay) void play.current(input);
    }, [autoPlay, input]);
    useEffect(() => { if (state.duration > 0) onDuration?.(state.duration); }, [onDuration, state.duration]);
    const message = t(`music.player.${state.state}`);
    useAnnouncement(message, { everywhere: true });
    return <View style={s.box}>
        <Text variant="callout">{message}</Text>
        {state.state === 'loading' ? <VeyLoader label={message} showLabel /> : null}
        {state.retryAt ? <Text variant="footnote">{t('music.cooldown')}</Text> : null}
        <Text variant="footnote" tone="secondary">{t('music.progress', { position: Math.floor(Math.max(0, state.position - input.start)), duration: Math.floor(Math.max(0, (input.end ?? state.duration) - input.start)) })}</Text>
        <Button icon={state.state === 'playing' ? 'pauseCircle' : state.state === 'error' || state.state === 'held' ? undefined : 'play'} label={t(state.state === 'playing' ? 'music.pause' : state.state === 'error' || state.state === 'held' ? 'music.retry' : 'music.play')}
            disabled={state.state === 'loading'} onPress={() => state.state === 'playing' ? player.pause() : void player.play(input)} />
        <View style={s.controls}>
            <Button variant="secondary" icon="seekBack" label={t('music.back10')} onPress={() => void player.seek(state.position - 10)} disabled={state.state === 'idle' || state.state === 'loading'} />
            <Button variant="secondary" icon="seekForward" label={t('music.forward10')} onPress={() => void player.seek(state.position + 10)} disabled={state.state === 'idle' || state.state === 'loading'} />
        </View>
        <Text variant="footnote" tone="secondary">{t('music.foreground')}</Text>
    </View>;
}
const sheets = themedStyles(() => ({ box: { gap: ds.space.md }, controls: { flexDirection: 'row', flexWrap: 'wrap', gap: ds.space.sm } }));
