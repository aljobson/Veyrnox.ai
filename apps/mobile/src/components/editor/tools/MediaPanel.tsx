import { View } from 'react-native';
import { t, plural } from '../../../lib/i18n';

import { styles } from '../fullEditorStyles';
import { Action, PanelHeading, EmptyPanel } from '../EditorControls';

import { ProjectMediaRow } from './EditorRows';
import type { ToolPanelProps } from './types';
export function MediaPanel({ timeline, availableMedia, addMediaToTimeline, libraryPending, replacing, setLibraryKind, choosePhotos, chooseFiles, openAssetPacks }: Pick<ToolPanelProps, 'timeline' |
    'availableMedia' | 'addMediaToTimeline' | 'libraryPending' | 'replacing' | 'setLibraryKind' | 'choosePhotos' | 'chooseFiles' | 'openAssetPacks'>) {
    return <>
        <PanelHeading title={t('editor.projectmedia')} detail={plural('editor.itemsCount', availableMedia.length)} />
        {availableMedia.length ? availableMedia.map((item) => <ProjectMediaRow key={item.id} item={item} fps={timeline.fps} onAdd={addMediaToTimeline} />) : <EmptyPanel
            title={t('editor.nomediayet')} body={t('editor.chooseanexistingVeyrnoxcreationaproject')} />}
        <View style={styles.quickActions}><Action label={t('editor.libraryvideo')} disabled={libraryPending || replacing} onPress={() => setLibraryKind('video')} /><Action
            label={t('editor.libraryimage')} disabled={libraryPending || replacing} onPress={() => setLibraryKind('image')} /><Action label={t('editor.libraryaudio')}
            disabled={libraryPending || replacing} onPress={() => setLibraryKind('audio')} /><Action label={t('editor.photosvideos')} disabled={replacing} onPress={() => void
            choosePhotos()} /><Action label={t('editor.files')} disabled={replacing} onPress={() => void chooseFiles()} /><Action label={t('editorPack.title')} disabled={replacing}
            onPress={() => openAssetPacks?.()} /></View>
    </>;
}
