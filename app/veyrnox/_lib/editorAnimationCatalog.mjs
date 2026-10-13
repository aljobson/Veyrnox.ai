import { ANIMATIONS, COMBOS } from './editorAnimation.mjs';
import { updateSequenceClip, trackFor } from './editorSequence.mjs';
import { validateSequence } from './editorSequenceValidation.mjs';
const preset=(id,name,description)=>Object.freeze({id,name,description});
/** Original motion and reveal recipes. Cards refer to the actual shared frame evaluator, never downloaded assets. */
export const ANIMATION_CATALOG=Object.freeze([
    preset('none','None','Keep the original motion and opacity.'),
    preset('fade','Fade','Reveal or conceal the clip by changing opacity.'),
    preset('slide-left','Slide left','Enter from the left; exit to the right.'),
    preset('slide-right','Slide right','Enter from the right; exit to the left.'),
    preset('slide-up','Slide up','Enter from above or exit above the picture.'),
    preset('slide-down','Slide down','Enter from below or exit below the picture.'),
    preset('zoom','Zoom','Grow from half size on entry; shrink on exit.'),
    preset('spin','Half turn','Turn 180 degrees while revealing or concealing the clip.'),
    preset('bounce','Damped bounce','Settle into place with a shrinking vertical bounce.'),
    preset('wipe-left','Wipe from left','Reveal from the left on entry; retract toward the left on exit.'),
    preset('wipe-right','Wipe from right','Reveal from the right on entry; retract toward the right on exit.'),
    preset('wipe-up','Wipe from top','Reveal from the top on entry; retract toward the top on exit.'),
    preset('wipe-down','Wipe from bottom','Reveal from the bottom on entry; retract toward the bottom on exit.')
]);
export const LOOP_CATALOG=Object.freeze([
    preset('none','None','Keep the original motion.'),
    preset('float','Float','Move gently above and below the original position.'),
    preset('pulse','Pulse','Grow and shrink around the original scale.'),
    preset('spin','Turn','Turn continuously around the clip centre.'),
    preset('drift','Drift','Follow a smooth elliptical path.'),
    preset('sway','Sway','Move gently from side to side.'),
    preset('wobble','Wobble','Rock the angle with a small sideways motion.'),
    preset('bounce','Loop bounce','Rise and return with a small change of scale.')
]);
export function searchAnimations(mode='in',query='') {
    const words=String(query).trim().toLowerCase().split(/\s+/).filter(Boolean);
    return (mode==='loop'?LOOP_CATALOG:ANIMATION_CATALOG).filter(item=>words.every(word=>`${item.name} ${item.description}`.toLowerCase().includes(word)));
}
export function animationSelectionProblem(tl,selected) {
    if(!['video','text'].includes(selected?.track) || typeof selected.id!=='string')return 'Select one visual clip, title or caption.';
    const clip=tl[selected.track]?.find(item=>item.id===selected.id);
    if(!clip)return 'Select a current visual clip, title or caption.';
    if(trackFor(tl,clip)?.locked)return 'Unlock this track before changing animation.';
    return null;
}
/** Parent history receives one checked replacement. Applying one channel preserves every other channel and motion key. */
export function applyAnimationCatalog(tl,selected,mode,presetId,{duration=15,period=60,amount=.5,restart=false}={}) {
    const problem=validateSequence(tl)||animationSelectionProblem(tl,selected);if(problem)return {error:problem};
    if(!['in','out','loop'].includes(mode) || !(mode==='loop'?COMBOS:ANIMATIONS).includes(presetId))return {error:'Choose a current animation preset.'};
    if(!Number.isInteger(duration)||duration<1||duration>120||!Number.isInteger(period)||period<1||period>18000||!Number.isFinite(amount)||amount<0||amount>1||typeof restart!=='boolean')return {error:'Choose valid animation timing and strength.'};
    const clip=tl[selected.track].find(item=>item.id===selected.id),base=clip.animation||{in:'none',out:'none',duration:15};
    const animation={...base,...(mode==='loop'?{combo:presetId,period,amount}:{[mode]:presetId,duration}),...(restart?{offset:0,span:clip.len}:{})};
    return updateSequenceClip(tl,selected.track,selected.id,{animation});
}
export function resetAnimationCatalog(tl,selected) {
    const problem=validateSequence(tl)||animationSelectionProblem(tl,selected);if(problem)return {error:problem};
    return updateSequenceClip(tl,selected.track,selected.id,{animation:{in:'none',out:'none',duration:15,combo:'none',period:60,amount:.5}});
}
