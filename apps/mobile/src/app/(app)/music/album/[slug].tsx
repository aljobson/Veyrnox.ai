import { useCallback, useState } from 'react';
import { Image } from 'expo-image';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { EmptyState } from '../../../../components/EmptyState';
import { Button, ListRow, Text, TextField } from '../../../../components/ui';
import { getPublicAlbumPage, reportAlbum } from '../../../../lib/music/albumsClient';
import type { PublicAlbum } from '../../../../lib/music/albumTypes';
import type { Blocked } from '../../../../lib/music/publicTypes';
import { t } from '../../../../lib/i18n';
import { PublicShell } from '../../../../components/music/PublicShell';
import { config } from '../../../../lib/config';
import { PublicBlocked } from '../../../../components/music/PublicBlocked';
import { usePublicSession } from '../../../../lib/music/usePublicMusic';
import { changeBlock } from '../../../../lib/music/blocksClient';
const key=()=>`album-report.${Date.now()}.${Math.random().toString(36).slice(2)}`;
export default function PublicAlbumScreen(){const{slug}=useLocalSearchParams<{slug:string}>(),{api,session}=usePublicSession(),router=useRouter();const[album,setAlbum]=useState<PublicAlbum|null>(null),[blocked,setBlocked]=useState<Blocked['blocked']|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[details,setDetails]=useState(''),[notice,setNotice]=useState('');
 const load=useCallback(async()=>{if(typeof slug!=='string')return;setLoading(true);try{const page=await getPublicAlbumPage(api,slug);if('blocked'in page){setBlocked(page.blocked);setAlbum(null);}else{setAlbum(page.album);setBlocked(null);}setError('');}catch{setError(t('musicAlbums.publicUnavailable'));}finally{setLoading(false);}},[api,slug]);useFocusEffect(useCallback(()=>{void load();},[load]));
 async function unblock(){if(!blocked||busy)return;setBusy(true);try{await changeBlock(api,session,blocked.creator_id,false);await load();}catch{setError(t('musicAlbums.publicUnavailable'));}finally{setBusy(false);}}
 return <PublicShell title={album?.title||t('musicAlbums.publicTitle')} status={loading?'loading':error?'error':'on'} error={error||null} refreshing={loading} refresh={()=>void load()}>{blocked?<PublicBlocked blocked={blocked} busy={busy} unblock={()=>void unblock()}/>:!loading&&!album?<EmptyState title={t('musicAlbums.publicUnavailable')} body={t('musicAlbums.missingBody')}/>:album?<>{album.artwork_url?<Image source={{uri:`${config.apiBase}${album.artwork_url}`}} accessibilityLabel={`${album.title} ${t('musicAlbums.artwork')}`} style={{width:160,height:160,borderRadius:24}}/>:null}<Text variant="bodyStrong">{t(`musicAlbums.type.${album.album_type}`)}</Text><Text>{t('musicAlbums.by',{name:album.display_name||album.handle})}</Text>{album.description?<Text>{album.description}</Text>:null}{album.tracks.map(track=><ListRow key={track.publication_id} title={track.title} accessibilityLabel={track.title} onPress={()=>router.push({pathname:'/music/track/[slug]',params:{slug:track.slug}} as never)}/>) }<TextField label={t('musicAlbums.reportDetails')} value={details} maxLength={500} multiline onChangeText={setDetails}/><Button variant="tertiary" label={t('musicAlbums.report')} disabled={details.trim().length<3} onPress={()=>void reportAlbum(api,album.slug,details,key()).then(()=>{setNotice(t('musicAlbums.reported'));setDetails('');}).catch(()=>setNotice(t('musicAlbums.reportError')))}/>{notice?<Text accessibilityLiveRegion="polite">{notice}</Text>:null}</>:null}</PublicShell>;}
