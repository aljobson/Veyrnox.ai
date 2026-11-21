import { useLocalSearchParams } from 'expo-router';
import { MusicExportBody } from '../../../components/music/MusicExportBody';
export default function ExportAudio() {
    const { id } = useLocalSearchParams<{ id: string }>();
    return <MusicExportBody id={id} />;
}
