import { Text, View } from 'react-native';
import { ds } from '../../../theme';
import { plural, t } from '../../../lib/i18n';
import { Action, PanelHeading } from '../EditorControls';
import { SegmentedChoice } from './SegmentedChoice';
import type { EditorSpeechCaptionActions, EditorSpeechCaptionError } from './useEditorSpeechCaptions';
import { styles } from '../fullEditorStyles';

const languages = ['en', 'es', 'fr', 'de', 'pt', 'zh', 'hi', 'ar', 'ja', 'ko', 'ru'] as const;
const locale = (value: typeof languages[number]) => value === 'en' ? 'en-US' : value;
const language = (value: string) => (value.split('-')[0] || 'en') as typeof languages[number];
const errorKey = (error: EditorSpeechCaptionError) => error === 'source-unavailable' ? 'editorSpeech.autoSource'
    : error === 'unsupported-edit' ? 'editorSpeech.autoEdit'
    : error === 'permission-denied' || error === 'permission-restricted' || error === 'permission-revoked' ? 'editorSpeech.autoPermission'
    : error === 'unsupported-platform' || error === 'module-missing' || error === 'on-device-unavailable' ? 'editorSpeech.autoUnavailable'
    : error === 'stale' ? 'editorSpeech.autoStale' : error === 'timeline-full' ? 'editorSpeech.autoFull' : 'editorSpeech.autoFailed';

export function AutomaticCaptionsSection({ actions }: { actions: EditorSpeechCaptionActions }) {
    const busy = ['checking', 'requesting-permission', 'transcribing', 'translating', 'applying'].includes(actions.status);
    const status = actions.status === 'checking' ? t('editorScenes.checking') : actions.status === 'requesting-permission' ? t('editorSpeech.autoPermissionRequest')
        : actions.status === 'transcribing' ? t('editorSpeech.transcribing') : actions.status === 'translating' ? t('editorSpeech.autoTranslating')
        : actions.status === 'applying' ? t('editorSpeech.autoApplying') : null;
    const available = actions.boundedAudioReady && actions.capability.platform === 'ios' && actions.capability.automaticCaptions && actions.capability.onDeviceRecognition;
    return <View style={{ gap: ds.space.sm }}>
        <PanelHeading title={t('editorSpeech.autoTitle')} detail={t('editorSpeech.autoHelp')} />
        <SegmentedChoice label={t('editorSpeech.autoSourceLanguage')} value={language(actions.sourceLocale)}
            options={languages.map(value => ({ value, label: t(`bestCut.language.${value}`) }))}
            onChange={value => actions.setSourceLocale(locale(value as typeof languages[number]))} />
        {actions.capability.translation ? <SegmentedChoice label={t('editorSpeech.autoTargetLanguage')} value={language(actions.targetLocale)}
            options={languages.filter(value => locale(value) !== actions.sourceLocale).map(value => ({ value, label: t(`bestCut.language.${value}`) }))}
            onChange={value => actions.setTargetLocale(locale(value as typeof languages[number]))} /> : null}
        {status ? <Text accessibilityRole="progressbar" accessibilityLiveRegion="polite" style={styles.panelDetail}>{status}</Text> : null}
        {actions.error ? <Text accessibilityRole="alert" style={styles.problem}>{t(errorKey(actions.error))}</Text> : null}
        {actions.status === 'done' && actions.added ? <Text accessibilityLiveRegion="polite" style={styles.panelDetail}>{plural('editorCaptionTools.added', actions.added)}</Text> : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: ds.space.sm }}>
            <Action label={t('editorSpeech.autoStart')} disabled={busy || !available} onPress={actions.generate} />
            <Action label={t('editorSpeech.autoTranslate')} disabled={busy || !available || !actions.capability.translation} onPress={actions.translate} />
            {busy && actions.status !== 'checking' ? <Action label={t('editorScenes.cancel')} onPress={actions.cancel} /> : null}
        </View>
        {!busy && !available ? <Text style={styles.panelDetail}>{t('editorSpeech.autoUnavailable')}</Text> : null}
    </View>;
}
