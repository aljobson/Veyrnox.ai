import { MusicInstrumentsLoader } from '../../../_components/music/MusicInstrumentsLoader';
import { getT } from '../../../../../lib/i18n/server';

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t('music.meta.instruments') };
}

export default function MusicInstrumentsPage() {
  return <MusicInstrumentsLoader />;
}
