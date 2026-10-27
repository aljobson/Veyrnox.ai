import { useState } from 'react';
import { Text, View } from 'react-native';
import { assetType, boardIssues, shotAssets, STYLE_BOARDS, type Board, type Film } from '../../lib/filmStudio';
import { boardId } from '../../lib/filmStudioOptions';
import { t } from '../../lib/i18n';
import type { CatalogModel } from '../../lib/media';
import { colors } from '../../theme';
import { Button } from '../ui';
import { Field } from './FilmFields';
import { FilmSelect } from './FilmSelect';

const parseReferences = (text: string): Board['references'] => text.split('\n').filter(line => line.trim()).map(line => {
    const [raw, ...caption] = line.split('|');
    const anti = raw.trim().startsWith('!');
    return { source: raw.trim().replace(/^!\s*/, ''), caption: caption.join('|').trim(), kind: anti ? 'anti-reference' : 'reference' };
});
export function FilmBoardsStage({ film, change }: { film: Film; change: (film: Film) => void; catalog: readonly CatalogModel[]; live: boolean }) {
    const [selected, setSelected] = useState('');
    const board = film.boards.find(b => b.id === selected) ?? film.boards[0];
    const edit = (patch: Partial<Board>) => change({ ...film, boards: film.boards.map(b => b === board ? { ...b, ...patch } : b) });
    const labels: Record<string, string> = { revise: t('filmWorkspace.revise'), approved: t('filmWorkspace.approved'), rejected: t('filmWorkspace.rejected') };
    const decisions = Object.entries(labels).map(([value, label]) => ({ value, label }));
    const addMissing = () => {
        const required = [...new Set(film.shots.flatMap(shotAssets))].map(name => ({ name, type: assetType(film, name) }));
        required.push(...STYLE_BOARDS.map(name => ({ name, type: 'style' })));
        const taken: string[] = [];
        const additions = required.filter(n => !film.boards.some(b => b.name === n.name && b.type === n.type)).map(n => {
            const id = boardId(film, n.name, n.type, taken); taken.push(id);
            return { ...n, id, decision: 'revise', references: [] };
        });
        change({ ...film, boards: [...film.boards, ...additions] });
    };
    return <View style={{ gap: 14 }}>
        <Text style={{ color: colors.muted }}>{t('filmWorkspace.boardsHelp')}</Text>
        <Button label={t('film.createmissingboards')} onPress={addMissing} />
        {board ? <>
            <FilmSelect label={t('filmWorkspace.board')} value={board.id} options={film.boards.map(b => ({ value: b.id, label: `${b.name} · ${labels[b.decision] ?? labels.revise}` }))} onChange={setSelected} />
            <Field label={t('film.references')} multiline value={board.references.map(r => `${r.kind === 'anti-reference' ? '! ' : ''}${r.source} | ${r.caption}`).join('\n')}
                hint={t('filmWorkspace.referencesHint')} onChange={v => edit({ references: parseReferences(v), decision: 'revise' })} />
            <FilmSelect label={t('filmWorkspace.decision')} value={board.decision || 'revise'} options={decisions} onChange={decision => edit({ decision })} />
            {boardIssues(board).map((issue, i) => <Text key={i} style={{ color: colors.body }}>{issue}</Text>)}
            {board.references.some(r => r.kind === 'anti-reference') ? <View>
                <Text accessibilityRole="header" style={{ color: colors.accent, fontWeight: '700' }}>{t('filmWorkspace.banList')}</Text>
                {board.references.filter(r => r.kind === 'anti-reference').map((r, i) => <Text key={i} style={{ color: colors.body }}>{r.caption} · {r.source}</Text>)}
            </View> : null}
        </> : null}
    </View>;
}
