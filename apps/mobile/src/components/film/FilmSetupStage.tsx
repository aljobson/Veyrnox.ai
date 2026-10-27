import { Text, View } from 'react-native';
import { t } from '../../lib/i18n';
import type { Film } from '../../lib/filmStudio';
import type { CatalogModel } from '../../lib/media';
import { clipLengths, frameFormats, isStudio, normalizeFilmStack, setupModels } from '../../lib/filmStudioOptions';
import { colors } from '../../theme';
import { Button } from '../ui';
import { Field } from './FilmFields';
import { FilmSelect } from './FilmSelect';

export function FilmSetupStage({ film, change, catalog, live, unavailable, retry }: {
    film: Film; change: (film: Film) => void; catalog: readonly CatalogModel[]; live: boolean; unavailable: boolean; retry: () => void;
}) {
    const write = (key: keyof Film['stack'], value: string) => change({ ...film, stack: normalizeFilmStack(film.stack, key, value, catalog) });
    const workflows = [{ value: 'Studio', label: t('filmWorkspace.studio') }, { value: 'External', label: t('filmWorkspace.external') }];
    return <View style={{ gap: 14 }}>
        {unavailable ? <View><Text style={{ color: colors.muted }}>{t('filmWorkspace.catalogUnavailable')}</Text><Button label={t('filmWorkspace.retry')} onPress={retry} /></View> : null}
        {(['image', 'video'] as const).map(kind => {
            const access = `${kind}Access` as const;
            const models = live ? setupModels(catalog, kind) : [];
            const value = film.stack[kind];
            const options = [{ value: '', label: t('filmWorkspace.chooseModel') }, ...models.map(m => ({ value: m.id, label: m.name }))];
            if (value && !models.some(m => m.id === value)) options.push({ value, label: t('filmWorkspace.legacyModel', { value1: value }) });
            const label = kind === 'image' ? t('film.imagemodel') : t('film.videomodel');
            return <View key={kind} style={{ gap: 14 }}>
                <FilmSelect label={kind === 'image' ? t('filmWorkspace.imageWorkflow') : t('filmWorkspace.videoWorkflow')} value={isStudio(film.stack[access]) ? 'Studio' : 'External'} options={workflows} onChange={v => write(access, v)} />
                {isStudio(film.stack[access]) ? <FilmSelect label={label} value={value} options={options} onChange={v => write(kind, v)} /> :
                    <Field label={label} value={value} onChange={v => write(kind, v)} hint={t('filmWorkspace.credentials')} />}
            </View>;
        })}
        <FilmSelect label={t('film.cliplength')} value={film.stack.seconds} options={clipLengths(film.stack, catalog).map(n => ({ value: String(n), label: `${n}${t('film.sec')}` }))} onChange={v => write('seconds', v)} />
        <FilmSelect label={t('filmWorkspace.frameFormat')} value={film.stack.aspect} options={frameFormats(film.stack, catalog).map(value => ({ value, label: value }))} onChange={v => write('aspect', v)} />
    </View>;
}
