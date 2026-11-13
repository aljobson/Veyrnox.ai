// Original procedural face geometry/colour patches, created for this test; no person image.
import { OVAL, LIPS, INNER_LIPS, LEFT_EYE, RIGHT_EYE, LEFT_BROW, RIGHT_BROW, LEFT_UPPER_EYE, RIGHT_UPPER_EYE } from '../../packages/live-edit/regions.js';
export function makeupFixture() {
    const source = document.createElement('canvas'); source.width = source.height = 256;
    const ctx = source.getContext('2d'); ctx.fillStyle = 'rgb(128,96,64)'; ctx.fillRect(0, 0, 256, 256);
    // Asymmetric corners catch flips even when every face crop is uniform.
    ctx.fillStyle = 'rgb(20,40,80)'; ctx.fillRect(0, 0, 16, 16);
    ctx.fillStyle = 'rgb(180,160,140)'; ctx.fillRect(240, 240, 16, 16);
    const points = new Float32Array(1434);
    const put = (i,x,y) => { points[i*3]=x; points[i*3+1]=y; };
    OVAL.forEach((index,i) => { const a = i / OVAL.length * 2 * Math.PI - Math.PI / 2; put(index,.5+Math.cos(a)*.42,.5+Math.sin(a)*.47); });
    for (const [eye,brow,upper,cx,sign] of [[RIGHT_EYE,RIGHT_BROW,RIGHT_UPPER_EYE,.33,1],[LEFT_EYE,LEFT_BROW,LEFT_UPPER_EYE,.67,-1]]) {
        eye.slice(0,9).forEach((index,i) => put(index,cx+sign*(-.08+.16*i/8),.38+.035*Math.sin(Math.PI*i/8)));
        upper.forEach((index,i) => put(index,cx+sign*(-.08+.16*i/8),.38-.035*Math.sin(Math.PI*i/8)));
        // Brow polygon follows its SDK chain order, reversed for the left side.
        const vertices = [[-.09,.245],[-.045,.225],[0,.22],[.045,.225],[.09,.245],[.09,.27],[.045,.25],[0,.245],[-.045,.25],[-.09,.27]];
        brow.forEach((index,i) => put(index,cx+vertices[i][0],vertices[i][1]));
    }
    for (const [indices,rx,ry] of [[LIPS,.13,.07],[INNER_LIPS,.09,.025]]) indices.forEach((index,i) => {
        const a = i / indices.length * 2 * Math.PI; put(index,.5-Math.cos(a)*rx,.72+Math.sin(a)*ry);
    });
    return { source, points };
}
