import { useLocalSearchParams } from 'expo-router';
import { SpeechStudio } from '../../components/speech/SpeechStudio';
export default function SpeechRoute() {
    const { reopen } = useLocalSearchParams<{ reopen?: string | string[] }>();
    return <SpeechStudio reopen={reopen} />;
}
