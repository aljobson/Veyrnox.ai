import { redirect } from 'next/navigation';
import { MusicPlaylists } from '../../../_components/music/MusicPlaylists';
import { getT } from '../../../../../lib/i18n/server';
export async function generateMetadata(){const {t}=await getT();return{title:t('music.meta.playlists')};}
export default function MusicPlaylistsPage(){const on=process.env.MUSIC_UI_ENABLED==='true'&&process.env.MUSIC_SCHEMA_ENABLED==='true'&&process.env.MUSIC_LIBRARY_ENABLED==='true'&&process.env.MUSIC_PLAYLISTS_ENABLED==='true';if(!on)redirect('/app/music/library');return <MusicPlaylists/>;}
