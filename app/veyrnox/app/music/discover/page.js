import { MusicDiscover } from '../../../_components/music/MusicDiscover';
import { getT } from '../../../../../lib/i18n/server';

export async function generateMetadata() {
  const { t } = await getT();
  return {
    title: t('music.meta.discover'),
    description: t('music.meta.discoverDescription'),
  };
}

export default function MusicDiscoverPage() {
  return <MusicDiscover />;
}
