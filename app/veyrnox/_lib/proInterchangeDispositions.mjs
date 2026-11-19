import { loss } from './proInterchangeTime.mjs';
// Generated from explicit groups, independently compared with validator allowlists in tests.
// Descendants inherit their parent's disposition unless an explicit dotted entry overrides it.
const table = (convert, approximate, drop) => Object.freeze(Object.fromEntries([
    ...convert.split(' ').filter(Boolean).map(k => [k, 'convert']),
    ...approximate.split(' ').filter(Boolean).map(k => [k, 'approximate']),
    ...drop.split(' ').filter(Boolean).map(k => [k, 'drop']),
]));
export const DISPOSITIONS = Object.freeze({
    document: table('schemaVersion fps seq aspect media video audio text tracks markers', '', 'background folders fonts'),
    clip: table('id start len trackId mediaId in rate reverse freezeFrame', 'volume pan transform crop', 'animation keyframes groupId transition fadeIn fadeOut eq filter mask maskSettings maskKeyframes colourAdjustment blend fit effect transitionType speedCurve background parameterKeyframes preservePitch audioProcessing audioEffects smartPicture'),
    text: table('id start len trackId', 'text x y size style', 'animation keyframes groupId caption words wordStyle wordsEstimated'),
    track: table('id kind name locked muted hidden solo', '', ''),
    media: table('id kind frames name hasAudio width height sourceName assetSource', '', 'graphic folder attribution originalAudio'),
    marker: table('id frame label color', '', ''),
});
export const NESTED_DISPOSITIONS = Object.freeze({
    clip: Object.freeze({'transform.x':'approximate','transform.y':'approximate','transform.scale':'approximate','transform.rotation':'convert','transform.opacity':'convert','transform.flipX':'drop','transform.flipY':'drop'}),
    text: Object.freeze({'style.color':'convert','style.font':'drop','style.weight':'drop','style.align':'drop','style.background':'drop','style.backgroundOpacity':'drop','style.stroke':'drop','style.strokeWidth':'drop'}),
});
export function disposition(kind, dottedKey) { return NESTED_DISPOSITIONS[kind]?.[dottedKey] || DISPOSITIONS[kind]?.[dottedKey] || DISPOSITIONS[kind]?.[dottedKey.split('.')[0]]; }
export function reportDispositions(value, kind, path, report) {
    const visit = (v, key) => {
        const d = disposition(kind, key);
        if (d !== 'convert') loss(report, `${path}.${key}`, key, d === 'approximate' ? 'approximated' : 'dropped', d === 'approximate' ? 'Converted approximately; inspect in the destination editor.' : 'No verified FilmCraft equivalent.');
        if (v && typeof v === 'object') for (const [k, child] of Object.entries(v)) visit(child, `${key}.${k}`);
    };
    for (const [key, child] of Object.entries(value)) {
        // Document containers have their own key tables.
        if (kind === 'document' && ['media','video','audio','text','tracks','markers'].includes(key)) continue;
        visit(child, key);
    }
}
