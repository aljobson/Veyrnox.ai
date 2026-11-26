import { useState } from 'react';
import { Pressable, View } from 'react-native';
import type { MenuIcon } from '../../lib/menuIcons';
import { ds } from '../../theme';
import { Chip, Icon, Text, themedStyles, useThemedStyles } from '../ui';

export type MusicSmartDirection = Readonly<{
    voice: string;
    genre: string;
    mood: string;
    tempo: string;
    structure: string;
}>;

export const EMPTY_MUSIC_SMART_DIRECTION: MusicSmartDirection = Object.freeze({
    voice: '', genre: '', mood: '', tempo: '', structure: '',
});

type DirectionKey = keyof MusicSmartDirection;
const KEYS: readonly DirectionKey[] = ['voice', 'genre', 'mood', 'tempo'];
const META: Record<DirectionKey, { label: string; icon: MenuIcon }> = {
    voice: { label: 'Voice', icon: 'microphone' },
    genre: { label: 'Genre', icon: 'waveform' },
    mood: { label: 'Mood', icon: 'smiley' },
    tempo: { label: 'Tempo', icon: 'gauge' },
    structure: { label: 'Song structure', icon: 'playlist' },
};
const OPTIONS: Record<DirectionKey, readonly string[]> = {
    voice: ['Female vocal', 'Male vocal', 'Duet', 'Choir', 'Spoken word', 'Instrumental'],
    genre: ['Pop', 'Rock', 'Hip-hop', 'R&B', 'Electronic', 'Cinematic', 'Folk', 'Jazz', 'Classical'],
    mood: ['Uplifting', 'Melancholic', 'Romantic', 'Dark', 'Dreamy', 'Energetic', 'Calm', 'Triumphant'],
    tempo: ['72 BPM · Slow', '84 BPM · Steady', '108 BPM · Driving', '128 BPM · Fast'],
    structure: ['Verse · chorus', 'Verse · pre-chorus · chorus', 'Intro · verse · chorus · bridge · outro', 'Loop / ambient progression'],
};

const smartText = (value: MusicSmartDirection) => (Object.keys(META) as DirectionKey[])
    .map(key => value[key] ? `${META[key].label}: ${value[key]}` : '').filter(Boolean).join('; ');

export function mergeSmartDirectionText(base: string, value: MusicSmartDirection, max: number): string {
    const clean = base.replace(/\n?\[Smart direction: [^\]]*\]\s*$/u, '').trimEnd();
    const summary = smartText(value);
    if (!summary) return clean.slice(0, max);
    const suffix = `[Smart direction: ${summary}]`;
    if (suffix.length >= max) return suffix.slice(0, max);
    return [clean.slice(0, Math.max(0, max - suffix.length - 1)), suffix].filter(Boolean).join('\n');
}

export function MusicSmartDirectionControls({ value, onChange, voiceLocked = false }: {
    value: MusicSmartDirection;
    onChange: (next: MusicSmartDirection) => void;
    voiceLocked?: boolean;
}) {
    const s = useThemedStyles(sheets);
    const [open, setOpen] = useState<DirectionKey | null>(null);
    const visible = (key: DirectionKey) => voiceLocked && key === 'voice' ? 'Instrumental' : value[key] || 'Auto';
    const tileValue = (key: DirectionKey) => visible(key).split(' · ')[0];
    const toggle = (key: DirectionKey) => {
        if (voiceLocked && key === 'voice') return;
        setOpen(current => current === key ? null : key);
    };
    const choose = (next: string) => {
        if (!open) return;
        onChange({ ...value, [open]: next });
        setOpen(null);
    };
    return <View style={s.panel}>
        <View style={s.heading}>
            <Text variant="bodyStrong">Smart direction</Text>
            <Text variant="footnote" tone="tertiary">Optional</Text>
        </View>
        <View accessibilityLabel="Smart music controls" style={s.tiles}>
            {KEYS.map(key => {
                const selected = !!value[key] || (voiceLocked && key === 'voice');
                return <Pressable key={key} accessibilityRole="button" accessibilityLabel={`${META[key].label}: ${visible(key)}`}
                    accessibilityState={{ expanded: open === key, disabled: voiceLocked && key === 'voice' }}
                    disabled={voiceLocked && key === 'voice'} onPress={() => toggle(key)}
                    style={({ pressed }) => [s.tileHit, pressed && s.pressed]}>
                    <View style={[s.iconBox, selected && s.iconSelected]}><Icon name={META[key].icon} size={28} /></View>
                    <Text variant="caption" numberOfLines={1}>{META[key].label}</Text>
                    <Text variant="caption" tone={selected ? 'primary' : 'tertiary'} numberOfLines={2} style={s.tileValue}>{tileValue(key)}</Text>
                </Pressable>;
            })}
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={`Song structure: ${visible('structure')}`}
            accessibilityState={{ expanded: open === 'structure' }} onPress={() => toggle('structure')}
            style={({ pressed }) => [s.structure, pressed && s.pressed]}>
            <Icon name="playlist" size={20} /><Text variant="bodyStrong">Song structure</Text>
            <Text variant="footnote" tone="secondary" numberOfLines={1} style={s.structureValue}>{visible('structure')}</Text>
            <Icon name={open === 'structure' ? 'caretDown' : 'caretRight'} size={16} />
        </Pressable>
        {open ? <View accessibilityRole="radiogroup" accessibilityLabel={`${META[open].label} choices`} style={s.choices}>
            <Chip label="Auto" selected={!value[open]} onPress={() => choose('')} />
            {OPTIONS[open].map(option => <Chip key={option} label={option} selected={value[open] === option} onPress={() => choose(option)} />)}
        </View> : null}
    </View>;
}

const sheets = themedStyles(p => ({
    panel: { gap: ds.space.md, borderRadius: ds.radius.lg, backgroundColor: p.bgElevated1, borderWidth: 1, borderColor: p.borderSubtle, padding: ds.space.md },
    heading: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: ds.space.sm },
    tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: ds.space.sm },
    tileHit: { width: '47%', flexGrow: 1, minWidth: 0, minHeight: 104, alignItems: 'center', gap: 3 },
    iconBox: { width: '100%', maxWidth: 72, aspectRatio: 1, borderRadius: ds.radius.md, backgroundColor: p.surface, borderWidth: 1, borderColor: p.borderSubtle, alignItems: 'center', justifyContent: 'center' },
    iconSelected: { borderColor: p.accent, backgroundColor: p.accentSubtle },
    tileValue: { minHeight: 30, textAlign: 'center' },
    pressed: { opacity: 0.72 },
    structure: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: ds.space.sm, borderRadius: ds.radius.md, backgroundColor: p.surface, paddingHorizontal: ds.space.md },
    structureValue: { flex: 1, textAlign: 'right' },
    choices: { flexDirection: 'row', flexWrap: 'wrap', gap: ds.space.sm, borderTopWidth: 1, borderTopColor: p.borderSubtle, paddingTop: ds.space.md },
}));
