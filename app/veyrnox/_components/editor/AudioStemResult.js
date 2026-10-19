'use client';
import { tOr } from '../../../../lib/i18n/translate.mjs';
import { useI18n } from '../../../../components/I18nProvider';

import {useState,useRef,useEffect} from 'react';
import {Button} from '../Button';
import {gatewayFetch} from '../../_lib/gateway';
import {getSession} from '../../../lib/authClient';
import {loadLibraryBlob} from '../../_lib/editorLibrary.mjs';
import {libraryMediaId} from '../../_lib/editorMedia.mjs';
import {AUDIO_STEMS} from '../../../../lib/audioStems.mjs';
export function AudioStemResult({job,disabled,onIngest,onError}) {
  const { t } = useI18n();
    const [stem,setStem]=useState('vocals'),[busy,setBusy]=useState(false),alive=useRef(true);
    useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
    async function receiveStem(download=false) {
        const owner=getSession()?.user?.id;if(!owner||busy)return;setBusy(true);
        try {
            if(download){
                const asset=await gatewayFetch(`/jobs/${encodeURIComponent(job.job_id)}/asset?stem=${stem}&download=1`);
                if(!alive.current||getSession()?.user?.id!==owner)return;
                if(typeof asset?.url!=='string'||!asset.url.startsWith('https://'))throw new Error(t("app.editor.stem.invalid"));
                window.location.assign(asset.url);
            } else {
                const {blob}=await loadLibraryBlob(gatewayFetch,job.job_id,fetch,{stem});
                if(!alive.current||getSession()?.user?.id!==owner)return;
                await onIngest(blob,t('app.editor.stem.separated', { stem: tOr(t, `app.editor.stem.${stem}`, stem) }),`${libraryMediaId(job.job_id)}--${stem}`);
            }
        } catch(e) {if(alive.current&&getSession()?.user?.id===owner)onError(tOr(t, `app.editor.stem.error.${e.code || e.message}`, e.message && !/^[a-z][a-z0-9_:-]*$/.test(e.message) ? e.message : t('app.editor.stem.failed')));}
        finally {if(alive.current)setBusy(false);}
    }
    return <fieldset disabled={disabled||busy} className="space-y-2"><label className="block">{t("app.editor.stem.title")}<select aria-label={t("app.editor.stem.label")} value={stem} onChange={e=>setStem(e.target.value)} className="w-full rounded border border-vx-border bg-vx-base p-2">{AUDIO_STEMS.map(name=><option key={name} value={name}>{tOr(t, `app.editor.stem.${name}`, name)}</option>)}</select></label><Button size="sm" onClick={()=>receiveStem()}>{t('app.editor.stem.add', { stem: tOr(t, `app.editor.stem.${stem}`, stem) })}</Button><Button size="sm" variant="ghost" onClick={()=>receiveStem(true)}>{t('app.editor.stem.download', { stem: tOr(t, `app.editor.stem.${stem}`, stem) })}</Button><p>{t("app.editor.stem.help")}</p></fieldset>;
}
