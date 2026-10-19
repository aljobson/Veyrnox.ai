'use client';
import { useI18n } from '../../../../../components/I18nProvider';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { AppNav } from '../../../_components/NavBar';
import { ConfirmDialog } from '../../../_components/ConfirmDialog';
import { Main } from '../../../_components/Main';
import { getSession, onSessionChange } from '../../../../lib/authClient';
import { listSocialAccounts, NETWORKS } from '../../../../lib/socialConnectClient';
import { deleteSocialReportTemplate, downloadSocialReport, listSocialReportTemplates, saveSocialReportTemplate } from '../../../../lib/socialReportsClient';
import BrandSwitcher from '../BrandSwitcher';
import { ReportScheduleFields } from './ReportScheduleFields';
import { pluralKey, tOr } from '../../../../../lib/i18n/translate.mjs';
import { localeTag } from '../../../../../lib/i18n/locales.mjs';

const currentAccount=()=>getSession()?.user?.id||'';
const noAccount=()=>'';
const button='rounded-full border border-vx-border px-4 py-2 text-sm font-bold disabled:opacity-50 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-vx-accent';
const input='rounded-lg border border-vx-border bg-vx-panel px-3 py-2 text-sm';
const editableRoles=new Set(['owner','manager','editor','analyst']);
const empty={id:null,name:'',accountId:'',rangeDays:30,comparePrevious:true,includeContent:true,reportTitle:'',accentColor:'#38bdf8',deliveryCadence:'manual',deliveryHourUtc:9,deliveryWeekday:1,deliveryDay:1,deliveryRecipients:[],deliveryReplyTo:'',deliveryMessage:'',deliveryFormat:'pdf'};
const networkLabel=(network)=>NETWORKS.find((item)=>item.key===network)?.label||network;

export default function Reports(){
  const { t } = useI18n();
  const account=useSyncExternalStore(onSessionChange,currentAccount,noAccount);
  return <><AppNav/><Main className="mx-auto max-w-[900px] px-4 py-10 sm:px-8">
    <Link href="/app/publish" className="text-sm text-vx-accent underline">Veyrnox.ai Publish</Link>
    <h1 data-testid="publish-reports-title" className="mt-3 text-3xl font-black">{t("app.publish.nav.reports")}</h1>
    <p className="mt-2 mb-4 text-sm text-vx-fg-muted">{t("app.publish.reports.intro")}</p>
    {account&&<BrandSwitcher/>}
    {account?<ReportTemplates key={account}/>:<p className="text-sm">{t("app.publish.reports.signIn")}<button type="button" className={button} onClick={()=>window.dispatchEvent(new CustomEvent('veyrnox:auth-required'))}>{t("oauth.signIn")}</button></p>}
  </Main></>;
}

function ReportTemplates(){
  const { t, locale } = useI18n();
  const number = value => locale === 'en' ? String(value) : value.toLocaleString(localeTag(locale));
  const daysLabel = count => t(pluralKey(t, locale, 'app.publish.reports.days', count), { count: number(count) });
  const deliverySummary = template => ['weekly', 'monthly'].includes(template.delivery_cadence) ? t(pluralKey(t, locale, 'app.publish.reports.recipients', template.delivery_recipients?.length || 0), { format: template.delivery_format?.toUpperCase() || 'PDF', count: number(template.delivery_recipients?.length || 0) }) : t('app.publish.reports.manualHelp');
  const [accounts,setAccounts]=useState([]),[templates,setTemplates]=useState(null),[role,setRole]=useState('viewer'),[scheduledEnabled,setScheduledEnabled]=useState(false),[exportsEnabled,setExportsEnabled]=useState(false),[deliveryEnabled,setDeliveryEnabled]=useState(false);
  const [form,setForm]=useState(empty),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
  const [deleteTarget,setDeleteTarget]=useState(null);
  const load=useCallback(async()=>{setError('');try{
    const [accountResult,reportResult]=await Promise.all([listSocialAccounts(),listSocialReportTemplates()]);
    setAccounts((accountResult.accounts||[]).filter((item)=>item.status==='active'));setTemplates(reportResult.templates||[]);setRole(reportResult.brandRole||accountResult.brandRole||'viewer');setScheduledEnabled(reportResult.scheduledReportsEnabled===true);setExportsEnabled(reportResult.reportExportsEnabled===true);setDeliveryEnabled(reportResult.reportDeliveryEnabled===true);
  }catch(err){setTemplates([]);setError(err?.code==='publish_plan_required'?t("app.publish.reports.planRequired"):t("app.publish.reports.loadFailed"));}},[t]);
  useEffect(()=>{void Promise.resolve().then(load);},[load]);
  const canEdit=editableRoles.has(role);
  async function save(event){event.preventDefault();setBusy(true);setError('');setMessage('');try{
    await saveSocialReportTemplate(form);setForm(empty);setMessage(t("app.publish.reports.saved"));await load();
  }catch(err){setError(err?.code==='report_name_taken'?t("app.publish.reports.nameTaken"):t("app.publish.reports.saveFailed"));}finally{setBusy(false);}}
  async function remove(id){setDeleteTarget(null);setBusy(true);setError('');setMessage('');try{await deleteSocialReportTemplate(id);setMessage(t("app.publish.reports.deleted"));if(form.id===id)setForm(empty);await load();}
    catch{setError(t("app.publish.reports.deleteFailed"));}finally{setBusy(false);}}
  async function download(id,format){setBusy(true);setError('');setMessage('');try{await downloadSocialReport(id,format);setMessage(t(format === 'pptx' ? 'app.publish.reports.pptxDownloaded' : 'app.publish.reports.pdfDownloaded'));}catch{setError(t("app.publish.reports.buildFailed"));}finally{setBusy(false);}}
  if(templates===null)return <p className="text-sm text-vx-fg-muted">{t("app.publish.reports.loading")}</p>;
  return <div className="space-y-6">
    {message&&<p role="status" className="text-sm text-vx-accent">{message}</p>}
    {error&&<p role="alert" className="text-sm text-vx-danger">{error}</p>}
    {canEdit&&<form data-testid="publish-reports-form" onSubmit={save} className="space-y-4 rounded-2xl border border-vx-border p-5" aria-labelledby="report-template-form">
      <div><h2 id="report-template-form" className="text-lg font-black">{form.id?t("app.publish.reports.edit"):t("app.publish.reports.new")}</h2><p className="mt-1 text-sm text-vx-fg-muted">{t("app.publish.reports.viewHelp")}</p></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-bold">{t("app.publish.reports.templateName")}<input data-testid="publish-report-name" required maxLength={80} className={`${input} mt-1 block w-full`} value={form.name} onChange={(event)=>setForm({...form,name:event.target.value})}/></label>
        <label className="text-sm font-bold">{t("app.publish.reports.title")}<input maxLength={100} placeholder={t("app.publish.reports.titlePlaceholder")} className={`${input} mt-1 block w-full`} value={form.reportTitle} onChange={(event)=>setForm({...form,reportTitle:event.target.value})}/></label>
        <label className="text-sm font-bold">{t("app.publish.analytics.account")}<select className={`${input} mt-1 block w-full`} value={form.accountId} onChange={(event)=>setForm({...form,accountId:event.target.value})}><option value="">{t("app.publish.analytics.allAccounts")}</option>{accounts.map((item)=><option key={item.id} value={item.id}>{tOr(t, `app.publish.network.${item.network}`, networkLabel(item.network))} · {item.display_name||item.external_account_id}</option>)}</select></label>
        <label className="text-sm font-bold">{t("app.publish.reports.period")}<select data-testid="publish-report-period" className={`${input} mt-1 block w-full`} value={form.rangeDays} onChange={(event)=>setForm({...form,rangeDays:Number(event.target.value)})}>{[7,30,90,365].map((days)=><option key={days} value={days}>{days===365?t("app.publish.analytics.period365"):daysLabel(days)}</option>)}</select></label>
        <label className="text-sm font-bold">{t("app.publish.reports.accent")}<span className="mt-1 flex items-center gap-2"><input aria-label={t("app.publish.reports.accentPicker")} type="color" value={form.accentColor} onChange={(event)=>setForm({...form,accentColor:event.target.value})}/><input aria-label={t("app.publish.reports.accentHex")} pattern="#[0-9A-Fa-f]{6}" className={`${input} min-w-0 flex-1`} value={form.accentColor} onChange={(event)=>setForm({...form,accentColor:event.target.value})}/></span></label>
        <div className="space-y-2 pt-6"><label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={form.comparePrevious} onChange={(event)=>setForm({...form,comparePrevious:event.target.checked})}/>{t("app.publish.analytics.compare")}</label><label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={form.includeContent} onChange={(event)=>setForm({...form,includeContent:event.target.checked})}/>{t("app.publish.reports.includeTables")}</label></div>
        <ReportScheduleFields enabled={scheduledEnabled} deliveryEnabled={deliveryEnabled} value={form} onChange={setForm}/>
      </div>
      <div className="flex flex-wrap gap-3"><button type="submit" className={`${button} bg-vx-accent text-black`} disabled={busy}>{busy?t("social.saving"):t("app.publish.reports.save")}</button>{form.id&&<button type="button" className={button} disabled={busy} onClick={()=>setForm(empty)}>{t("app.publish.reports.cancel")}</button>}</div>
    </form>}
    <section className="rounded-2xl border border-vx-border p-5"><h2 className="text-lg font-black">{t("app.publish.reports.savedTemplates")}</h2>
      {!templates.length?<p className="mt-3 text-sm text-vx-fg-muted">{t("app.publish.reports.empty")}</p>:<ul className="mt-4 space-y-3">{templates.map((template)=>{
        const params=new URLSearchParams({days:String(template.range_days),compare:template.compare_previous?'1':'0',content:template.include_content?'1':'0',accent:template.accent_color});
        if(template.account_id)params.set('account',template.account_id);if(template.report_title)params.set('reportTitle',template.report_title);
        const delivery=template.delivery_cadence==='weekly'?t("app.publish.reports.weekly"):template.delivery_cadence==='monthly'?t("app.publish.reports.monthly"):t("app.publish.reports.manual");
        return <li key={template.id} className="rounded-xl border border-vx-border p-4" style={{borderInlineStartColor:template.accent_color,borderInlineStartWidth:4}}><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-bold">{template.name}</h3><p className="mt-1 text-xs text-vx-fg-muted">{template.range_days===365?t("app.publish.analytics.period365"):daysLabel(template.range_days)} · {template.account_id?t("app.publish.reports.oneAccount"):t("app.publish.analytics.allAccounts")} · {template.compare_previous?t("app.publish.reports.comparison"):t("app.publish.reports.noComparison")} · {template.include_content?t("app.publish.reports.contentIncluded"):t("app.publish.reports.summaryOnly")} · {delivery}</p><p className="mt-1 text-xs text-vx-fg-muted">{deliverySummary(template)}</p>{template.delivery_cadence!=='manual'&&template.next_delivery_at&&<p className="mt-1 text-xs text-vx-fg-muted">{t('app.publish.reports.nextRun', { date: new Date(template.next_delivery_at).toLocaleString(localeTag(locale)) })}{template.last_delivery_status?t('app.publish.reports.lastRun', { status: tOr(t, `app.publish.reports.status.${template.last_delivery_status}`, t('app.publish.reports.status.failed')) }):''}{template.last_delivery_error?` (${tOr(t, `app.publish.reports.error.${template.last_delivery_error}`, template.last_delivery_error)})`:''}</p>}</div><div className="flex flex-wrap gap-3"><Link className={`${button} bg-vx-accent text-black`} href={`/app/publish/analytics?${params}`}>{t("app.publish.reports.run")}</Link>{exportsEnabled&&<><button type="button" className={button} disabled={busy} onClick={()=>download(template.id,'pdf')}>{t("app.publish.reports.pdf")}</button><button type="button" className={button} disabled={busy} onClick={()=>download(template.id,'pptx')}>{t("app.publish.reports.pptx")}</button></>}{canEdit&&<><button type="button" className={button} disabled={busy} onClick={()=>setForm({id:template.id,name:template.name,accountId:template.account_id||'',rangeDays:template.range_days,comparePrevious:template.compare_previous,includeContent:template.include_content,reportTitle:template.report_title||'',accentColor:template.accent_color,deliveryCadence:template.delivery_cadence||'manual',deliveryHourUtc:template.delivery_hour_utc??9,deliveryWeekday:template.delivery_weekday??1,deliveryDay:template.delivery_day??1,deliveryRecipients:template.delivery_recipients||[],deliveryReplyTo:template.delivery_reply_to||'',deliveryMessage:template.delivery_message||'',deliveryFormat:template.delivery_format||'pdf'})}>{t("label.Edit")}</button><button type="button" className={`${button} text-vx-danger`} disabled={busy} onClick={()=>setDeleteTarget(template)}>{t("app.publish.composer.delete")}</button></>}</div></div></li>;
      })}</ul>}
    </section>
    {!canEdit&&<p className="text-sm text-vx-fg-muted">{t('app.publish.reports.roleHelp', { role: tOr(t, `app.publish.role.${role}`, role) })}</p>}
    {deleteTarget&&<ConfirmDialog title={t('app.publish.ads.deleteTitle', { name: deleteTarget.name })} body={t("app.publish.reports.deleteHelp")} confirmLabel={t("app.publish.reports.delete")} tone="danger" onCancel={()=>setDeleteTarget(null)} onConfirm={()=>remove(deleteTarget.id)}/>}
  </div>;
}
