import { legacyReferences, replaceSlotReferences, type GenerationReference } from '../src/lib/sources';
import { stageCreativeSourceHandoff, consumeCreativeSourceHandoff } from '../src/lib/creativeSourceHandoff';
test('mixed-origin handoffs preserve order and own a copy of every array', () => {
    const references: GenerationReference[] = [{slot:'image',origin:'upload',key:'a'},{slot:'image',origin:'asset',asset_id:'b'},{slot:'image',origin:'upload',key:'c'}];
    const uploaded = { image: ['a','c'] };
    const key = stageCreativeSourceHandoff({recipe:'attach',modelId:'edit',references,uploaded,fromLibrary:{}},100);
    uploaded.image.reverse(); references.reverse();
    const handoff = consumeCreativeSourceHandoff(key,'attach','edit',101);
    expect(handoff?.uploaded.image).toEqual(['a','c']);
    expect(handoff?.references?.map(ref=>ref.origin)).toEqual(['upload','asset','upload']);
    expect(handoff?.references?.[0]).toEqual({slot:'image',origin:'upload',key:'a'});
});
test('legacy arrays and slot updates preserve every reference', () => {
    const refs = legacyReferences({image:['a','b','c']},{});
    expect(refs).toHaveLength(3);
    expect(replaceSlotReferences(refs,'image',[refs[2],refs[1],refs[0]])).toEqual([...refs].reverse());
});
