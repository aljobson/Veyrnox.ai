import test from 'node:test';
import assert from 'node:assert/strict';
import { SMART_PICTURE,smartPictureProblem,smartPicturePixels,denoisePixels } from '../app/veyrnox/_lib/editorSmartPicture.mjs';
import { emptySequence,addSequenceMedia,addSequenceClip,updateSequenceClip,splitSequenceClip } from '../app/veyrnox/_lib/editorSequence.mjs';
import { validateSequence } from '../app/veyrnox/_lib/editorSequenceValidation.mjs';
import { motionPreset } from '../app/veyrnox/_lib/editorAnimation.mjs';
test('colour key removes a green background, preserves foreground and multiplies source alpha',()=>{
    const data=new Uint8ClampedArray([0,255,0,255,255,0,0,128,0,255,0,96]);smartPicturePixels(data,3,1,{...SMART_PICTURE,keyEnabled:true});
    assert.equal(data[3],0);assert.deepEqual([...data.slice(4,8)],[255,0,0,128]);assert.equal(data[11],0);
    const edge=new Uint8ClampedArray([60,190,60,200]);smartPicturePixels(edge,1,1,{...SMART_PICTURE,keyEnabled:true,keyTolerance:.15,keyFeather:.5,despill:1});assert.ok(edge[3]>0&&edge[3]<200);assert.ok(edge[1]<190);
});
test('bilateral noise reduction lowers variation while preserving a strong edge and alpha',()=>{
    const width=64,height=32,data=new Uint8ClampedArray(width*height*4),clean=new Uint8ClampedArray(data.length);let seed=42;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){seed=(1664525*seed+1013904223)>>>0;const i=(y*width+x)*4,base=x<32?40:210,noise=(seed/2**32-.5)*30;for(let c=0;c<3;c++){data[i+c]=base+noise;clean[i+c]=base;}data[i+3]=clean[i+3]=(x+y)%2?128:255;}
    const before=data.slice();denoisePixels(data,width,height,1);
    const mse=v=>{let sum=0;for(let i=0;i<v.length;i+=4)sum+=(v[i]-clean[i])**2;return sum/(width*height);};assert.ok(mse(data)<mse(before)*.55,`${mse(data)} vs ${mse(before)}`);
    for(let i=3;i<data.length;i+=4)assert.equal(data[i],before[i]);
    for(let y=0;y<height;y++){assert.ok(data[(y*width+31)*4]<70);assert.ok(data[(y*width+32)*4]>180);}
});
test('soft relighting changes the chosen region, retains alpha and stays bounded',()=>{
    const data=new Uint8ClampedArray(25*4).fill(80);for(let i=3;i<data.length;i+=4)data[i]=123;smartPicturePixels(data,5,5,{...SMART_PICTURE,light:1,lightX:.4,lightY:.4,lightRadius:.05});assert.equal(data[(2*5+2)*4],160);assert.equal(data[0],80);for(let i=3;i<data.length;i+=4)assert.equal(data[i],123);
});
test('picture processing round trips, survives cuts, rejects malformed settings and locked edits',()=>{
    let t=addSequenceMedia(emptySequence(),{id:'green',kind:'image',name:'Green',frames:300,width:640,height:360});t=addSequenceClip(t,'video','green',{len:120});t=updateSequenceClip(t,'video',t.video[0].id,{smartPicture:{...SMART_PICTURE,keyEnabled:true,denoise:.5}});assert.equal(validateSequence(JSON.parse(JSON.stringify(t))),null);
    const split=splitSequenceClip(t,'video',t.video[0].id,60);assert.deepEqual(split.video[0].smartPicture,split.video[1].smartPicture);assert.match(smartPictureProblem({...SMART_PICTURE,light:Infinity}),/Invalid/);assert.match(smartPictureProblem({...SMART_PICTURE,extra:1}),/Invalid/);
    const locked={...t,tracks:t.tracks.map(v=>({...v,locked:v.kind==='video'}))};assert.match(updateSequenceClip(locked,'video',t.video[0].id,{smartPicture:SMART_PICTURE}).error,/Unlock/);
    for(const scale of [.05,8])for(const key of motionPreset({...t.video[0],transform:{scale,x:3,y:-2}},'push-in'))assert.ok(key.scale>=.05&&key.scale<=8);
});
