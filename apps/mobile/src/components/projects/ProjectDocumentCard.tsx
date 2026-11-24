import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { t } from '../../lib/i18n';
import { ASPECT_RATIOS, BRIEF_MAX, FRAME_RATES, REVISION_CAP, customCanvasParts, formatCustomCanvasAspect, type Editable, type Head } from '../../lib/projectDocumentDraft';
import { ds } from '../../theme';
import { Button, Card, SegmentedControl, Text, TextField, themedStyles, useThemedStyles } from '../ui';
import type { ProjectDocumentState } from './useProjectDocument';

const ASPECT_KEYS = { '16:9': 'projectDocument.landscape', '9:16': 'projectDocument.portrait', '1:1': 'projectDocument.square' } as const;
export const aspectLabel = (value: unknown) => {
    if (value === '4:5') return '4:5';
    const custom = customCanvasParts(value);
    if (custom) return `${t('editorTools.custom')} ${custom.width}:${custom.height}`;
    return typeof value === 'string' && value in ASPECT_KEYS ? t(ASPECT_KEYS[value as keyof typeof ASPECT_KEYS]) : '';
};
export const fpsLabel = (value: unknown) => (typeof value === 'number' ? t('projectDocument.fps', { value1: value }) : '');

function statusLine(doc: ProjectDocumentState): string | null {
    if (doc.dropped) return null;
    if (doc.phase === 'restoring') return t('projectDocument.restoring');
    if (doc.phase === 'saving') return t('projectDocument.saving');
    switch (doc.status) {
        case 'conflict': return null;
        case 'offline': return t('projectDocument.offline');
        case 'paused': return t('projectDocument.paused');
        case 'held': return t('projectDocument.held');
        case 'daily_limit': return t('projectDocument.dailyLimit');
        case 'revision_limit': return t('projectDocument.revisionLimit', { value1: REVISION_CAP });
        case 'too_big': return t('projectDocument.tooBig');
        case 'unsupported': return t('projectDocument.unsupported');
        case 'unavailable': return doc.head ? t('projectDocument.saveUnavailable') : t('projectDocument.notAvailable');
        case 'failed': case 'rejected': return t('projectDocument.notSaved');
        default: break;
    }
    if (doc.dirty) return t('projectDocument.unsaved');
    return doc.head && doc.head.revision > 0 ? t('projectDocument.savedVersion', { value1: doc.head.revision }) : t('projectDocument.noChanges');
}

// A locked control is one dimmed element to VoiceOver and TalkBack, and its segments are hidden from them.
function lockedProps(locked: boolean, label: string, value: string, off: object) {
    if (!locked) return { pointerEvents: 'auto' as const };
    return {
        pointerEvents: 'none' as const,
        accessible: true,
        accessibilityLabel: label,
        accessibilityValue: { text: value },
        accessibilityState: { disabled: true },
        importantForAccessibility: 'no-hide-descendants' as const,
        style: off,
    };
}

function Remote({ remote }: { remote: Head }) {
    const canvas = remote.document.canvas as { aspect_ratio?: unknown; frame_rate?: unknown } | undefined;
    return (
        <View style={{ gap: ds.space.xs }}>
            <Text variant="bodyStrong">{t('projectDocument.remoteVersion', { value1: remote.revision })}</Text>
            <Text variant="footnote" tone="secondary">{remote.document.brief || t('projectDocument.noBrief')}</Text>
            <Text variant="footnote">{aspectLabel(canvas?.aspect_ratio)}</Text>
            <Text variant="footnote">{fpsLabel(canvas?.frame_rate)}</Text>
        </View>
    );
}

function ConflictPanel({ doc }: { doc: ProjectDocumentState }) {
    const s = useThemedStyles(sheets);
    const busy = doc.phase !== 'idle' || doc.reviewing;
    return (
        <View style={s.panel}>
            <Text variant="footnote" accessibilityRole="alert">{t('projectDocument.newerSaved')}</Text>
            {doc.remote ? (
                <>
                    <Remote remote={doc.remote} />
                    <Text variant="footnote" tone="secondary">{t('projectDocument.keepVersion')}</Text>
                    <Button variant="secondary" size="md" label={t('projectDocument.useSaved')} disabled={busy} onPress={doc.acceptSaved} />
                    <Button variant="primary" size="md" label={t('projectDocument.saveDraftInstead')} disabled={busy} onPress={() => void doc.saveDraftInstead()} />
                </>
            ) : (
                <Button variant="secondary" size="md" label={t('projectDocument.reviewLatest')} loading={doc.reviewing} disabled={busy} onPress={() => void doc.reviewLatest()} />
            )}
        </View>
    );
}

export function ProjectDocumentCard({ doc }: { doc: ProjectDocumentState }) {
    const s = useThemedStyles(sheets);
    const draft = doc.draft;
    const initialCustom = customCanvasParts(draft?.aspectRatio);
    const [customWidth, setCustomWidth] = useState(() => String(initialCustom?.width ?? 4));
    const [customHeight, setCustomHeight] = useState(() => String(initialCustom?.height ?? 5));
    useEffect(() => {
        const value = customCanvasParts(draft?.aspectRatio);
        if (value) { setCustomWidth(String(value.width)); setCustomHeight(String(value.height)); }
    }, [draft?.aspectRatio]);
    const blocked = doc.status === 'unavailable' || doc.status === 'unsupported' || doc.status === 'revision_limit';
    const locked = !draft || doc.phase === 'restoring' || doc.phase === 'suspended' || doc.status === 'unsupported' || doc.status === 'revision_limit' || (doc.status === 'unavailable' && !doc.head);
    const retryLabel = ['failed', 'offline', 'paused', 'held', 'daily_limit'].includes(doc.status ?? '') ? t('projectDocument.retrySave') : t('projectDocument.saveNow');
    const line = statusLine(doc);
    const pick = <K extends keyof Editable>(key: K, value: Editable[K]) => { if (!locked) doc.edit({ [key]: value } as Partial<Editable>); };
    const custom = customCanvasParts(draft?.aspectRatio), customValue = formatCustomCanvasAspect(customWidth, customHeight);
    return (
        <Card style={s.card}>
            <Text variant="title3" accessibilityRole="header">{t('projectDocument.creating')}</Text>
            <Text variant="footnote" tone="secondary">{t('projectDocument.briefHelp')}</Text>
            {draft ? (
                <>
                    <TextField
                        label={t('projectDocument.brief')}
                        multiline
                        maxLength={BRIEF_MAX}
                        value={draft.brief}
                        editable={!locked}
                        accessibilityState={{ disabled: locked }}
                        onChangeText={(brief) => { if (!locked) doc.edit({ brief }); }}
                        style={s.brief}
                    />
                    <Text variant="caption" tone="tertiary" style={s.counter}>{t('projectDocument.counter', { value1: draft.brief.length, value2: BRIEF_MAX })}</Text>
                    <Text variant="footnote" tone="secondary">{t('projectDocument.aspectRatio')}</Text>
                    <View {...lockedProps(locked, t('projectDocument.aspectRatio'), aspectLabel(draft.aspectRatio), s.off)}>
                        <SegmentedControl
                            accessibilityLabel={t('projectDocument.aspectRatio')}
                            options={[...ASPECT_RATIOS.map((value) => ({ value, label: aspectLabel(value), accessibilityLabel: aspectLabel(value) })),
                                { value: 'custom', label: t('editorTools.custom'), accessibilityLabel: t('editorTools.custom') }]}
                            value={custom ? 'custom' : draft.aspectRatio}
                            onChange={(value) => pick('aspectRatio', value === 'custom' ? customValue ?? 'custom:4x5' : value as Editable['aspectRatio'])}
                        />
                    </View>
                    {custom ? <><View style={s.customRow}><TextField label={t('editorLook.crop.width')} value={customWidth} maxLength={3} keyboardType="number-pad"
                        editable={!locked} onChangeText={setCustomWidth} containerStyle={s.customField} /><TextField label={t('editorLook.crop.height')} value={customHeight} maxLength={3}
                        keyboardType="number-pad" editable={!locked} onChangeText={setCustomHeight} containerStyle={s.customField}
                        error={customValue ? false : '1–100 · 1:4–4:1'} /></View><Button variant="secondary" size="md" label={t('editorAi.apply')}
                        disabled={locked || !customValue} onPress={() => { if (customValue) pick('aspectRatio', customValue); }} /></> : null}
                    <Text variant="footnote" tone="secondary">{t('projectDocument.frameRate')}</Text>
                    <View {...lockedProps(locked, t('projectDocument.frameRate'), fpsLabel(draft.frameRate), s.off)}>
                        <SegmentedControl
                            accessibilityLabel={t('projectDocument.frameRate')}
                            options={FRAME_RATES.map((value) => ({ value: String(value), label: fpsLabel(value), accessibilityLabel: fpsLabel(value) }))}
                            value={String(draft.frameRate)}
                            onChange={(value) => pick('frameRate', Number(value) as Editable['frameRate'])}
                        />
                    </View>
                    <Text variant="caption" tone="tertiary">{t('projectDocument.settingsHelp')}</Text>
                </>
            ) : null}
            {line ? <Text variant="footnote" tone="secondary" accessibilityLiveRegion="polite">{line}</Text> : null}
            {!draft && !doc.loading && doc.status !== 'unsupported' && !doc.dropped ? (
                <Button variant="secondary" size="md" label={t('projectDocument.retry')} onPress={() => void doc.reload()} />
            ) : null}
            {doc.status === 'conflict' && !doc.dropped ? <ConflictPanel doc={doc} /> : draft ? (
                <Button
                    variant="secondary"
                    size="md"
                    label={retryLabel}
                    disabled={blocked || locked || doc.phase !== 'idle' || doc.dropped || (!doc.dirty && doc.status === null)}
                    onPress={doc.saveNow}
                />
            ) : null}
        </Card>
    );
}

const sheets = themedStyles((p) => ({
    card: { gap: ds.space.md, marginBottom: ds.space.md },
    brief: { minHeight: 120, textAlignVertical: 'top' },
    counter: { alignSelf: 'flex-end' },
    off: { opacity: 0.4 },
    customRow: { flexDirection: 'row', gap: ds.space.sm },
    customField: { flex: 1 },
    panel: { gap: ds.space.sm, padding: ds.space.md, borderRadius: ds.radius.md, borderWidth: 1, borderColor: p.borderStrong },
}));
