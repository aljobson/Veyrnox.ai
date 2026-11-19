import { useLocalSearchParams } from 'expo-router';
import { MusicGenerationActionBody } from '../../../components/music/MusicGenerationActionBody';
export default function AddSection() {
    const { id } = useLocalSearchParams<{ id: string }>();
    return <MusicGenerationActionBody id={id} kind="add_section" />;
}
