import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { SHOT_LANES, type Film } from '../../lib/filmStudio';
import { newShot, sanitizeShotId, shotIdProblem } from '../../lib/filmStudioOptions';
import { t } from '../../lib/i18n';
import type { CatalogModel } from '../../lib/media';
import { touchTarget } from '../../lib/a11y';
import { colors } from '../../theme';
import { Button } from '../ui';
import { Field } from './FilmFields';
import { FilmSelect } from './FilmSelect';

export function FilmBreakdownStage({ film, change }: { film: Film; change: (film: Film) => void; catalog: readonly CatalogModel[]; live: boolean }) {
    const [selected, setSelected] = useState(0);
    const [draft, setDraft] = useState<string | null>(null);
    const [problem, setProblem] = useState<ReturnType<typeof shotIdProblem>>(null);
    const index = film.shots[selected] ? selected : 0;
    const shot = film.shots[index];
    const errors = { format: t('filmWorkspace.id.format'), duplicate: t('filmWorkspace.id.duplicate'), history: t('filmWorkspace.id.history') };
    const edit = (key: string, value: string | boolean) => change({ ...film, shots: film.shots.map((s, i) => i === index ? { ...s, [key]: value } : s) });
    const resetDraft = () => { setDraft(null); setProblem(null); };
    const commitId = () => {
        if (draft === null || !shot) return;
        const error = shotIdProblem(film, index, draft);
        setProblem(error);
        if (error) return;
        if (draft !== shot.id) change({
            ...film,
            shots: film.shots.map((s, i) => i === index ? { ...s, id: draft } : s),
            prompts: film.prompts.map(p => p.shot === shot.id ? { ...p, shot: draft } : p),
            attempts: film.attempts.map(a => a.shot === shot.id ? { ...a, shot: draft } : a),
        });
        resetDraft();
    };
    const add = () => {
        if (film.shots.length >= 200) return;
        setSelected(film.shots.length); resetDraft();
        change({ ...film, shots: [...film.shots, newShot(film)] });
    };
    return <View style={{ gap: 14 }}>
        <Field label={t('film.scripttreatmentoridea')} value={film.script} onChange={script => change({ ...film, script })} multiline maxLength={24_000} placeholder={t('film.pastethesourcematerialyouarebreaking')} />
        <Text style={{ color: colors.body }}>{t('filmWorkspace.runtime', { value1: film.shots.reduce((sum, s) => sum + (Number(s.seconds) || 0), 0), value2: film.targetSeconds })}</Text>
        {shot ? <FilmSelect label={t('filmWorkspace.shotCards')} value={String(index)} options={film.shots.map((s, i) => ({ value: String(i), label: s.id }))} onChange={v => { setSelected(Number(v)); resetDraft(); }} /> : null}
        <Button label={t('film.addshot')} disabled={film.shots.length >= 200} onPress={add} />
        {shot ? <>
            <Button variant="tertiary" tone="danger" label={t('film.remove')} onPress={() => { change({ ...film, shots: film.shots.filter((_, i) => i !== index) }); setSelected(0); resetDraft(); }} />
            {SHOT_LANES.map(([lane, fields]) => <View key={lane} style={{ gap: 10 }}>
                <Text accessibilityRole="header" style={{ color: colors.accent, fontWeight: '700' }}>{lane}</Text>
                {fields.map(([key, label]) => <Field key={key} label={label} value={key === 'id' ? draft ?? shot.id : String(shot[key] ?? '')}
                    onChange={value => {
                        if (key !== 'id') return edit(key, value);
                        setDraft(sanitizeShotId(value)); setProblem(null);
                    }} onBlur={key === 'id' ? commitId : undefined} onSubmitEditing={key === 'id' ? commitId : undefined}
                    multiline={['description', 'dialogue', 'blocking', 'acting'].includes(key)}
                    hint={['location', 'characters', 'props'].includes(key) ? t('filmWorkspace.assetHint') : key === 'seconds' ? t('filmWorkspace.durationHint') : undefined}
                    error={key === 'id' && problem ? errors[problem] : undefined} />)}
            </View>)}
            <Pressable accessibilityRole="checkbox" accessibilityLabel={t('filmWorkspace.oneAction')} accessibilityState={{ checked: shot.oneAction }}
                style={touchTarget} onPress={() => edit('oneAction', !shot.oneAction)}><Text style={{ color: colors.body }}>{shot.oneAction ? '✓ ' : ''}{t('filmWorkspace.oneAction')}</Text></Pressable>
            <Text accessibilityRole="header" style={{ color: colors.accent, fontWeight: '700' }}>{t('filmWorkspace.textTask')}</Text>
            <Text style={{ color: colors.muted }}>{t('filmWorkspace.textHelp')}</Text>
            <Field label={t('filmWorkspace.exactText')} value={String(shot.text ?? '')} onChange={v => edit('text', v)} />
            {shot.text ? <>
                <Field label={t('filmWorkspace.textPlacement')} value={String(shot.textPlacement ?? '')} onChange={v => edit('textPlacement', v)} />
                <Field label={t('filmWorkspace.textContext')} value={String(shot.textContext ?? '')} onChange={v => edit('textContext', v)} />
            </> : null}
        </> : null}
    </View>;
}
