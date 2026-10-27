import { BODY_MAX_FONT_SCALE } from './a11y';
// Reserve room for icons, padding and a complete word such as “Templates”.
export function createTileColumns(width: number, fontScale: number, appScale = 1): 1 | 2 {
    const tile = (width - 32 - 8) / 2;
    return tile >= 80 + 100 * Math.min(fontScale, BODY_MAX_FONT_SCALE) * appScale ? 2 : 1;
}
