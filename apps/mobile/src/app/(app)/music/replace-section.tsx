import { useLocalSearchParams } from 'expo-router';
import { MusicGenerationActionBody } from '../../../components/music/MusicGenerationActionBody';
export default function ReplaceSection() {
    const { id } = useLocalSearchParams<{ id: string }>();
    return <MusicGenerationActionBody id={id} kind="replace_section" />;
}
