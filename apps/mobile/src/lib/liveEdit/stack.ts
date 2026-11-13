import { normalizeStack, MAKEUP, type Stack } from './engine';
import { sameFrame, type FrameId, type Inference } from './protocol';
export function assembleStack(input: Stack, frame: FrameId, inference: Inference | null) {
    const stack = normalizeStack(input);
    const active = inference && sameFrame(frame, inference) && inference.count === 1 ? inference : null;
    const passes = [
        ...(stack.look !== 'original' && stack.strength > 0 ? ['look'] : []),
        ...(active && stack.smoothing > 0 ? ['smoothing'] : []),
        ...MAKEUP.filter(d => active && stack.makeup[d.id].strength > 0).map(d => d.id),
        ...(active?.hair && stack.hair.strength > 0 ? ['hair'] : []),
    ];
    return { stack, active, passes };
}
