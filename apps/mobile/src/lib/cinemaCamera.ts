// ADR-0175: the web's Cinema camera, as prompt text. A copy of app/veyrnox/_lib/cinema.js; __tests__/cinemaCamera.test.ts
// reads that file and fails if the two drift. Client-side only: it changes the prompt, never the model or the price.

export const CAMERAS: Readonly<Record<string, string>> = {
    'Modular 8K Digital': 'modular 8K digital cinema camera',
    'Full-Frame Cine Digital': 'full-frame digital cinema camera',
    'Grand Format 70mm Film': 'grand format 70mm film camera',
    'Studio Digital S35': 'Super 35 studio digital camera',
    'Classic 16mm Film': 'classic 16mm film camera',
    'Premium Large Format Digital': 'premium large-format digital cinema camera',
};

export const LENSES: Readonly<Record<string, string>> = {
    'Premium Modern Prime': 'premium modern prime lens',
    'Classic Anamorphic': 'classic anamorphic lens',
    'Compact Anamorphic': 'compact anamorphic lens',
    '70s Cinema Prime': '1970s cinema prime lens',
    'Warm Cinema Prime': 'warm-toned cinema prime lens',
    'Vintage Prime': 'vintage prime lens',
    'Swirl Bokeh Portrait': 'swirl bokeh portrait lens',
    'Clinical Sharp Prime': 'ultra-sharp clinical prime lens',
    'Extreme Macro': 'extreme macro lens',
    'Creative Tilt Lens': 'creative tilt lens effect',
    'Halation Diffusion': 'halation diffusion filter',
};

export const FOCAL_LENGTHS: Readonly<Record<number, string>> = {
    8: 'ultra-wide perspective',
    14: 'wide-angle perspective',
    24: 'wide-angle dynamic perspective',
    35: 'natural cinematic perspective',
    50: 'standard portrait perspective',
    85: 'classic portrait perspective',
};

export const APERTURES: Readonly<Record<string, string>> = {
    'f/1.4': 'shallow depth of field, creamy bokeh',
    'f/4': 'balanced depth of field',
    'f/11': 'deep focus clarity, sharp foreground to background',
};

export interface Cinema {
    readonly camera: string;
    readonly lens: string;
    readonly focal: number;
    readonly aperture: string;
}

export const DEFAULT_CINEMA: Cinema = { camera: 'Studio Digital S35', lens: 'Premium Modern Prime', focal: 35, aperture: 'f/1.4' };

// The gateway refuses a prompt over 2000 characters.
export const PROMPT_MAX = 2000;

// The camera description appended to a prompt. Unknown values are dropped.
export function cinemaSuffix({ camera, lens, focal, aperture }: Cinema): string {
    const parts: string[] = [];
    if (CAMERAS[camera]) parts.push(`shot on a ${CAMERAS[camera]}`);
    if (LENSES[lens]) {
        const perspective = FOCAL_LENGTHS[focal];
        parts.push(perspective ? `using a ${LENSES[lens]} at ${focal}mm (${perspective})` : `using a ${LENSES[lens]}`);
    }
    if (APERTURES[aperture]) parts.push(`aperture ${aperture}`, APERTURES[aperture]);
    parts.push('cinematic lighting', 'natural color science', 'high dynamic range');
    return parts.join(', ');
}

// The prompt with the camera description appended. The person's text is cut, never the camera text, so the result
// always fits the gateway limit.
export function buildCinemaPrompt(base: string, settings: Cinema): string {
    const suffix = `, ${cinemaSuffix(settings)}`;
    const text = String(base || '').trim().slice(0, PROMPT_MAX - suffix.length);
    return text ? `${text}${suffix}` : '';
}

// A saved or restored value is kept only if it is one of the known choices.
export function sanitizeCinema(raw: unknown): Cinema {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof Cinema, unknown>>;
    return {
        camera: typeof r.camera === 'string' && r.camera in CAMERAS ? r.camera : DEFAULT_CINEMA.camera,
        lens: typeof r.lens === 'string' && r.lens in LENSES ? r.lens : DEFAULT_CINEMA.lens,
        focal: typeof r.focal === 'number' && r.focal in FOCAL_LENGTHS ? r.focal : DEFAULT_CINEMA.focal,
        aperture: typeof r.aperture === 'string' && r.aperture in APERTURES ? r.aperture : DEFAULT_CINEMA.aperture,
    };
}
