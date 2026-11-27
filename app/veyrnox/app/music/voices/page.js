import { redirect } from 'next/navigation';
import { musicVoicesReady, musicVoicesSchemaReady } from '../../../../../lib/musicVoices.js';
import { MusicVoices } from '../../../_components/music/MusicVoices';

export const metadata = { title: 'Verify your music voice · Veyrnox.ai' };

export default function MusicVoicesPage() {
  if (!musicVoicesSchemaReady()) redirect('/app/music/library');
  return <MusicVoices enrollmentInitiallyAvailable={musicVoicesReady()} />;
}
