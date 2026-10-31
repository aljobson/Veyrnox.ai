import { AppState } from 'react-native';
import type { ApiClient } from '../src/lib/api';
import type { YourWins, WinsMilestone } from '../src/lib/yourWins';
let mockOwner: string | undefined = 'alice';
const mockRead = jest.fn(async (): Promise<any> => null);
const mockWrite = jest.fn(async () => undefined);
jest.mock('../src/lib/appCache', () => ({ getCacheUser: () => mockOwner, subscribeCacheUser: () => () => {}, appCache: { read: (...args: unknown[]) => mockRead(...args as []), write: (...args: unknown[]) => mockWrite(...args as []) } }));
import { winsSeenDiff } from '../src/lib/yourWins';
import { createWinsCoordinator } from '../src/lib/yourWinsCelebrations';
import { emitCelebration, onCelebrate, celebrationBusy, type CelebrationEvent } from '../src/lib/veyMotion';
const reached = (key: WinsMilestone['key'], day: number): WinsMilestone => ({ key, reached_at: `2026-10-${day}T00:00:00Z`, progress: 1, target: 1 });
const data = (milestones: WinsMilestone[]) => ({ milestones } as YourWins);
beforeEach(() => { mockOwner = 'alice'; mockWrite.mockClear(); mockRead.mockReset(); mockRead.mockResolvedValue(null); Object.defineProperty(AppState,'currentState',{configurable:true,value:'active'}); });
test('first load seeds every reached milestone; phone never chooses first image or first video', () => {
    const items=[reached('first_image',20),reached('first_video',21),reached('creations_10',22)];
    expect(winsSeenDiff(items,null)).toEqual({seen:['first_image','first_video','creations_10'],newest:null});
    expect(winsSeenDiff(items.slice(0,2),[]).newest).toBeNull();
    expect(winsSeenDiff([...items,reached('first_post',23)],[]).newest?.key).toBe('first_post');
});
test('a wins refresh waits for BOTH showing and queued legacy events, then rechecks newest; one per foreground', async () => {
    const shown: CelebrationEvent[]=[];const off=onCelebrate(event=>shown.push(event));
    let seen: string[] | null=[];
    const coordinator=createWinsCoordinator({owner:()=>mockOwner,busy:celebrationBusy,emit:emitCelebration,read:async()=>seen,write:async(_,v)=>{seen=v;}});
    try {
        emitCelebration({kind:'firstCreation',onShown:()=>{},onDone:()=>{}});
        emitCelebration({kind:'firstVideo',onShown:()=>{},onDone:()=>{}});
        await coordinator.update('alice',data([reached('first_image',20),reached('first_video',21),reached('creations_10',22)]));
        expect(shown).toHaveLength(2);expect(celebrationBusy()).toBe(true);
        shown[0].onDone();await coordinator.recheck();expect(shown).toHaveLength(2);
        await coordinator.update('alice',data([reached('creations_10',22),reached('first_post',23)]));
        shown[1].onDone();await coordinator.recheck();expect(shown[2]).toMatchObject({kind:'winsMilestone',milestone:'first_post'});
        shown[2].onShown();shown[2].onDone();
        await coordinator.update('alice',data([reached('creations_50',24)]));expect(shown).toHaveLength(3);
        await coordinator.foreground();await coordinator.update('alice',data([reached('streak_7',25)]));expect(shown[3]).toMatchObject({kind:'winsMilestone',milestone:'streak_7'});
    } finally { shown.forEach(event=>event.onDone());off(); }
});
test('first account read is quiet, unavailable data cancels pending work, owner change drops async results',async()=>{
    const emit=jest.fn(()=>true),write=jest.fn(async()=>{});
    const coordinator=createWinsCoordinator({owner:()=>mockOwner,busy:()=>false,emit,read:async()=>null,write});
    await coordinator.update('alice',data([reached('creations_50',24)]));expect(emit).not.toHaveBeenCalled();expect(write).toHaveBeenCalled();
    await coordinator.update('alice',null);await coordinator.recheck();expect(emit).not.toHaveBeenCalled();
    mockOwner='bob';await coordinator.update('alice',data([reached('streak_7',25)]));expect(emit).not.toHaveBeenCalled();
});
test('fetch flag fails closed; 404 and server failures hide data; account changes discard responses',async()=>{
    const original=process.env.EXPO_PUBLIC_YOUR_WINS_ENABLED;
    try {
        for(const flag of ['false','TRUE','1','true']) {
            process.env.EXPO_PUBLIC_YOUR_WINS_ENABLED=flag;
            let module!: typeof import('../src/lib/yourWins');jest.isolateModules(()=>{module=require('../src/lib/yourWins');});
            const request=jest.fn(async()=>{throw {status:404};});
            expect(await module.fetchYourWins({request} as unknown as ApiClient)).toBeNull();expect(request).toHaveBeenCalledTimes(flag==='true'?1:0);
            if(flag==='true') {
                request.mockImplementation(async()=>{throw {status:502};});expect(await module.fetchYourWins({request} as unknown as ApiClient)).toBeNull();
                const other=jest.fn(async()=>{mockOwner='bob';return {ok:true};});expect(await module.fetchYourWins({request:other} as unknown as ApiClient)).toBeNull();
            }
        }
    } finally { if(original===undefined) delete process.env.EXPO_PUBLIC_YOUR_WINS_ENABLED;else process.env.EXPO_PUBLIC_YOUR_WINS_ENABLED=original; }
});

test('phone waits for onShown before persisting; cancellation leaves the milestone available',async()=>{
    let seen: string[] | null=[];const events:CelebrationEvent[]=[];
    const coordinator=createWinsCoordinator({owner:()=>mockOwner,busy:()=>false,read:async()=>seen,write:async(_,v)=>{seen=v;},emit:e=>{events.push(e);return true;}});
    const result=data([reached('first_image',20),reached('first_video',21),reached('creations_10',22)]);
    await coordinator.update('alice',result);
    expect(seen).toEqual(['first_image','first_video']);expect(events).toHaveLength(1);
    events[0].onDone();await coordinator.recheck();expect(events).toHaveLength(1);
    await coordinator.update('alice',result);expect(events).toHaveLength(2);expect(seen).not.toContain('creations_10');
    events[1].onShown();expect(seen).toContain('creations_10');events[1].onDone();
    await coordinator.update('alice',data([reached('first_post',23)]));expect(seen).not.toContain('first_post');expect(events).toHaveLength(2);
    coordinator.foreground();await coordinator.recheck();expect(events).toHaveLength(2);
    await coordinator.update('alice',data([reached('first_post',23)]));expect(events).toHaveLength(3);
});
test('phone caches per account for five minutes, including failures; only network reads check celebrations',async()=>{
    const original=process.env.EXPO_PUBLIC_YOUR_WINS_ENABLED;process.env.EXPO_PUBLIC_YOUR_WINS_ENABLED='true';
    let module!: typeof import('../src/lib/yourWins');jest.isolateModules(()=>{module=require('../src/lib/yourWins');});
    let now=1000;const clock=jest.spyOn(Date,'now').mockImplementation(()=>now);
    const request=jest.fn(async()=>({ok:true})),check=jest.fn();const api={request} as unknown as ApiClient;
    try {
        await Promise.all([module.fetchYourWins(api,check),module.fetchYourWins(api)]);
        expect(request).toHaveBeenCalledTimes(1);expect(check).toHaveBeenCalledTimes(1);
        now+=299999;await module.fetchYourWins(api,check);expect(request).toHaveBeenCalledTimes(1);expect(check).toHaveBeenCalledTimes(1);
        now++;request.mockRejectedValueOnce({status:502});expect(await module.fetchYourWins(api,check)).toBeNull();
        expect(request).toHaveBeenCalledTimes(2);expect(check).toHaveBeenCalledTimes(2);
        await module.fetchYourWins(api,check);expect(request).toHaveBeenCalledTimes(2);
        mockOwner='bob';await module.fetchYourWins(api,check);expect(request).toHaveBeenCalledTimes(3);
        mockOwner='carol';mockRead.mockResolvedValueOnce({value:{ok:true},meta:{savedAt:now,stale:false}});
        await module.fetchYourWins(api,check);expect(request).toHaveBeenCalledTimes(3);expect(check).toHaveBeenCalledTimes(3);
    } finally {clock.mockRestore();if(original===undefined)delete process.env.EXPO_PUBLIC_YOUR_WINS_ENABLED;else process.env.EXPO_PUBLIC_YOUR_WINS_ENABLED=original;}
});
