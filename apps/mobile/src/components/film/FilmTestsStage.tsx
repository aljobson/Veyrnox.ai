import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Text as StatusText } from '../ui/Text';
import { assetKey, isLocked, lockAsset, testMatrix, testPrompt } from '../../lib/filmStudio';
import { displayLabel } from '../../lib/displayLabels';
import { t } from '../../lib/i18n';
import { colors } from '../../theme';
import { FilmSelect } from './FilmSelect';
import { FilmAction, FilmInput, FilmPromptOutput, type StageProps } from './FilmPromptOutput';

export function FilmTestsStage({ film, change, catalog, live }: StageProps) {
    const [selected, setSelected] = useState(''), [error, setError] = useState('');
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});
    const asset = film.assets.find(a => assetKey(a) === selected) ?? film.assets[0];
    if (!asset) return null;
    const rows = testMatrix(film, asset), locked = isLocked(film, asset);
    const score = rows.filter(r => asset.tests[r.id]?.verdict === 'pass' && asset.tests[r.id]?.result.trim()).length;
    const edit = (id: string, patch: { result?: string; verdict?: string }) => {
        if (locked) return;
        const { lock: _lock, ...draft } = asset;
        change({ ...film, assets: film.assets.map(a => a === asset ? { ...draft, tests: { ...draft.tests, [id]: { ...(draft.tests[id] ?? { result: '', verdict: 'pending' }), ...patch } } } : a) });
    };
    return <View style={{ gap: 16 }}>
        <FilmSelect label={t('filmOutput.testAsset')} value={assetKey(asset)} options={film.assets.map(a => ({ value: assetKey(a), label: `${assetKey(a)} · ${t(isLocked(film, a) ? 'film.locked' : 'film.draft')}` }))} onChange={v => { setSelected(v); setExpanded({}); setError(''); }} />
        <StatusText variant="inherit" accessibilityLiveRegion="polite" style={{ color: colors.body }}>{assetKey(asset)} · {t(locked ? 'filmOutput.locked' : 'filmOutput.draft')} · {t('filmOutput.passed', { value1: score, value2: rows.length })}</StatusText>
        {asset.type === 'character' ? <Text style={{ color: colors.muted }}>{t('filmOutput.characterTest')}</Text> : null}
        {rows.map((row, i) => {
            const open = expanded[row.id] ?? i === 0, test = asset.tests[row.id] ?? { result: '', verdict: 'pending' };
            return <View key={row.id} style={{ gap: 12 }}>
                <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} style={{ minHeight: 44, justifyContent: 'center' }} onPress={() => setExpanded(v => ({ ...v, [row.id]: !open }))}>
                    <Text style={{ color: colors.text }}>{row.id} · {row.angle} · {row.size} · {row.shot}{row.pair ? ` · ${row.pair}` : ''} · {displayLabel(test.verdict)}</Text></Pressable>
                {open ? <><FilmPromptOutput title={t('filmOutput.testPrompt', { value1: i + 1 })} prompt={testPrompt(film, asset, row)} modelId={film.stack.image} access={film.stack.imageAccess} catalog={catalog} live={live} />
                    <FilmInput label={t('film.actualoutputreference')} value={test.result} disabled={locked} onChange={result => edit(row.id, { result })} />
                    {['pending', 'pass', 'miss'].map(verdict => <Pressable key={verdict} accessibilityRole="radio" accessibilityLabel={displayLabel(verdict)} accessibilityState={{ selected: test.verdict === verdict, disabled: locked }} disabled={locked} style={{ minHeight: 44, justifyContent: 'center' }} onPress={() => edit(row.id, { verdict })}><Text style={{ color: colors.body }}>{displayLabel(verdict)}</Text></Pressable>)}</> : null}
            </View>;
        })}
        {error ? <StatusText variant="inherit" accessibilityRole="alert" style={{ color: colors.danger }}>{error}</StatusText> : null}
        <FilmAction label={t('film.lockaftereverytestpasses')} disabled={locked || score !== rows.length} onPress={() => { try { change(lockAsset(film, assetKey(asset))); setError(''); } catch (e) { setError((e as Error).message); } }} />
    </View>;
}
