import { notFound } from 'next/navigation';
import { musicBeatEditorEnabled, musicLabsEnabled, musicRankingEnabled } from '../../../../../lib/musicBackend.js';
import { MusicLabs } from '../../../_components/music/MusicLabs';

export function generateMetadata() { return { title: 'Labs' }; }
export default function LabsPage() {
  if (!musicLabsEnabled()) notFound();
  return <MusicLabs beatsEnabled={musicBeatEditorEnabled()} rankingEnabled={musicRankingEnabled()} />;
}
