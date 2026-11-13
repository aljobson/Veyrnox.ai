import { redirect } from 'next/navigation';
import { MusicPlaylists } from '../../../_components/music/MusicPlaylists';
import { getT } from '../../../../../lib/i18n/server';
import { musicPlaylistsEnabled, musicUiEnabled } from '../../../../../lib/musicBackend.js';
export async function generateMetadata(){const {t}=await getT();return{title:t('music.meta.playlists')};}
export default function MusicPlaylistsPage(){const on=musicUiEnabled()&&musicPlaylistsEnabled();if(!on)redirect('/app/music/library');return <MusicPlaylists/>;}
