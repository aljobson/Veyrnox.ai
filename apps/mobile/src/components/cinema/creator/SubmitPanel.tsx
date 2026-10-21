import { useRef, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { ApiError } from '../../../lib/api';
import { bodyKeys, CINEMA_RATINGS, CINEMA_WARNING_CODES, creatorMessage, jsonWrite, MALWARE_TEXT, RIGHTS_TEXT, SAFETY_TEXT, submitBody, type CreatorTitle } from '../../../lib/cinemaDrafts';
import { t } from '../../../lib/i18n';
import { Action, Check, CreatorClosed, ui, useCreatorScope } from './RulesLinks';

export function SubmitPanel({ title, onDone }: { title: CreatorTitle; onDone(): void }) {
    const { api } = useAuth(), scope = useCreatorScope();
    const [rating, setRating] = useState(''), [warnings, setWarnings] = useState<string[]>([]), [checks, setChecks] = useState([false, false, false]);
    const [busy, setBusy] = useState(false), [hidden, setHidden] = useState(false), [note, setNote] = useState('');
    const keys = useRef(bodyKeys()).current, sending = useRef(false);
    const submit = async () => {
        if (!scope.live() || sending.current || !checks.every(Boolean) || !rating) return;
        sending.current = true; setBusy(true); const body = submitBody(title.id, rating, warnings);
        try {
            await jsonWrite(api, '/api/v1/cinema/content/submit', body, keys.for(body)); if (!scope.live()) return;
            keys.finish(body); onDone();
        } catch (e) {
            if (!scope.live()) return;
            keys.finish(body, e); setNote(creatorMessage(e));
            if (e instanceof ApiError && e.code === 'publishing_not_open') setHidden(true);
            if (e instanceof ApiError && e.code === 'already_submitted') onDone();
        } finally { if (scope.live()) { sending.current = false; setBusy(false); } }
    };
    if (hidden) return <Text style={ui.text}>{t('cinemaUpload.closed')}</Text>;
    if (note === 'cinemaUpload.role') return <CreatorClosed message={note} />;
    return <View style={ui.card}>
        <Text style={ui.heading} accessibilityRole="header">{t('cinemaUpload.submit')}</Text>
        <Text style={ui.heading} accessibilityRole="header">{t('cinemaUpload.rating')}</Text>
        {CINEMA_RATINGS.map(([code, label]) => <Check key={code} label={label} checked={rating === code} disabled={busy} onPress={() => setRating(code)} />)}
        <Text style={ui.heading} accessibilityRole="header">{t('cinemaUpload.warnings')}</Text>
        {CINEMA_WARNING_CODES.map(([code, label]) => <Check key={code} label={label} checked={warnings.includes(code)} disabled={busy} onPress={() => setWarnings(w => w.includes(code) ? w.filter(x => x !== code) : [...w, code])} />)}
        <Text style={ui.heading} accessibilityRole="header" accessibilityLanguage="en">{t('cinemaUpload.declarations')}</Text>
        {[RIGHTS_TEXT, SAFETY_TEXT, MALWARE_TEXT].map((label, i) => <Check key={i} english label={label} checked={checks[i]} disabled={busy} onPress={() => setChecks(c => c.map((value, j) => j === i ? !value : value))} />)}
        {note ? <Text style={ui.text}>{t(note)}</Text> : null}
        <Action label={t('cinemaUpload.submit')} disabled={busy || !rating || !checks.every(Boolean)} onPress={() => Alert.alert(t('cinemaUpload.submit'), t('cinemaUpload.submitConfirm', { title: title.title }), [
            { text: t('cinemaUpload.keep'), style: 'cancel' }, { text: t('cinemaUpload.submit'), onPress: () => void submit() },
        ])} />
    </View>;
}
