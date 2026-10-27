import { Fragment, useRef, type ReactNode } from 'react';
import { Linking, ScrollView, View, type ScrollViewInstance, type ViewInstance, type TextInstance } from 'react-native';
import { Text, Button, themedStyles, useThemedStyles } from '../ui';
import { fill, getLocale } from '../../lib/i18n';
import { isolateNumbers, legalData, legalDocs, legalLink, legalUpdated, type LegalBlock, type LegalDoc } from '../../lib/legal';
import { ds } from '../../theme';

export type LegalLocation = { doc: LegalDoc; locale?: string; anchor?: string };
type Props = LegalLocation & { onNavigate(location: LegalLocation): void };
export function LegalDocumentView({ locale = getLocale(), ...props }: Props) {
    // Reset scroll and measurement state for every destination, including sheet Back.
    return <Document key={`${props.doc}:${locale}:${props.anchor ?? ''}`} {...props} locale={locale} />;
}
function Document({ doc, locale = getLocale(), anchor, onNavigate }: Props) {
    const styles = useThemedStyles(sheets);
    const scroll = useRef<ScrollViewInstance>(null);
    const content = useRef<ViewInstance>(null);
    const destination = useRef<ViewInstance | TextInstance | null>(null);
    const positioned = useRef(false);
    function scrollToAnchor() {
        if (positioned.current || !scroll.current || !content.current) return;
        if (!destination.current) {
            scroll.current.scrollTo({ y: 0, animated: false });
            return;
        }
        destination.current.measureLayout(content.current, (_x, y) => {
            scroll.current?.scrollTo({ y, animated: false });
            positioned.current = true;
        }, () => scroll.current?.scrollTo({ y: 0, animated: false }));
    }
    const data = legalData(doc, locale);
    const numeric = (text: string) => isolateNumbers(text, data.locale);
    function render(block: LegalBlock, key: string | number): ReactNode {
        const anchorProps = anchor && block.attrs?.id === anchor ? { ref: (node: ViewInstance | TextInstance | null) => { destination.current = node; }, nativeID: anchor } : {};
        if (block.children) return <View key={key} {...anchorProps} style={styles.list}>{block.children.map(render)}</View>;
        const slots: Record<string, ReactNode> = Object.fromEntries(Object.entries(block.slots ?? {}).map(([id, child]) => [id, render(child, id)]));
        for (const [id, value] of Object.entries(data.entity)) slots[id] = numeric(value);
        let text = data.messages[block.key ?? ''] ?? '';
        if (data.locale !== 'en' && text.includes(data.supply)) {
            text = text.replace(data.supply, '{supplyStatement}');
            slots.supplyStatement = <Text accessibilityLanguage="en" style={styles.ltr}>{'\u2066'}{data.supply}{'\u2069'}</Text>;
        }
        const parts = text.split(/(\{\w+\})/g).map((part, i) => <Fragment key={i}>{/^\{\w+\}$/.test(part) ? slots[part.slice(1, -1)] ?? part : numeric(part)}</Fragment>);
        if (block.tag === 'a') {
            const target = legalLink(fill(block.attrs?.href ?? '', data.entity), doc);
            if (target.kind === 'plain') return <Text key={key} {...anchorProps} selectable>{parts} ({numeric(target.href)})</Text>;
            return <Text key={key} {...anchorProps} selectable accessibilityRole="link" style={styles.link}
                onPress={() => target.kind === 'legal' ? onNavigate({ doc: target.doc, locale: data.locale, anchor: target.anchor }) : void Linking.openURL(target.href).catch(() => undefined)}>{parts}</Text>;
        }
        return <Text key={key} {...anchorProps} selectable variant={block.tag === 'h2' ? 'title3' : block.tag === 'strong' ? 'bodyStrong' : 'body'}
            style={[block.tag === 'em' && styles.emphasis, (block.tag === 'p' || block.tag === 'li' || block.tag === 'h2') && styles.block]}>
            {block.tag === 'li' ? '• ' : ''}{parts}
        </Text>;
    }
    const updated = legalUpdated(data.updated, data.locale, data.tag);
    const company = fill(data.chrome.company, { ...data.entity, updated });
    return <ScrollView ref={scroll} onContentSizeChange={scrollToAnchor} style={styles.screen} contentContainerStyle={styles.content}>
        <View ref={content} collapsable={false} style={data.locale === 'ar' ? styles.rtl : styles.ltr} accessibilityLanguage={data.tag}>
            <Text variant="title1" selectable>{data.messages.title}</Text>
            <Text variant="footnote" tone="secondary" selectable style={styles.block}>{numeric(company)}</Text>
            {data.locale !== 'en' && <View style={styles.notice}>
                <Text variant="title3">{data.chrome.translation}</Text>
                <Text selectable>{data.chrome.notice}</Text>
                <Button variant="tertiary" accessibilityRole="link" label={data.chrome.english} onPress={() => onNavigate({ doc, locale: 'en', anchor })} />
            </View>}
            {data.blocks.map(render)}
            <View style={styles.navigation}>
                <Text variant="title3">{data.chrome.nav}</Text>
                {legalDocs.filter(item => item !== doc).map(item => <Button key={item} variant="tertiary" accessibilityRole="link" label={data.chrome[item]} onPress={() => onNavigate({ doc: item, locale: data.locale })} />)}
            </View>
        </View>
    </ScrollView>;
}
const sheets = themedStyles(p => ({
    screen: { flex: 1, backgroundColor: p.bg },
    content: { padding: ds.space.lg, paddingBottom: ds.space.xl },
    block: { marginTop: ds.space.md },
    list: { paddingStart: ds.space.md },
    link: { color: p.accent, textDecorationLine: 'underline' },
    emphasis: { fontStyle: 'italic' },
    notice: { gap: ds.space.sm, paddingVertical: ds.space.md },
    navigation: { marginTop: ds.space.xl, gap: ds.space.sm },
    rtl: { direction: 'rtl' }, ltr: { direction: 'ltr' },
}));
