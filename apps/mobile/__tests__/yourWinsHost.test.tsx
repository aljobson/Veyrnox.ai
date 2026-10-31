import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { CelebrationHost, CELEBRATION_MS } from '../src/components/CelebrationHost';
import { emitCelebration, type CelebrationKind, celebrationBusy, cancelWinsCelebrations, resetCelebrationsForTests } from '../src/lib/veyMotion';
const mockPush=jest.fn();
jest.mock('expo-router',()=>({usePathname:()=>'/account',router:{push:(...args:unknown[])=>mockPush(...args)}}));
jest.mock('../src/lib/appCache',()=>({subscribeCacheUser:()=>()=>{}}));
jest.mock('../src/lib/haptics',()=>({playSuccess:jest.fn()}));
jest.mock('../src/components/ui/useReducedMotion',()=>({useReducedMotion:()=>true}));
jest.mock('../src/components/VeyCharacter',()=>({VeyCharacter:(props:object)=>require('react').createElement(require('react-native').View,{...props,testID:'vey'})}));
// Load React Native's lazy host exports before replacing timers.
void [RN.View, RN.Text, RN.Pressable, RN.Modal];
let root:Root;
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;resetCelebrationsForTests();jest.useFakeTimers({doNotFake:['queueMicrotask','nextTick','setImmediate']});root=createRoot();mockPush.mockClear();});
afterEach(async()=>{act(()=>root.unmount());jest.clearAllTimers();resetCelebrationsForTests();jest.useRealTimers();});
async function button(label:string) { const node=root.container.queryAll(n=>n.props.accessibilityRole==='button'&&n.props.accessibilityLabel===label)[0];expect(node).toBeDefined();act(()=>node.props.onClick({nativeEvent:{},currentTarget:1,target:1})); }
test('wins has real labeled buttons, header, still cheer, no confetti, and no legacy timeout',async()=>{
    act(()=>root.render(<CelebrationHost/>));const done=jest.fn();
    act(()=>{emitCelebration({kind:'winsMilestone',milestone:'creations_10',onShown:()=>{},onDone:done});});
    expect(root.container.queryAll(n=>n.props.testID==='vey')[0].props.mood).toBe('cheer');expect(root.container.queryAll(n=>n.props.testID==='confetti-piece')).toHaveLength(0);
    expect(root.container.queryAll(n=>n.props.accessibilityRole==='header')).toHaveLength(1);
    expect(root.container.queryAll(n=>n.props.accessibilityRole==='button')).toHaveLength(2);
    act(()=>jest.advanceTimersByTime(CELEBRATION_MS+1));expect(done).not.toHaveBeenCalled();
    await button('See your wins');expect(mockPush).toHaveBeenCalledWith('/wins');expect(done).toHaveBeenCalledTimes(1);expect(celebrationBusy()).toBe(false);
    act(()=>{emitCelebration({kind:'winsMilestone',milestone:'first_post',onShown:()=>{},onDone:done});});await button('Close');expect(mockPush).toHaveBeenCalledTimes(1);expect(done).toHaveBeenCalledTimes(2);
});
test.each(['firstCreation','firstVideo','afterOnboarding'] as CelebrationKind[])('legacy %s retains the decorative overlay and timing',async kind=>{
    act(()=>root.render(<CelebrationHost/>));const done=jest.fn();
    act(()=>{emitCelebration({kind,onShown:()=>{},onDone:done});});
    expect(root.container.queryAll(n=>n.props.pointerEvents==='none').length).toBeGreaterThan(0);
    expect(root.container.queryAll(n=>n.props.accessibilityRole==='button')).toHaveLength(1);
    expect(root.container.queryAll(n=>n.props.accessibilityLabel==='See your wins')).toHaveLength(0);
    act(()=>jest.advanceTimersByTime(CELEBRATION_MS));expect(done).toHaveBeenCalledTimes(1);
});

test('a failed wins refresh dismisses wins while retaining a queued legacy celebration',async()=>{
    act(()=>root.render(<CelebrationHost/>));const winsDone=jest.fn(),legacyDone=jest.fn();
    act(()=>{
        emitCelebration({kind:'winsMilestone',milestone:'first_post',onShown:()=>{},onDone:winsDone});
        emitCelebration({kind:'firstVideo',onShown:()=>{},onDone:legacyDone});
        cancelWinsCelebrations();
    });
    expect(winsDone).toHaveBeenCalledTimes(1);expect(legacyDone).not.toHaveBeenCalled();expect(celebrationBusy()).toBe(true);
    expect(root.container.queryAll(n=>n.props.accessibilityLabel==='See your wins')).toHaveLength(0);
    act(()=>jest.advanceTimersByTime(CELEBRATION_MS));expect(legacyDone).toHaveBeenCalledTimes(1);
});
