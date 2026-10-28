import { Platform, ScrollView, Share, View } from 'react-native';
import { parseMarkdown, safeHref, type Inline } from '../../lib/chatMarkdown';
import { t } from '../../lib/i18n';
import { touchTarget } from '../../lib/a11y';
import { Button, Text, themedStyles, useThemedStyles } from '../ui';

export async function shareReplyLink(raw: string): Promise<void> {
    const href = safeHref(raw);
    if (href) await Share.share({ message: href }).catch(() => undefined);
}
export async function shareCode(text: string): Promise<void> { await Share.share({ message: text }).catch(() => undefined); }
export function replyActions(content: string) {
    const actions: { name: string; label: string; run: () => Promise<void> }[] = [];
    let links = 0, codes = 0;
    for (const block of parseMarkdown(content)) {
        if (block.type === 'code') actions.push({ name: `code-${codes++}`, label: t('chatDepth.copyCode'), run: () => shareCode(block.text) });
        else {
            const inline = 'inline' in block ? block.inline : block.items.flat();
            for (const node of inline) if (node.t === 'link' && node.href) actions.push({ name: `link-${links++}`, label: t('chatDepth.openLink', { label: node.v }), run: () => shareReplyLink(node.href!) });
        }
    }
    return actions;
}
export function ChatText({ content }: { content: string }) {
    const styles = useThemedStyles(sheets);
    const inline = (nodes: Inline[], heading = false) => nodes.map((node, i) => (
        <Text key={i} style={[heading && styles.bold, node.t === 'code' ? styles.mono : node.t === 'strong' ? styles.bold : node.t === 'link' ? styles.link : undefined]}
            accessibilityRole={node.t === 'link' ? 'link' : undefined} accessibilityLabel={node.t === 'link' ? t('chatDepth.openLink', { label: node.v }) : undefined} onPress={node.t === 'link' ? () => void shareReplyLink(node.href!) : undefined}>{node.v}</Text>
    ));
    return <>{parseMarkdown(content).map((block, i) => {
        if (block.type === 'code') return <View key={i} style={styles.code}>
            <ScrollView horizontal keyboardShouldPersistTaps="handled"><Text selectable style={styles.mono}>{block.text}</Text></ScrollView>
            <Button variant="tertiary" label={t('chatDepth.copyCode')} accessibilityLabel={t('chatDepth.copyCode')} containerStyle={touchTarget} onPress={() => void shareCode(block.text)} />
        </View>;
        if ('items' in block) return <View key={i} style={styles.block}>{block.items.map((row, n) => <Text key={n} selectable>{block.type === 'ul' ? '• ' : `${n + 1}. `}{inline(row)}</Text>)}</View>;
        return <Text key={i} selectable style={[styles.block, block.type === 'h' && styles.bold]}>{inline(block.inline, block.type === 'h')}</Text>;
    })}</>;
}
const sheets = themedStyles(p => ({
    block: { marginBottom: 6 },
    bold: { fontWeight: '700' },
    mono: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
    link: { color: p.accent, textDecorationLine: 'underline' },
    code: { backgroundColor: p.bg, borderRadius: 8, padding: 10, marginVertical: 6 },
}));
