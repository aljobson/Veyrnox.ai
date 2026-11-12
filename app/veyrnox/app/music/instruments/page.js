import { MusicInstruments } from '../../../_components/music/MusicInstruments';
import { getT } from '../../../../../lib/i18n/server';

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t('music.meta.instruments'), description: t('music.meta.instrumentsDescription') };
}

export default function MusicInstrumentsPage() {
  return <MusicInstruments />;
}
