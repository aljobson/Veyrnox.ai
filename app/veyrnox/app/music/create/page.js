import { MusicCreateStudio } from '../../../_components/music/MusicCreateStudio';
import { getT } from '../../../../../lib/i18n/server';
import { musicSourcesEnabled, musicUiEnabled } from '../../../../../lib/musicBackend.js';

export async function generateMetadata() { const { t } = await getT(); return { title: t('music.meta.createPrivate') }; }

export default function MusicCreatePage() {
  const serverMode = musicUiEnabled();
  const sourcesEnabled = serverMode && musicSourcesEnabled();
  return <MusicCreateStudio serverMode={serverMode} sourcesEnabled={sourcesEnabled} />;
}
