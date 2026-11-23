import { redirect } from 'next/navigation';
import { MusicAlbums } from '../../../_components/music/MusicAlbums';
import { getT } from '../../../../../lib/i18n/server';
import { musicAlbumsEnabled, musicUiEnabled } from '../../../../../lib/musicBackend.js';
export async function generateMetadata(){const {t}=await getT();return{title:t('music.meta.albums')};}
export default function MusicAlbumsPage(){if(!musicUiEnabled()||!musicAlbumsEnabled())redirect('/app/music/library');return <MusicAlbums/>;}
