import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { AccessibilityInfo, Keyboard, Pressable, Text, TextInput, View } from 'react-native';
import { SHOT_LANES, type Film } from '../../lib/filmStudio';
import { fillShotDefaults, newShot, sanitizeShotId, shotIdProblem, shotNeeds } from '../../lib/filmStudioOptions';
import { t } from '../../lib/i18n';
import type { CatalogModel } from '../../lib/media';
import { touchTarget } from '../../lib/a11y';
import { GENERATION_PROMPT_MAX } from '../../lib/promptLimits';
import { colors } from '../../theme';
import { Button } from '../ui';
import { Field } from './FilmFields';
import { FilmSelect } from './FilmSelect';

export function FilmBreakdownStage({ film, change, scrollTo }: { film: Film; change: (film: Film) => void; catalog: readonly CatalogModel[]; live: boolean; scrollTo?: (y: number) => void }) {
    const spots = useRef<Record<string, number>>({}), locationInput = useRef<ComponentRef<typeof TextInput>>(null), laneOfLocation = useRef('');
    const [selected, setSelected] = useState(0);
    const [draft, setDraft] = useState<string | null>(null);
    const [filledNote, setFilledNote] = useState<{ filled: number; remaining: number } | null>(null);
    const [problem, setProblem] = useState<ReturnType<typeof shotIdProblem>>(null);
    const index = film.shots[selected] ? selected : 0;
    const shot = film.shots[index];
    const errors = { format: t('filmWorkspace.id.format'), duplicate: t('filmWorkspace.id.duplicate'), history: t('filmWorkspace.id.history') };
    const needs = shot ? shotNeeds(shot) : [];
    const needsYou = needs.length > 0;
    const canFill = !!shot && fillShotDefaults(film, index).filled > 0;
    const jump = (what: 'location' | 'oneAction') => () => {
        Keyboard.dismiss(); const y = what === 'location' ? (spots.current[`lane:${laneOfLocation.current}`] ?? 0) + (spots.current.field ?? 0) : spots.current.oneAction ?? 0;
        scrollTo?.(Math.max(0, (spots.current.root ?? 0) + y - 12));
        if (what === 'location') locationInput.current?.focus();
    };
    const filledMessage = filledNote ? filledNote.filled && filledNote.remaining
        ? t('filmWorkspace.defaultsFilledRemaining', { value1: filledNote.filled, value2: filledNote.remaining })
        : filledNote.filled ? t('filmWorkspace.defaultsFilled', { value1: filledNote.filled })
            : filledNote.remaining ? t('filmWorkspace.defaultsRemaining', { value1: filledNote.remaining }) : t('filmWorkspace.defaultsNone') : null;
    useEffect(() => {
        if (!filledMessage) return;
        const timer = setTimeout(() => AccessibilityInfo.announceForAccessibility(filledMessage), 100);
        return () => clearTimeout(timer);
    }, [filledNote, filledMessage]);
    // Buttons do not take focus from a text box, so a box typed in earlier (the script) would keep the keyboard and swallow the next typing.
    const act = (run: () => void) => () => { Keyboard.dismiss(); run(); };
    const edit = (key: string, value: string | boolean) => { setFilledNote(null); change({ ...film, shots: film.shots.map((s, i) => i === index ? { ...s, [key]: value } : s) }); };
    const resetIdentityDraft = () => { setDraft(null); setProblem(null); };
    const resetSelection = () => { resetIdentityDraft(); setFilledNote(null); };
    const fillDefaults = () => {
        const result = fillShotDefaults(film, index);
        setFilledNote({ filled: result.filled, remaining: result.remaining });
        if (result.filled) change(result.film);
    };
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
        resetIdentityDraft();
    };
    const add = () => {
        if (film.shots.length >= 200) return;
        setSelected(film.shots.length); resetSelection();
        change({ ...film, shots: [...film.shots, newShot(film)] });
    };
    return <View style={{ gap: 14 }} onLayout={event => { spots.current.root = event.nativeEvent.layout.y; }}>
        <Field label={t('film.scripttreatmentoridea')} value={film.script} onChange={script => { setFilledNote(null); change({ ...film, script }); }} multiline maxLength={GENERATION_PROMPT_MAX} placeholder={t('film.pastethesourcematerialyouarebreaking')} />
        <Text style={{ color: colors.body }}>{t('filmWorkspace.runtime', { value1: film.shots.reduce((sum, s) => sum + (Number(s.seconds) || 0), 0), value2: film.targetSeconds })}</Text>
        {shot ? <FilmSelect label={t('filmWorkspace.shotCards')} value={String(index)} options={film.shots.map((s, i) => ({ value: String(i), label: t('filmWorkspace.shotLabel', { value1: i + 1 }) }))} onChange={v => { Keyboard.dismiss(); setSelected(Number(v)); resetSelection(); }} /> : null}
        <Button label={t('film.addshot')} disabled={film.shots.length >= 200} onPress={act(add)} />
        {shot ? <>
            <Button variant={canFill ? 'primary' : 'secondary'} label={t('filmWorkspace.fillDefaults')} onPress={act(fillDefaults)} />
            <Text style={{ color: colors.muted }}>{t('filmWorkspace.fillDefaultsHelp')}</Text>
            {needsYou ? <View style={{ gap: 6 }}>
                <Text accessibilityRole="header" style={{ color: colors.accent, fontWeight: '700' }}>{t('filmWorkspace.stillToFill')}</Text>
                {needs.map(what => <Pressable key={what} accessibilityRole="button" accessibilityLabel={t(what === 'location' ? 'filmWorkspace.needLocation' : 'filmWorkspace.needOneAction')}
                    style={touchTarget} onPress={jump(what)}><Text style={{ color: colors.body }}>• {t(what === 'location' ? 'filmWorkspace.needLocation' : 'filmWorkspace.needOneAction')}</Text></Pressable>)}
            </View> : null}
            {filledMessage ? <Text style={{ color: colors.muted }}>{filledMessage}</Text> : null}
            <Button variant="tertiary" tone="danger" label={t('film.remove')} onPress={act(() => { change({ ...film, shots: film.shots.filter((_, i) => i !== index) }); setSelected(0); resetSelection(); })} />
            {SHOT_LANES.map(([lane, fields]) => <View key={lane} style={{ gap: 10 }} onLayout={event => { spots.current[`lane:${lane}`] = event.nativeEvent.layout.y; }}>
                <Text accessibilityRole="header" style={{ color: colors.accent, fontWeight: '700' }}>{lane}</Text>
                {fields.map(([key, label]) => <View key={key} onLayout={event => { if (key === 'location') { spots.current.field = event.nativeEvent.layout.y; laneOfLocation.current = lane; } }}><Field label={label} value={key === 'id' ? draft ?? shot.id : String(shot[key] ?? '')}
                    onChange={value => {
                        if (key !== 'id') return edit(key, value);
                        setDraft(sanitizeShotId(value)); setProblem(null); setFilledNote(null);
                    }} onBlur={key === 'id' ? commitId : undefined} onSubmitEditing={key === 'id' ? commitId : undefined}
                    multiline={['description', 'dialogue', 'blocking', 'acting'].includes(key)}
                    hint={['location', 'characters', 'props'].includes(key) ? t('filmWorkspace.assetHint') : key === 'seconds' ? t('filmWorkspace.durationHint') : undefined}
                    error={key === 'id' && problem ? errors[problem] : undefined} inputRef={key === 'location' ? locationInput : undefined} /></View>)}
            </View>)}
            <Pressable onLayout={event => { spots.current.oneAction = event.nativeEvent.layout.y; }} accessibilityRole="checkbox" accessibilityLabel={t('filmWorkspace.oneAction')} accessibilityState={{ checked: shot.oneAction }}
                style={touchTarget} onPress={() => { Keyboard.dismiss(); edit('oneAction', !shot.oneAction); }}><Text style={{ color: colors.body }}>{shot.oneAction ? '✓ ' : ''}{t('filmWorkspace.oneAction')}</Text></Pressable>
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
