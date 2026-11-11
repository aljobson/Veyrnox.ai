import { MusicDiscover } from '../../../_components/music/MusicDiscover';
import { getT } from '../../../../../lib/i18n/server';
import { musicReferencesEnabled, musicSourcesEnabled, musicUiEnabled } from '../../../../../lib/musicBackend.js';

export async function generateMetadata() {
  const { t } = await getT();
  return {
    title: t('music.meta.discover'),
    description: t('music.meta.discoverDescription'),
  };
}

export default function MusicDiscoverPage() {
  const serverMode = musicUiEnabled();
  return <MusicDiscover referencesEnabled={serverMode && musicReferencesEnabled()} sourcesEnabled={serverMode && musicSourcesEnabled()} />;
}
