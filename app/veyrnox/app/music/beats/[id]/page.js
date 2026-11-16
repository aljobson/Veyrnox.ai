import { notFound } from 'next/navigation';
import { musicBeatLibrarySaveEnabled, musicBeatCloudEnabled, musicBeatEditorEnabled, musicMagicBarEnabled } from '../../../../../../lib/musicBackend.js';
import { BeatEditorLoader } from '../../../../_components/music/beat/BeatEditorLoader';

export function generateMetadata() { return { title: 'Beat editor' }; }
export default async function BeatPage({ params }) {
  if (!musicBeatEditorEnabled()) notFound();
  const { id } = await params;
  return <BeatEditorLoader librarySave={musicBeatLibrarySaveEnabled()} cloud={musicBeatCloudEnabled()} id={id} magicBar={musicMagicBarEnabled()} />;
}
