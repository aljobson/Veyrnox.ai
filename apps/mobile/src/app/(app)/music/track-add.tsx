import { useLocalSearchParams } from 'expo-router';
import { MusicTrackAddBody } from '../../../components/music/MusicTrackAddBody';
export default function TrackAdd() {
    const { id } = useLocalSearchParams<{ id: string }>();
    return <MusicTrackAddBody id={id} />;
}
