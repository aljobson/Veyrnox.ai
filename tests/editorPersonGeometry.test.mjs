import test from 'node:test';
import assert from 'node:assert/strict';
import { regionBounds, smoothRegion, reshapeProblem, reshapePersonPixels } from '../app/veyrnox/_lib/editorPersonGeometry.mjs';
import { personFraming } from '../app/veyrnox/_lib/editorVisionPixelProcessing.mjs';
const bounds={x:.3,y:.2,width:.4,height:.6}, settings={region:'face',widthAmount:-.25,heightAmount:0};
function frame(){const width=100,height=100,data=new Uint8ClampedArray(width*height*4);for(let y=0;y<height;y++)for(let x=0;x<width;x++)data.set([x*2,y*2,x>=40&&x<60?255:0,255],(y*width+x)*4);return{width,height,data};}
test('narrowing a detected region reduces the measured foreground width and keeps the boundary untouched',()=>{
 const source=frame(),out=reshapePersonPixels(source,bounds,settings),span=f=>{let n=0;for(let x=0;x<100;x++)if(f.data[(50*100+x)*4+2]>128)n++;return n;};
 assert.ok(span(out)<span(source));assert.deepEqual(out.data.slice(0,400),source.data.slice(0,400));assert.equal(source.data[(50*100+40)*4+2],255);
 const widened=reshapePersonPixels(source,bounds,{...settings,widthAmount:.25});assert.ok(span(widened)>span(source));
});
test('absent regions are unchanged, alpha stays valid, and unsafe or no-op requests fail',()=>{
 const source=frame();source.data[(50*100+50)*4+3]=0;const out=reshapePersonPixels(source,bounds,{...settings,heightAmount:.2});assert.ok(out.data.every(Number.isFinite));assert.deepEqual(reshapePersonPixels(source,null,settings).data,source.data);
 for(const s of [{...settings,widthAmount:NaN},{...settings,heightAmount:.8},{...settings,region:'eyes'},{...settings,widthAmount:0}])assert.ok(reshapeProblem(s));
 assert.throws(()=>reshapePersonPixels(source,{...bounds,width:3},settings),/bounds/);
});
test('face bounds stay within the largest detected person, reject isolated confidence, and tracking resets on cuts',()=>{
 const width=40,height=40,background=new Float32Array(1600).fill(1),face=new Float32Array(1600),body=new Float32Array(1600);
 for(let y=5;y<35;y++)for(let x=10;x<30;x++){background[y*40+x]=0;if(y<15)face[y*40+x]=1;}
 const masks={width,height,background,face,body},person=personFraming(masks),b=regionBounds(masks,person,'face');assert.deepEqual(b,{x:.25,y:.125,width:.5,height:.25});assert.deepEqual(regionBounds(masks,person,'body'),person.bounds);
 face.fill(0);face[6*40+12]=1;assert.equal(regionBounds(masks,person,'face'),null);
 assert.equal(smoothRegion(b,null),null);assert.deepEqual(smoothRegion(b,{...b,x:.7,y:.7}),{...b,x:.7,y:.7});const smoothed=smoothRegion(b,{...b,x:.3});assert.ok(smoothed.x>b.x&&smoothed.x<.3);
});
