import { makeupFixture } from './photo-studio-makeup-fixture.mjs';
// Original synthetic plateaus; no photo, identity, third-party assets or gradient-edge goldens.
export function hairFixture() {
    const { points } = makeupFixture(), source = document.createElement('canvas');
    source.width = source.height = 128;
    const ctx = source.getContext('2d');
    ctx.fillStyle = 'rgb(128,128,128)'; ctx.fillRect(0,0,128,128);
    ctx.fillStyle = 'rgb(64,64,64)'; ctx.fillRect(0,0,48,128);
    ctx.fillStyle = 'rgb(192,192,192)'; ctx.fillRect(96,0,32,128);
    ctx.fillStyle = 'rgb(40,70,90)'; ctx.fillRect(0,0,128,16);
    ctx.fillStyle = 'rgb(200,170,140)'; ctx.fillRect(0,112,128,16);
    const hair = new Float32Array(16 * 16);
    for (let y=2;y<14;y++) for(let x=2;x<14;x++) hair[y*16+x] = x===2 ? .1 : x===3 ? .2 : x===4 ? .5 : 1;
    return { source, points, mask: { width:16, height:16, hair } };
}
// Analytic linear-light references on constant plateaus. Crops are 3x3, tolerance 2/255.
export const HAIR_GOLDENS = [
    { name:'copper', x:64, y:48, hair:{shade:'copper'}, rgb:[193,103,71] },
    { name:'plum', x:64, y:48, hair:{shade:'plum'}, rgb:[157,112,165] },
    { name:'teal', x:64, y:48, hair:{shade:'teal'}, rgb:[71,138,147] },
    { name:'blonde', x:64, y:48, hair:{shade:'blonde'}, rgb:[157,124,0] },
    { name:'ombre-roots', x:64, y:28, hair:{mode:'ombre'}, rgb:[193,103,71] },
    { name:'ombre-tips', x:64, y:100, hair:{mode:'ombre'}, rgb:[157,124,0] },
    { name:'highlights', x:64, y:48, hair:{mode:'highlights'}, rgb:[144,123,119] },
];
