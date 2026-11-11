import { MusicPublicPrompt } from '../_components/music/MusicPublicPrompt';
import { Main } from '../_components/Main';
import { getT } from '../../../lib/i18n/server';
import { musicUiEnabled } from '../../../lib/musicBackend.js';

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t('music.meta.create'), description: t('music.meta.createDescription') };
}

export default function PublicMusicPage() {
  return <Main><MusicPublicPrompt available={musicUiEnabled()} /></Main>;
}
