import type { ComponentType } from 'react';
import type { DrawOnImageProps } from '../components/DrawOnImage';

export function loadDrawOnImage(): ComponentType<DrawOnImageProps> | null {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- old binaries may lack Skia
        return require('../components/DrawOnImage').DrawOnImage;
    } catch {
        return null;
    }
}
