export type CanvasPreset = 'source' | '16:9' | '9:16' | '1:1' | '4:5';
export type ProjectCanvasPreset = Exclude<CanvasPreset, 'source'>;
export type CustomCanvasAspect = `custom:${number}x${number}`;
export type ProjectCanvasAspect = ProjectCanvasPreset | CustomCanvasAspect;
export type EditorCanvasAspect = CanvasPreset | CustomCanvasAspect;
export type CanvasSize = { width: number; height: number };

export const EDITOR_CANVAS_PRESETS: readonly CanvasPreset[];
export const PROJECT_CANVAS_PRESETS: readonly ProjectCanvasPreset[];
export function formatCustomCanvasAspect(width: number | string, height: number | string): CustomCanvasAspect | null;
export function customCanvasParts(value: unknown): CanvasSize | null;
export function validCanvasAspect(value: unknown, options?: { allowSource?: boolean }): value is EditorCanvasAspect;
export function canvasAspectSize(value: unknown, sourceWidth?: number, sourceHeight?: number): CanvasSize | null;
export function canvasAspectRatio(value: unknown, sourceWidth?: number, sourceHeight?: number): number | null;
export function canvasAspectFromDimensions(width: number, height: number): ProjectCanvasAspect | null;
export function canvasPixelSize(value: unknown, targetHeight?: number, maximumWidth?: number, sourceWidth?: number, sourceHeight?: number): CanvasSize;
export function canvasResolutionSize(value: unknown, edge: number, sourceWidth?: number, sourceHeight?: number): CanvasSize | null;
