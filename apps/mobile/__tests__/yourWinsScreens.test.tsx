import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import { YourWinsCard } from '../src/components/wins/YourWinsCard';
import YourWinsScreen from '../src/app/(app)/wins';
import type { YourWins } from '../src/lib/yourWins';
let mockData: YourWins | null = null;
const mockPush = jest.fn();
jest.mock('../src/lib/useYourWins',()=>({useYourWins:()=>({data:mockData,loading:false})}));
jest.mock('expo-router',()=>({useRouter:()=>({push:mockPush}),Stack:{Screen:()=>null}}));
jest.mock('../src/components/VeyCardPeek',()=>({VeyCardPeek:()=>null,peekRoom:()=>40}));
const fixture=(): YourWins=>({ok:true,week_start:'2026-10-26T00:00:00Z',
    week:{creations:{total:3,by_type:{image:1,video:1,audio:1,other:0}},video_seconds:65,credits_used:7,posts:2,views:null},
    all:{creations:{total:42,by_type:{image:30,video:7,audio:4,other:1}},video_seconds:125,credits_used:80,posts:12,views:{total:900,networks:['instagram']}},
    milestones:[{key:'creations_50',reached_at:null,progress:42,target:50}],
});
let root: Root;
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;root=createRoot();mockData=fixture();mockPush.mockClear();});
afterEach(async()=>{await act(async()=>root.unmount());});
const text=()=>root.container.queryAll(n=>n.children.some(c=>typeof c==='string')).flatMap(n=>n.children.filter(c=>typeof c==='string')).join(' ');
const click=async(label:string)=>{const button=root.container.queryAll(n=>n.props.accessibilityRole==='button' && n.queryAll(c=>c.children.includes(label)).length>0)[0];await act(async()=>button.props.onClick({nativeEvent:{},currentTarget:1,target:1}));};
test('card hides disabled/unavailable data and has only two stats without streak',async()=>{
    mockData=null;await act(async()=>root.render(<YourWinsCard/>));expect(text()).toBe('');
    mockData=fixture();await act(async()=>root.render(<YourWinsCard/>));expect(text()).toContain('42');expect(text()).not.toMatch(/streak|check-in/i);
    const button=root.container.queryAll(n=>n.props.accessibilityHint==='See your wins')[0];expect(button.props.accessibilityLabel).toContain('Creations: 42');expect(button.props.accessibilityLabel).toContain('Posts published: 12');expect(button.props.accessibilityLabel).toContain('Next: 50 creations · 42 of 50');await act(async()=>button.props.onClick({nativeEvent:{},currentTarget:1,target:1}));expect(mockPush).toHaveBeenCalledWith('/wins');
});
test('page switches week/all, announces selection, labels the type bar, hides absent views and streak',async()=>{
    await act(async()=>root.render(<YourWinsScreen/>));expect(text()).toContain('1 min 5 sec');expect(text()).not.toContain('Views');expect(text()).not.toContain('Check-in day streak');expect(text()).not.toContain('7-day check-in streak');
    expect(text()).toContain('Images');expect(text()).toContain('Voice and music');expect(text()).not.toContain('Other');
    expect(root.container.queryAll(n=>n.props.accessibilityState?.selected===true)).toHaveLength(1);
    await click('All time');expect(text()).toContain('42');expect(text()).toContain('2 min 5 sec');expect(text()).toContain('900');expect(text()).toContain('reported by instagram');expect(text()).toContain('Other');
    expect(root.container.queryAll(n=>n.props.accessibilityState?.selected===true)[0].queryAll(n=>n.children.includes('All time')).length).toBeGreaterThan(0);
});
test('streak cells announce dates and state and card includes current',async()=>{
    mockData!.streak={current:2,best:7,last7:[false,false,false,false,false,true,true]};
    await act(async()=>root.render(<YourWinsScreen/>));expect(text()).toContain('2 days');expect(text()).toContain('7 days');
    expect(root.container.queryAll(n=>n.props.accessibilityRole==='image')).toHaveLength(7);
    await act(async()=>root.render(<YourWinsCard/>));expect(text()).toContain('Check-in day streak');
    expect(root.container.queryAll(n=>n.props.accessibilityHint==='See your wins')[0].props.accessibilityLabel).toContain('Check-in day streak: 2 days');
});
