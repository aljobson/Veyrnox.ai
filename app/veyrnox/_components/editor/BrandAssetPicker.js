'use client';
import { useState } from 'react';
import { Button } from '../Button';
import { gatewayFetch } from '../../_lib/gateway';
import { getStoredUserId } from '../../../lib/authClient';
import { loadProjectAssetBlob } from '../../_lib/editorProjectAssets.mjs';
export function BrandAssetPicker({workspaceId,assets,disabled,useDisabled,onChange,onIngest}) {
    const [catalog,setCatalog]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
    async function browse(){setBusy(true);setError('');try{setCatalog(await gatewayFetch(`/workspaces/${workspaceId}/brand-assets`));}catch{setError('Could not load inspected workspace assets.');}finally{setBusy(false);}}
    async function insert(asset){const account=getStoredUserId();setBusy(true);setError('');try{const source={projectId:asset.projectId,assetId:asset.assetId},result=await loadProjectAssetBlob(gatewayFetch,source);if(!account || account!==getStoredUserId())throw new Error('The account changed. Retry from the current account.');await onIngest(result.blob,asset.name,`a-${asset.assetId}`,source);}catch(e){setError(e.message);}finally{setBusy(false);}}
    const details=(asset,i,key,max)=><label className="block text-xs">{key}<input aria-label={`Brand asset ${key} ${i+1}`} className="w-full rounded border border-vx-border bg-vx-base p-1" maxLength={max} disabled={disabled || busy} value={asset[key]} onChange={e=>onChange(assets.map((a,j)=>j===i?{...a,[key]:e.target.value}:a))} /></label>;
    return <div className="space-y-2"><h3 className="text-xs font-bold">Brand assets</h3>{error && <p role="alert" className="text-xs">{error}</p>}
        {assets.map((asset,i)=><div key={`${asset.projectId}:${asset.assetId}`} className="rounded border border-vx-border p-2 text-xs"><p>{asset.name}</p>{details(asset,i,'name',120)}{details(asset,i,'credit',120)}{details(asset,i,'usage',240)}{details(asset,i,'url',1000)}{asset.credit && <p>{asset.credit}</p>}{asset.usage && <p>{asset.usage}</p>}{/^https:\/\//.test(asset.url) && <a href={asset.url} target="_blank" rel="noopener noreferrer" className="underline">Recorded licence</a>}<div className="flex gap-1"><Button size="sm" disabled={busy || useDisabled} onClick={()=>insert(asset)}>Insert brand asset</Button><Button size="sm" variant="ghost" disabled={disabled || busy} aria-label={`Remove brand asset ${asset.name}`} onClick={()=>onChange(assets.filter((_,j)=>j!==i))}>×</Button></div></div>)}
        <Button size="sm" variant="ghost" disabled={disabled || busy || assets.length>=24} onClick={browse}>Browse inspected workspace assets</Button>
        {catalog && <div className="space-y-1">{!catalog.assets.length && <p className="text-xs">No inspected project assets are available. Uploads have a separate rollout gate.</p>}{catalog.truncated && <p className="text-xs">Showing the latest 100 inspected assets.</p>}{catalog.assets.map(asset=><Button key={asset.id} size="sm" disabled={disabled || assets.length>=24 || assets.some(a=>a.assetId===asset.id)} onClick={()=>onChange([...assets,{projectId:asset.project_id,assetId:asset.id,name:`Brand ${asset.sniffed_type} ${asset.id.slice(0,8)}`,credit:'',usage:'',url:''}])}>Add {asset.sniffed_type} {asset.id.slice(0,8)}</Button>)}</div>}
    </div>;
}
