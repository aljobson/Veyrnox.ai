import { MusicLibrary } from '../../../_components/music/MusicLibrary';
import { MusicServerLibrary } from '../../../_components/music/MusicServerLibrary';

export const metadata = { title: 'Music Library' };

export default function MusicLibraryPage() {
  const serverLibrary = process.env.MUSIC_UI_ENABLED === 'true'
    && process.env.MUSIC_SCHEMA_ENABLED === 'true'
    && process.env.MUSIC_LIBRARY_ENABLED === 'true';
  const sourcesEnabled = serverLibrary && process.env.MUSIC_SOURCES_ENABLED === 'true';
  return serverLibrary ? <MusicServerLibrary sourcesEnabled={sourcesEnabled} /> : <MusicLibrary />;
}
