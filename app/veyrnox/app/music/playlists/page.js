import { redirect } from 'next/navigation';
import { MusicPlaylists } from '../../../_components/music/MusicPlaylists';
export const metadata={title:'Music Playlists'};
export default function MusicPlaylistsPage(){const on=process.env.MUSIC_UI_ENABLED==='true'&&process.env.MUSIC_SCHEMA_ENABLED==='true'&&process.env.MUSIC_LIBRARY_ENABLED==='true'&&process.env.MUSIC_PLAYLISTS_ENABLED==='true';if(!on)redirect('/app/music/library');return <MusicPlaylists/>;}
