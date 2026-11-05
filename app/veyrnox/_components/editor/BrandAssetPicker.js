'use client';
import { useI18n } from '../../../../components/I18nProvider';
import { tOr } from '../../../../lib/i18n/translate.mjs';
import { localeTag } from '../../../../lib/i18n/locales.mjs';
import { useEffect, useState } from 'react';
import { Button } from '../Button';
import { gatewayFetch } from '../../_lib/gateway';
import { getStoredUserId } from '../../../lib/authClient';
import { loadProjectAssetBlob } from '../../_lib/editorProjectAssets.mjs';
function assetError(t, error) {
    return error?.code ? tOr(t, `app.editor.brandAssets.error.${error.code}`, t('app.editor.brandAssets.failed')) : error?.message || t('app.editor.brandAssets.failed');
}
export function BrandAssetPicker({workspaceId,assets,disabled,useDisabled,onChange,onIngest,logo,onLogo}) {
  const { t, locale } = useI18n();
    const number = value => locale === 'en' ? String(value) : new Intl.NumberFormat(localeTag(locale)).format(value);
    const fieldLabel = key => tOr(t, `app.editor.brandAssets.field.${key}`, key);
    const limits = {name:120, credit:120, usage:240, url:1000};
    const [catalog,setCatalog]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
    const [knownTypes,setKnownTypes]=useState({});
    const assetKeys=JSON.stringify(assets.map(({projectId,assetId})=>({projectId,assetId})));
    const typeIdentity=`${workspaceId}:${assetKeys}`;
    const logoTypes=knownTypes.identity===typeIdentity ? knownTypes.types : {};
    const hasLogoPicker=!!onLogo;
    useEffect(()=>{
        if(!hasLogoPicker)return;
        const controller=new AbortController(),account=getStoredUserId();
        void Promise.all(JSON.parse(assetKeys).map(async asset=>{
            try{const metadata=await gatewayFetch(`/projects/${asset.projectId}/assets/${asset.assetId}/download`,{signal:controller.signal});
                if(!controller.signal.aborted && account===getStoredUserId())setKnownTypes(previous=>({identity:typeIdentity,types:{...(previous.identity===typeIdentity ? previous.types : {}),[`${asset.projectId}:${asset.assetId}`]:metadata.content_type}}));
            }catch{/* Unavailable or uninspected assets cannot be chosen as logos. */}
        }));
        return()=>controller.abort();
    },[assetKeys,hasLogoPicker,typeIdentity]);
    async function browse(){setBusy(true);setError('');try{setCatalog(await gatewayFetch(`/workspaces/${workspaceId}/brand-assets`));}catch{setError(t("app.editor.brandAssets.failed"));}finally{setBusy(false);}}
    async function insert(asset){const account=getStoredUserId();setBusy(true);setError('');try{const source={projectId:asset.projectId,assetId:asset.assetId},result=await loadProjectAssetBlob(gatewayFetch,source);if(!account || account!==getStoredUserId())throw new Error(t("app.editor.workspace.retryAccount"));await onIngest(result.blob,asset.name,`a-${asset.assetId}`,source);}catch(e){setError(assetError(t, e));}finally{setBusy(false);}}
    const details=(asset,i,key,max)=><label className="block text-xs">{fieldLabel(key)}<input aria-label={t('app.editor.brandAssets.field', {field:fieldLabel(key), number:number(i+1)})} className="w-full rounded border border-vx-border bg-vx-base p-1" maxLength={max} disabled={disabled || busy} value={asset[key]} onChange={e=>onChange(assets.map((a,j)=>j===i?{...a,[key]:e.target.value}:a))} /></label>;
    return <div className="space-y-2"><h3 className="text-xs font-bold">{t("app.editor.brandAssets.title")}</h3>{error && <p role="alert" className="text-xs">{error}</p>}
        {assets.map((asset,i)=><div key={`${asset.projectId}:${asset.assetId}`} className="rounded border border-vx-border p-2 text-xs"><p>{asset.name}</p>{Object.entries(limits).map(([key,max])=><span key={key}>{details(asset,i,key,max)}</span>)}{asset.credit && <p>{asset.credit}</p>}{asset.usage && <p>{asset.usage}</p>}{/^https:\/\//.test(asset.url) && <a href={asset.url} target="_blank" rel="noopener noreferrer" className="underline">{t("app.editor.brandAssets.licence")}</a>}<div className="flex gap-1"><Button type="button" className="min-h-11" size="sm" disabled={busy || useDisabled} onClick={()=>insert(asset)}>{t("app.editor.brandAssets.insert")}</Button><Button type="button" className="min-h-11" size="sm" variant="ghost" disabled={disabled || busy} aria-label={t('app.editor.brandAssets.remove', {name:asset.name})} onClick={()=>onChange(assets.filter((_,j)=>j!==i))}>×</Button></div></div>)}
        {onLogo && <div className="space-y-2"><p className="text-xs font-bold">{t('app.editor.brand.logo')}</p><p className="text-xs">{logo ? assets.find(a=>a.assetId===logo.assetId&&a.projectId===logo.projectId)?.name : t('app.editor.brand.noLogo')}</p>{logo && <Button type="button" className="min-h-11" size="sm" disabled={disabled || busy} onClick={()=>onLogo(null)}>{t('app.editor.brand.removeLogo')}</Button>}{assets.filter(asset=>(logoTypes[`${asset.projectId}:${asset.assetId}`] || catalog?.assets.find(a=>a.id===asset.assetId && a.project_id===asset.projectId)?.sniffed_type)?.startsWith('image/')).map(asset=><Button key={`${asset.projectId}:${asset.assetId}`} type="button" className="min-h-11" size="sm" disabled={disabled || busy} onClick={()=>onLogo({projectId:asset.projectId,assetId:asset.assetId})}>{t('app.editor.brand.useLogo', { name: asset.name })}</Button>)}<p className="text-xs text-vx-fg-muted">{t('app.editor.brand.logoHelp')}</p></div>}
        <Button type="button" className="min-h-11" size="sm" variant="ghost" disabled={disabled || busy} onClick={browse}>{t("app.editor.brandAssets.browse")}</Button>
        {catalog && <div className="space-y-1">{!catalog.assets.length && <p className="text-xs">{t("app.editor.brandAssets.empty")}</p>}{catalog.truncated && <p className="text-xs">{t("app.editor.brandAssets.latest")}</p>}{catalog.assets.map(asset=><Button key={asset.id} type="button" className="min-h-11" size="sm" disabled={disabled || assets.length>=24 || assets.some(a=>a.assetId===asset.id)} onClick={()=>onChange([...assets,{projectId:asset.project_id,assetId:asset.id,name:t('app.editor.brandAssets.default', {type:asset.sniffed_type,id:asset.id.slice(0,8)}),credit:'',usage:'',url:''}])}>{t('app.editor.brandAssets.add', {type:asset.sniffed_type,id:asset.id.slice(0,8)})}</Button>)}</div>}
    </div>;
}
