import { useLocalSearchParams } from 'expo-router';
import { MusicRemixBody } from '../../../components/music/MusicRemixBody';

export default function Mashup() {
    const { id } = useLocalSearchParams<{ id: string }>();
    return <MusicRemixBody id={id} kind="mashup" />;
}
