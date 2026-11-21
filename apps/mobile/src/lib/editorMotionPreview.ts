import { evaluatedTransform } from '../../../../app/veyrnox/_lib/editorAnimation.mjs';
import type { ViewStyle } from 'react-native';
import type { Clip, Media } from './nativeEditorModel';
export function previewTransformStyle(clip: Clip, offset: number, width: number, height: number): ViewStyle {
    const v = evaluatedTransform(clip, offset, false);
    return { opacity: v.opacity, transform: [{ translateX: (v.x - .5) * width }, { translateY: (v.y - .5) * height },
        { rotate: `${v.rotation}deg` }, { scaleX: v.scale * (v.flipX ? -1 : 1) }, { scaleY: v.scale * (v.flipY ? -1 : 1) }] };
}
/** Size the entire fitted source before transforming it; only the containing canvas clips Cover overflow. */
export function fittedMediaStyle(clip: Clip, media: Media, width: number, height: number) {
    const sourceWidth = media.width && media.width > 0 ? media.width : width;
    const sourceHeight = media.height && media.height > 0 ? media.height : height;
    const scale = sourceWidth && sourceHeight ? (clip.fit === 'cover' ? Math.max : Math.min)(width / sourceWidth, height / sourceHeight) : 1;
    const w = sourceWidth * scale, h = sourceHeight * scale;
    return { width: w, height: h, left: (width - w) / 2, top: (height - h) / 2 };
}
