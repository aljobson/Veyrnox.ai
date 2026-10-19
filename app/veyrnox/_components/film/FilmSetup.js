'use client';
import { useI18n } from '../../../../components/I18nProvider';
import { localeTag } from '../../../../lib/i18n/locales.mjs';
import { pluralKey } from '../../../../lib/i18n/translate.mjs';
import { STUDIO_FOLDERS } from '../../_lib/filmStudio';
import { FilmField, FilmSelect } from './FilmFields';
import { normalizeFilmStack } from '../../_lib/authenticatedMedia';

const ACCESS_SUFFIX = 'Access';
export function FilmSetup({ film, update, models }) {
  const { t, locale } = useI18n();
  const number = value => locale === 'en' ? String(value) : new Intl.NumberFormat(localeTag(locale)).format(value);
  const stack = (key, value) => update({ ...film, stack: normalizeFilmStack(film.stack, key, value, models) });
  const access = [['Studio',t("app.film.setup.studio")], ['External',t("app.film.setup.external")]];
  const selectedVideo = models.find(model => model.id === film.stack.video);
  const frameFormats = film.stack.videoAccess === 'Studio' && selectedVideo?.aspects?.length
    ? selectedVideo.aspects : ['16:9','9:16','1:1'];
  const clipLengths = film.stack.videoAccess === 'Studio'
    ? (selectedVideo?.durations || [10]).filter(seconds => seconds >= 10 && seconds <= 15)
    : Array.from({length:6},(_,i)=>i+10);
  return <div className="space-y-5">
    <p className="text-sm text-vx-fg-muted">{t("app.film.setup.tools")}</p>
    {['image','video'].map(kind => <section key={kind} className="space-y-4 rounded-xl border border-vx-border p-4">
      <FilmSelect data-testid={`film-${kind}-workflow`} label={kind === 'image' ? t('app.film.setup.imageWorkflow') : t('app.film.setup.videoWorkflow')} value={film.stack[kind + ACCESS_SUFFIX]} onChange={v => stack(kind + ACCESS_SUFFIX,v)} options={access}/>
      {film.stack[kind + ACCESS_SUFFIX] === 'Studio' ? <FilmSelect data-testid={`film-${kind}-model`} label={kind === 'image' ? t('app.film.setup.imageModel') : t('app.film.setup.videoModel')} value={film.stack[kind]} onChange={v=>stack(kind,v)} options={[
        ['', t('app.film.setup.choose')], ...models.filter(m=>m.kind===kind&&m.takesPrompt!==false&&!m.gated&&!m.isEdit&&!m.takesTopic&&!m.takesPlan&&(kind!=='video'||m.durations?.some(n=>n>=10&&n<=15))).map(m=>[m.id,m.name]),
      ]}/> : <FilmField label={kind === 'image' ? t('app.film.setup.imageModel') : t('app.film.setup.videoModel')} value={film.stack[kind]} onChange={v=>stack(kind,v)} hint={t('app.film.setup.credentials')}/>}
    </section>)}
    <div className="grid gap-4 sm:grid-cols-2"><FilmSelect data-testid="film-clip-length" label={t("app.film.setup.length")} value={film.stack.seconds} onChange={v=>stack('seconds',v)} options={(clipLengths.length ? clipLengths : [10]).map(seconds=>[String(seconds),t(pluralKey(t, locale, 'app.film.setup.seconds', seconds), {count: number(seconds)})])}/>
      <FilmSelect data-testid="film-frame-format" label={t("app.film.setup.format")} value={film.stack.aspect} onChange={v=>stack('aspect',v)} options={frameFormats.map(a=>[a,a])}/></div>
    <p className="text-sm text-vx-fg-muted">{t("app.film.setup.rule")}</p>
  </div>;
}
export function FilmInit({ film, update }) {
  const { t, locale } = useI18n();
  const number = value => locale === 'en' ? String(value) : new Intl.NumberFormat(localeTag(locale)).format(value);
  return <div className="space-y-5"><FilmField label={t("app.projects.name")} value={film.name} onChange={name=>update({...film,name})} maxLength={100}/>
    <FilmSelect label={t("app.film.setup.target")} value={String(film.targetSeconds)} onChange={value=>update({...film,targetSeconds:Number(value)})} options={[30,60,90,120].map(seconds=>[String(seconds),t(pluralKey(t, locale, 'app.film.setup.seconds', seconds), {count: number(seconds)})])}/>
    <p className="text-sm text-vx-fg-muted">{t("app.film.setup.export")}</p>
    <pre className="overflow-auto rounded-xl bg-vx-panel p-4 text-xs leading-6">{STUDIO_FOLDERS.map(s=>`${s}/`).join('\n')}</pre>
    <ul className="list-disc space-y-2 ps-5 text-sm"><li>{t("app.film.setup.selects")}</li><li>{t("app.film.setup.generations")}</li><li>{t("app.film.setup.files")}</li></ul>
  </div>;
}
