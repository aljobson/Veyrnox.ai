import type { ChatImage } from './chatAttach';
import type { VideoResult } from './chatPhotos';

type Notice = string | null;
type VideoText = 'chatDepth.reading' | 'chatDepth.videoRoom' | 'chatDepth.videoNone' | 'chatDepth.videoFailed';
interface VideoAttachDeps {
    pick: (room: number, onReading: () => void) => Promise<VideoResult>;
    setNotice: (value: Notice | ((current: Notice) => Notice)) => void;
    addImages: (images: ChatImage[], maxImages: number) => void;
    isMounted: () => boolean;
    t: (key: VideoText, params?: { count: number }) => string;
    videoAttempt: { current: number };
}

// One instance per screen: starting a picker retires the previous attempt's reading notice.
export function createVideoAttach({ pick, setNotice, addImages, isMounted, t, videoAttempt }: VideoAttachDeps) {
    let ownedReading = false;
    let reading = '';
    const clearReading = () => {
        if (!ownedReading) return;
        const previousReading = reading;
        ownedReading = false;
        setNotice(current => current === previousReading ? null : current);
    };
    return async (room: number, maxImages: number): Promise<void> => {
        const attempt = ++videoAttempt.current;
        const current = () => attempt === videoAttempt.current && isMounted();
        if (!current()) return;
        clearReading();
        const problem = (key: VideoText) => {
            if (!current()) return;
            ownedReading = false;
            setNotice(t(key, { count: maxImages }));
        };
        try {
            const result = await pick(room, () => {
                if (!current()) return;
                reading = t('chatDepth.reading');
                ownedReading = true;
                setNotice(reading);
            });
            if (!current()) return;
            if (result.images.length) addImages(result.images, maxImages);
            if (result.problem === 'room') problem('chatDepth.videoRoom');
            else if (result.problem === 'video_none') problem('chatDepth.videoNone');
            else if (result.problem === 'video_unreadable') problem('chatDepth.videoFailed');
        } catch { problem('chatDepth.videoFailed'); }
        finally { if (current()) clearReading(); }
    };
}
