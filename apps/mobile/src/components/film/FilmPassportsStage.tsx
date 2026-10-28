import { useState } from 'react';
import { Text, View } from 'react-native';
import { Text as StatusText } from '../ui/Text';
import { assetKey, assetType, isLocked, referenceSheet, shotAssets } from '../../lib/filmStudio';
import { t } from '../../lib/i18n';
import { colors } from '../../theme';
import { FilmSelect } from './FilmSelect';
import { FilmAction, FilmInput, FilmPromptOutput, type StageProps } from './FilmPromptOutput';

export function FilmPassportsStage({ film, change, catalog, live }: StageProps) {
    const required = [...new Set(film.shots.flatMap(shotAssets))];
    const [selected, setSelected] = useState(required[0] ?? '');
    const [draft, setDraft] = useState<{ key: string; descriptor: string; references: string } | null>(null);
    const key = required.includes(selected) ? selected : required[0];
    const board = film.boards.find(b => b.name === key), asset = film.assets.find(a => assetKey(a) === key);
    const descriptor = draft?.key === key ? draft.descriptor : asset?.descriptor ?? '';
    const refs = draft?.key === key ? draft.references : asset?.references.join('\n') || board?.references.filter(r => r.kind === 'reference').map(r => r.source).join('\n') || '';
    const locked = isLocked(film, asset), type = board?.type ?? assetType(film, key);
    if (!key) return null;
    const edit = (patch: Partial<NonNullable<typeof draft>>) => { if (!locked) setDraft({ key, descriptor, references: refs, ...patch }); };
    const save = () => {
        if (locked || !descriptor.trim() || !refs.trim()) return;
        const [tag, version] = key.split(':v');
        const next = { tag, version: Number(version), type, descriptor, references: refs.split('\n').map(r => r.trim()).filter(Boolean), tests: {} };
        change({ ...film, assets: asset ? film.assets.map(a => a === asset ? next : a) : [...film.assets, next] }); setDraft(null);
    };
    return <View style={{ gap: 16 }}>
        <FilmSelect label={t('filmOutput.asset')} value={key} options={required.map(value => ({ value, label: value }))} onChange={v => { setSelected(v); setDraft(null); }} />
        <FilmInput label={t('film.canonicaldescriptor')} value={descriptor} onChange={v => edit({ descriptor: v })} disabled={locked} multiline />
        <Text style={{ color: colors.muted }}>{t(type === 'character' ? 'filmOutput.hint.character' : type === 'location' ? 'filmOutput.hint.location' : 'filmOutput.hint.prop')}</Text>
        <FilmInput label={t('film.approvedreferencefiles')} value={refs} onChange={v => edit({ references: v })} disabled={locked} multiline />
        <FilmAction label={t('filmOutput.savePassport')} disabled={locked || !descriptor.trim() || !refs.trim()} onPress={save} />
        {asset ? <><StatusText variant="inherit" accessibilityLiveRegion="polite" style={{ color: colors.body }}>{key} · {t(locked ? 'filmOutput.locked' : 'filmOutput.draft')}</StatusText>
            {locked ? <Text style={{ color: colors.muted }}>{t('filmOutput.newVersion')}</Text> : <FilmPromptOutput title={t('filmOutput.referenceSheet')} prompt={referenceSheet(asset)} modelId={film.stack.image} access={film.stack.imageAccess} catalog={catalog} live={live} />}</> : null}
    </View>;
}
