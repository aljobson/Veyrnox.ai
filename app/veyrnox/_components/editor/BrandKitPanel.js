'use client';
import { useState } from 'react';
import { helperCopy } from '../../../../lib/i18n/helperCopy.mjs';
import { useI18n } from '../../../../components/I18nProvider';
import { emptyBrandKit, brandKitProblem, normalizeBrandKit, brandTextStyleSize } from '../../../../lib/editorShared';
import { BrandKitFields, BrandPaletteFields, BrandFieldError, brandField as field } from './BrandKitFields';
import { BrandAssetPicker } from './BrandAssetPicker';
import { Button } from '../Button';
import { useEditorResource } from './useEditorResource';
import { TEXT_DEFAULTS } from '../../_lib/editorSequenceValidation.mjs';
import { addSequenceText } from '../../_lib/editorSequence.mjs';

export function BrandKitPanel({ project, item, frame, disabled, apply, onSelect, onIngest }) {
  const { t, locale } = useI18n();
  const resource = useEditorResource(project?.workspaceId ? `/workspaces/${project.workspaceId}/brand-kit` : null);
  const [draft, setDraft] = useState(null);
  const [name, setName] = useState(() => t('app.editor.brand.titleDefault'));
  const [status, setStatus] = useState(null);
  const kit = draft?.source === resource.data ? draft.kit : normalizeBrandKit(resource.data?.kit || emptyBrandKit());
  const kitToSave = { ...kit, textStyles: kit.textStyles.map(preset => ({ ...preset, size: brandTextStyleSize(preset.size) ?? preset.size })) };
  const problem = status?.source === resource.data ? status.text : '';
  if (!project?.workspaceId) return <p className="text-xs">{t('app.editor.brand.saveFirst')}</p>;
  if (!resource.data) return <section aria-label={t('app.editor.brand.title')}>
    <p role={resource.error ? 'alert' : 'status'} className="text-xs">{t(resource.errorCode === 'account_changed' ? 'app.editor.workspace.retryAccount' : resource.errorStatus === 403 ? 'app.editor.brand.permission' : resource.error ? 'app.editor.brand.loadFailed' : 'app.editor.brand.loading')}</p>
    {resource.error && <Button type="button" className="min-h-11" size="sm" onClick={resource.reload}>{t('app.editor.brand.retry')}</Button>}
  </section>;
  const locked = disabled || resource.busy || !resource.data.canEdit;
  const useDisabled = disabled || resource.busy;
  const set = (key, value) => setDraft({ source: resource.data, kit: { ...kit, [key]: value } });
  function setAssets(assets) {
    const logo = kit.logo && assets.some(a => a.assetId === kit.logo.assetId && a.projectId === kit.logo.projectId) ? kit.logo : null;
    setDraft({ source: resource.data, kit: { ...kit, assets, logo } });
  }
  async function save() {
    const bad = brandKitProblem(kitToSave);
    if (bad) { setStatus({ source: resource.data, text: bad }); return; }
    const result = await resource.mutate({ expected_version: resource.data.version, kit: kitToSave }, 'PUT');
    if (result) { resource.setData(result); setStatus({ source: result, text: t('app.editor.brand.saved') }); }
  }
  function insertStyle(preset) {
    const next = apply(timeline => addSequenceText(timeline, { text: preset.name, size: brandTextStyleSize(preset.size), style: preset.style, start: Math.min(frame, 17910), len: 90 }));
    if (next) onSelect({ track: 'text', id: `t${next.seq}` });
  }
  return <section aria-label={t('app.editor.brand.title')} className="space-y-3">
    <h2 className="text-sm font-bold">{t('app.editor.brand.title')}</h2>
    {resource.error && resource.errorCode !== 'VERSION_CONFLICT' && <p role="alert" className="text-xs text-vx-danger">{resource.errorCode === 'account_changed' ? t('app.editor.workspace.retryAccount') : helperCopy(t, locale, resource.error)}</p>}
    {problem && <p role="status" className="text-xs">{helperCopy(t, locale, problem)}</p>}
    {resource.data.version === 0 && <p role="status" className="text-xs">{t('app.editor.brand.empty')}</p>}
    {resource.errorCode === 'VERSION_CONFLICT' && <p role="alert" className="text-xs text-vx-danger">{t('app.editor.brand.conflict')}</p>}
    <fieldset disabled={locked} className="space-y-2">
      <label className="block text-xs">{t('app.editor.brand.name')}
        <input aria-label={t('app.editor.brand.name')} className={field} value={kit.name} maxLength={80} onChange={e => set('name', e.target.value)} />
      </label>
      <BrandFieldError kit={kit} name="name" />
      <fieldset aria-label={t('app.editor.brand.paletteLabel')} className="space-y-2"><BrandPaletteFields kit={kit} set={set} /></fieldset>
      <BrandKitFields kit={kit} set={set} />
      <input aria-label={t('app.editor.brand.styleName')} className={field} value={name} maxLength={80} onChange={e => setName(e.target.value)} />
      <Button type="button" className="min-h-11" size="sm" disabled={!item?.text || kit.textStyles.length >= 12 || !name.trim()}
        onClick={() => set('textStyles', [...kit.textStyles, { name: name.trim(), size: item.size, style: { ...TEXT_DEFAULTS, ...item.style } }])}>
        {t('app.editor.brand.saveStyle')}
      </Button>
    </fieldset>
    <div className="flex flex-wrap gap-1">{kit.palette.filter(c => /^#[0-9a-f]{6}$/i.test(c)).map((c, i) => <button key={`${c}:${i}`} type="button" disabled={useDisabled}
      aria-label={t('app.editor.brand.canvas', { colour: c })} className="size-11 rounded-xl border border-vx-border focus-visible:outline focus-visible:outline-vx-accent"
      style={{ background: c }} onClick={() => apply(timeline => ({ ...timeline, background: c }))}></button>)}</div>
    <BrandTextStyles kit={kit} set={set} locked={locked} useDisabled={useDisabled} onInsert={insertStyle} />
    <BrandAssetPicker key={`${project.workspaceId}:${resource.accountId}`} useDisabled={useDisabled} workspaceId={project.workspaceId}
      assets={kit.assets} disabled={locked} logo={kit.logo} onLogo={logo => set('logo', logo)} onChange={setAssets} onIngest={onIngest} />
    <BrandFieldError kit={kit} name="assets" /><BrandFieldError kit={kit} name="logo" />
    {new TextEncoder().encode(JSON.stringify(kitToSave)).byteLength > 8192 && <p role="alert" className="text-xs text-vx-danger">{t('app.editor.brand.tooLarge')}</p>}
    <Button type="button" className="min-h-11" size="sm" disabled={locked || !!brandKitProblem(kitToSave)} onClick={save}>{t('app.editor.brand.save')}</Button>
    <Button type="button" className="min-h-11" size="sm" variant="ghost" disabled={resource.busy} onClick={resource.reload}>{t('app.editor.brand.reload')}</Button>
    {!resource.data.canEdit && <p className="text-xs">{t('app.editor.brand.permission')}</p>}
  </section>;
}

function BrandTextStyles({ kit, set, locked, useDisabled, onInsert }) {
  const { t } = useI18n();
  const edit = (index, key, value) => set('textStyles', kit.textStyles.map((style, i) => i === index ? { ...style, [key]: value } : style));
  return <>
    {kit.textStyles.map((preset, i) => <div key={i} className="flex flex-wrap gap-1">
      <label className="text-xs">{t('app.editor.brand.styleName')}
        <input aria-label={t('app.editor.brand.editStyle', { number: i + 1 })} className={field} disabled={locked} value={preset.name} maxLength={80} onChange={e => edit(i, 'name', e.target.value)} />
      </label>
      <label className="text-xs">{t('app.editor.brand.styleSize')}
        <input aria-label={t('app.editor.brand.editSize', { number: i + 1 })} className={field} type="number" min={2} max={40} step={1} disabled={locked} value={preset.size} aria-invalid={brandTextStyleSize(preset.size) === null} onChange={e => edit(i, 'size', e.target.value)} onBlur={() => { const size = brandTextStyleSize(preset.size); if (size !== null) edit(i, 'size', size); }} />
      </label>
      {brandTextStyleSize(preset.size) === null && <p role="alert" className="text-xs text-vx-danger">{t('app.editor.brand.invalid.styleSize')}</p>}
      <Button type="button" className="min-h-11" size="sm" disabled={useDisabled || brandTextStyleSize(preset.size) === null} onClick={() => onInsert(preset)}>{t('app.editor.original.insertName', { name: preset.name })}</Button>
      <Button type="button" className="min-h-11" size="sm" variant="ghost" disabled={locked} aria-label={t('app.editor.brand.removeStyle', { name: preset.name })}
        onClick={() => set('textStyles', kit.textStyles.filter((_, j) => j !== i))}>×</Button>
    </div>)}
    <BrandFieldError kit={{ ...kit, textStyles: kit.textStyles.map(preset => ({ ...preset, size: brandTextStyleSize(preset.size) ?? preset.size })) }} name="textStyles" />
  </>;
}
