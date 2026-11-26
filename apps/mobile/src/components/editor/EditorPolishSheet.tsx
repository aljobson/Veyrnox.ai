import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useOptionalSafeAreaInsets } from '../../lib/safeArea';
import type { Timeline } from '../../lib/nativeEditorModel';
import { studioColors as colors, fonts } from '../../theme';
import { Icon } from '../ui';

type PolishStyle = 'bold' | 'clean' | 'minimal';

export function polishedTimeline(timeline: Timeline, style: PolishStyle): Timeline {
    const text = timeline.text.map(item => style === 'bold'
        ? { ...item, size: Math.max(item.size, 6), style: { ...item.style, weight: '900', color: '#FFFFFF', stroke: '#000000', strokeWidth: 2 }, wordStyle: { mode: 'highlight' as const, color: colors.accent } }
        : style === 'clean'
            ? { ...item, size: Math.max(4, Math.min(item.size, 5)), style: { ...item.style, weight: '700', color: '#FFFFFF', stroke: '#000000', strokeWidth: 1 }, wordStyle: { mode: 'none' as const, color: '#FFFFFF' } }
            : { ...item, size: Math.max(3, Math.min(item.size, 4)), style: { ...item.style, weight: '600', color: '#FFFFFF', strokeWidth: 0, backgroundOpacity: 0 }, wordStyle: { mode: 'none' as const, color: '#FFFFFF' } });
    const scale = style === 'bold' ? 1.05 : style === 'clean' ? 1.02 : 1;
    const video = timeline.video.map(item => ({ ...item, transform: { ...item.transform, scale } }));
    return { ...timeline, text, video };
}

export function EditorPolishSheet({ visible, timeline, onClose, onApply }: { visible: boolean; timeline: Timeline; onClose(): void; onApply(next: Timeline): void }) {
    const insets = useOptionalSafeAreaInsets();
    const [selected, setSelected] = useState<PolishStyle>('bold');
    const stylesList: readonly { id: PolishStyle; icon: 'lightning' | 'sparkle' | 'contrast'; title: string; description: string }[] = [
        { id: 'bold', icon: 'lightning', title: 'Bold', description: 'Thick captions, coloured key words, punchy zooms' },
        { id: 'clean', icon: 'sparkle', title: 'Clean', description: 'Classic captions, subtle zooms, calm title' },
        { id: 'minimal', icon: 'contrast', title: 'Minimal', description: 'Small captions, no zooms, out of the way' },
    ];
    return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} accessibilityViewIsModal>
        <Pressable accessible={false} style={local.backdrop} onPress={onClose} />
        <View style={[local.sheet, { paddingBottom: Math.max(22, (insets?.bottom ?? 0) + 12) }]}>
            <View style={local.grabber} />
            <View style={local.header}><Pressable accessibilityRole="button" accessibilityLabel="Close Polish" onPress={onClose} style={local.close}><Text style={local.closeText}>Close</Text></Pressable><Text accessibilityRole="header" style={local.title}>Polish</Text></View>
            <Text style={local.copy}>Finish your edit in one step. Everything Polish adds is a single undo.</Text>
            <View style={local.options}>{stylesList.map(item => {
                const active = selected === item.id;
                return <Pressable key={item.id} accessibilityRole="radio" accessibilityLabel={item.title} accessibilityState={{ checked: active }} onPress={() => setSelected(item.id)} style={[local.option, active && local.optionActive]}>
                    <Icon name={item.icon} size={28} tint={active ? colors.accent : colors.body} />
                    <View style={local.optionCopy}><Text style={local.optionTitle}>{item.title}</Text><Text style={local.optionDescription}>{item.description}</Text></View>
                    <View style={[local.radio, active && local.radioActive]}>{active ? <Icon name="check" size={20} tint={colors.accentInk} /> : null}</View>
                </Pressable>;
            })}</View>
            <Pressable accessibilityRole="button" accessibilityLabel="Polish Video" onPress={() => { onApply(polishedTimeline(timeline, selected)); onClose(); }} style={local.primary}><Text style={local.primaryText}>Polish Video</Text></Pressable>
        </View>
    </Modal>;
}

const local = StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,.58)' },
    sheet: { gap: 16, paddingHorizontal: 18, paddingTop: 10, borderTopLeftRadius: 28, borderTopRightRadius: 28, borderWidth: 1, borderColor: '#303034', backgroundColor: '#1a1a1c' },
    grabber: { width: 42, height: 5, alignSelf: 'center', borderRadius: 3, backgroundColor: '#c7c3d4' },
    header: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
    close: { position: 'absolute', start: 0, minWidth: 60, minHeight: 44, justifyContent: 'center' },
    closeText: { color: colors.accent, fontSize: 16, fontWeight: '700' },
    title: { color: colors.text, fontFamily: fonts.display, fontSize: 20 },
    copy: { color: colors.muted, fontSize: 15, lineHeight: 22 },
    options: { gap: 10 },
    option: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, borderRadius: 20, borderWidth: 1, borderColor: '#444448', backgroundColor: '#202023' },
    optionActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
    optionCopy: { flex: 1, minWidth: 0 },
    optionTitle: { color: colors.text, fontSize: 19, fontWeight: '900' },
    optionDescription: { color: colors.muted, fontSize: 13, marginTop: 3 },
    radio: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: 15, borderWidth: 2, borderColor: '#77777d' },
    radioActive: { borderColor: colors.accent, backgroundColor: colors.accent },
    primary: { minHeight: 58, alignItems: 'center', justifyContent: 'center', borderRadius: 29, backgroundColor: colors.accent },
    primaryText: { color: colors.accentInk, fontSize: 18, fontWeight: '900' },
});
