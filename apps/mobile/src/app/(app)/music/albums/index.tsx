import { useCallback, useState } from 'react';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { RefreshControl, View } from 'react-native';
import { useAuth } from '../../../../auth/AuthProvider';
import { EmptyState } from '../../../../components/EmptyState';
import { MusicNotice } from '../../../../components/music/MusicNotice';
import { Button, ListRow, SegmentedControl, Text, TextField, themedStyles, useThemedStyles } from '../../../../components/ui';
import { FilmSelect } from '../../../../components/film/FilmSelect';
import { createAlbum, convertPlaylistToAlbum, listAlbumArtwork, listAlbums } from '../../../../lib/music/albumsClient';
import { getEntitlements } from '../../../../lib/music/client';
import { listPlaylists } from '../../../../lib/music/playlistsClient';
import type { Album, AlbumArtwork } from '../../../../lib/music/albumTypes';
import type { AlbumType } from '../../../../lib/music/albumTypes';
import type { Playlist } from '../../../../lib/music/playlistTypes';
import { t } from '../../../../lib/i18n';
import { ds } from '../../../../theme';
import { SafeKeyboardFormScrollView } from '../../../../components/SafeContentScrollView';
const key=(prefix:string)=>`${prefix}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
export default function Albums(){const{api}=useAuth(),router=useRouter(),s=useThemedStyles(sheets);const[albums,setAlbums]=useState<readonly Album[]>([]),[playlists,setPlaylists]=useState<readonly Playlist[]>([]);
 const[artwork,setArtwork]=useState<readonly AlbumArtwork[]>([]),[artworkId,setArtworkId]=useState(''),[title,setTitle]=useState(''),[description,setDescription]=useState(''),[albumType,setAlbumType]=useState<AlbumType>('album'),[status,setStatus]=useState<'loading'|'on'|'off'|'error'>('loading'),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const load=useCallback(async()=>{setStatus('loading');try{const entitlements=await getEntitlements(api);if(!entitlements.features.albums){setStatus('off');return;}const[a,p,art]=await Promise.all([listAlbums(api),listPlaylists(api),listAlbumArtwork(api)]);setAlbums(a);setPlaylists(p);setArtwork(art);setStatus('on');}catch{setStatus('error');}},[api]);
 useFocusEffect(useCallback(()=>{void load();},[load]));
 async function create(){if(!title.trim()||busy)return;setBusy(true);setNotice('');try{await createAlbum(api,title.trim(),albumType,description.trim(),artworkId||null,key('album-create'));setTitle('');setDescription('');setAlbumType('album');setArtworkId('');setNotice(t('musicAlbums.created'));await load();}catch{setNotice(t('musicAlbums.saveError'));}finally{setBusy(false);}}
 async function convert(playlist:Playlist){if(busy)return;setBusy(true);setNotice('');try{const result=await convertPlaylistToAlbum(api,playlist.id,title.trim()||playlist.title,albumType,description.trim(),artworkId||null,key('album-convert'));setNotice(t('musicAlbums.converted',{included:result.included_count,excluded:result.excluded_count}));await load();}catch{setNotice(t('musicAlbums.saveError'));}finally{setBusy(false);}}
 return <SafeKeyboardFormScrollView style={s.screen} contentContainerStyle={s.content} gutter={ds.space.gutter} refreshControl={<RefreshControl refreshing={status==='loading'} onRefresh={()=>void load()}/>}>
  <Stack.Screen options={{title:t('musicAlbums.title')}}/>{status==='off'?<EmptyState title={t('musicAlbums.off')} body={t('musicAlbums.offBody')}/>:<>{status==='error'?<MusicNotice message={t('musicAlbums.loadError')} retry={()=>void load()}/>:null}
  <Text>{t('musicAlbums.body')}</Text><TextField label={t('musicAlbums.name')} value={title} maxLength={80} editable={!busy} onChangeText={setTitle}/><Text variant="bodyStrong">{t('musicAlbums.type')}</Text><SegmentedControl value={albumType} disabled={busy} onChange={setAlbumType} options={[{value:'album',label:t('musicAlbums.type.album')},{value:'ep',label:t('musicAlbums.type.ep')},{value:'single',label:t('musicAlbums.type.single')}]}/><FilmSelect label={t('musicAlbums.artwork')} value={artworkId} onChange={setArtworkId} options={[{value:'',label:t('musicAlbums.noArtwork')},...artwork.map((image,index)=>({value:image.asset_id,label:t('musicAlbums.artworkNamed',{count:index+1})}))]}/><TextField label={t('musicAlbums.description')} value={description} maxLength={500} multiline editable={!busy} onChangeText={setDescription}/><Button label={t('musicAlbums.create')} disabled={busy||!title.trim()} onPress={()=>void create()}/>
  {notice?<Text accessibilityLiveRegion="polite">{notice}</Text>:null}<Text variant="title3">{t('musicAlbums.convert')}</Text>{!playlists.length?<Text>{t('musicAlbums.noPlaylists')}</Text>:playlists.map(playlist=><View key={playlist.id} style={s.row}><Text variant="bodyStrong">{playlist.title}</Text><Button variant="secondary" label={t('musicAlbums.convertNamed',{title:playlist.title})} disabled={busy} onPress={()=>void convert(playlist)}/></View>)}
  <Text variant="title3">{t('musicAlbums.yours')}</Text>{status==='on'&&!albums.length?<EmptyState title={t('musicAlbums.empty')} body={t('musicAlbums.emptyBody')}/>:albums.map(album=><ListRow key={album.id} title={album.title} subtitle={t('musicAlbums.summary',{count:album.tracks.length,status:t(`musicAlbums.status.${album.status}`)})} accessibilityLabel={album.title} onPress={()=>router.push({pathname:'/music/albums/[id]',params:{id:album.id}} as never)}/>)}</>}
 </SafeKeyboardFormScrollView>;}
const sheets=themedStyles(p=>({screen:{flex:1,backgroundColor:p.bg},content:{gap:ds.space.md},row:{gap:ds.space.sm}}));
