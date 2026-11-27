export type SafeAreaGuideId = 'off' | 'short-form';
export type SafeAreaAvoidZone = Readonly<{
    id: 'actions' | 'caption-navigation';
    edge: 'right' | 'bottom';
    thicknessUnits: number;
    fromUnits: number;
    toUnits: number;
}>;
export type SafeAreaGuide = Readonly<{
    id: SafeAreaGuideId;
    labelKey: string;
    grid?: Readonly<{ columns: number; rows: number }>;
    insets: Readonly<{ top: number; right: number; bottom: number; left: number }> | null;
    avoidZones?: readonly SafeAreaAvoidZone[];
}>;
export const SAFE_AREA_GUIDES: readonly SafeAreaGuide[];
export const SAFE_AREA_GUIDE_IDS: readonly SafeAreaGuideId[];
export function safeAreaGuide(id: unknown): SafeAreaGuide;
export function contentGuideFor(options: { width: number; height: number; preset?: SafeAreaGuideId }): Readonly<{
    id: SafeAreaGuideId;
    portrait: boolean;
    content: Readonly<{ top: number; right: number; bottom: number; left: number }>;
    avoidZones?: readonly SafeAreaAvoidZone[];
}> | null;
export function safeAreaPercentStyle(id: unknown, width: number, height: number): { top: string; right: string; bottom: string; left: string } | null;
