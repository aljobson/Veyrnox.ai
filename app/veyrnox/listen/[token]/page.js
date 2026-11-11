import { MusicSharedSong } from '../../_components/music/MusicSharedSong';
import { Main } from '../../_components/Main';
import { getT } from '../../../../lib/i18n/server';

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t('music.meta.privateLink'), robots: { index: false, follow: false } };
}

export default async function SharedMusicPage({ params }) {
  const { token } = await params;
  return <Main><MusicSharedSong token={token} /></Main>;
}
