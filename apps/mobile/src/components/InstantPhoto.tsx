import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import type * as SkiaModule from '@shopify/react-native-skia';

declare const require: (id: string) => any;
type Skia = typeof SkiaModule;
let loaded: Skia | null | undefined;
// Skia is native. If it is missing the photo still shows, only without the live look.
function skia(): Skia | null {
    if (loaded === undefined) {
        try { loaded = require('@shopify/react-native-skia') as Skia; } catch { loaded = null; }
    }
    return loaded;
}

export const liveLooksAvailable = (): boolean => skia() !== null;

export interface InstantPhotoProps {
    uri: string;
    matrix: readonly number[];
    label: string;
    style?: StyleProp<ViewStyle>;
    cover?: boolean;
    onError?: () => void;
    onLoad?: () => void;
}

// Draws the photo through a colour matrix on the GPU, so a look follows a finger as it moves.
export function InstantPhoto(props: InstantPhotoProps) {
    const lib = skia();
    return lib ? <LivePhoto key={props.uri} {...props} lib={lib} /> : <Image source={{ uri: props.uri }} cachePolicy="none" transition={0} style={props.style as never} contentFit={props.cover ? 'cover' : 'contain'} accessibilityLabel={props.label} onError={props.onError} onLoad={props.onLoad} />;
}

function LivePhoto({ uri, matrix, label, style, cover, onError, onLoad, lib }: InstantPhotoProps & { lib: Skia }) {
    const [size, setSize] = useState({ width: 0, height: 0 });
    const image = lib.useImage(uri, () => onError?.());
    const hasImage = !!image;
    // Tell the screen once the picture is decoded, so it can clear a failed-preview notice.
    useEffect(() => { if (hasImage) onLoad?.(); }, [hasImage, uri]);
    const layout = (event: LayoutChangeEvent) => setSize(event.nativeEvent.layout);
    return (
        <View accessible accessibilityRole="image" accessibilityLabel={label} style={style} onLayout={layout}>
            {size.width > 0 && image ? <lib.Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
                <lib.Image image={image} x={0} y={0} width={size.width} height={size.height} fit={cover ? 'cover' : 'contain'}>
                    <lib.ColorMatrix matrix={matrix as number[]} />
                </lib.Image>
            </lib.Canvas> : null}
        </View>
    );
}
