import { MusicPublicAlbum } from '../../../_components/music/MusicPublicAlbum';
import { Main } from '../../../_components/Main';
import { getT } from '../../../../../lib/i18n/server';
export async function generateMetadata(){const {t}=await getT();return{title:t('music.meta.album')};}
export default async function PublicAlbumPage({params}){const {slug}=await params;return <Main><MusicPublicAlbum slug={slug}/></Main>;}
