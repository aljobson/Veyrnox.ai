import { useLocalSearchParams } from 'expo-router';
import { DialogueStudio } from '../../components/dialogue/DialogueStudio';
export default function DialogueRoute() {
    const { reopen } = useLocalSearchParams<{ reopen?: string | string[] }>();
    return <DialogueStudio reopen={reopen} />;
}
