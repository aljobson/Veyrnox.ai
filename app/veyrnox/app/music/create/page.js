import { MusicCreateStudio } from '../../../_components/music/MusicCreateStudio';

export const metadata = { title: 'Create music' };

export default function MusicCreatePage() {
  const serverMode = process.env.MUSIC_UI_ENABLED === 'true';
  const sourcesEnabled = serverMode
    && process.env.MUSIC_SCHEMA_ENABLED === 'true'
    && process.env.MUSIC_LIBRARY_ENABLED === 'true'
    && process.env.MUSIC_SOURCES_ENABLED === 'true';
  return <MusicCreateStudio serverMode={serverMode} sourcesEnabled={sourcesEnabled} />;
}
