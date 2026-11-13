// Host-only private portrait qualification. Pixels and masks stay in this browser.
import { createVisionProcessor } from '../../app/veyrnox/_lib/editorVisionWorkerClient.mjs';
import { createFaceProcessor } from '../../app/veyrnox/_lib/liveEdit/faceClient.mjs';
import { hairCoverage, hairTexture, selectFaceHair } from '../../packages/live-edit/hair.js';
let face, hair, bitmap;
try {
    const metadata=await (await fetch('./private-hair.json')).json();
    bitmap=await createImageBitmap(await (await fetch('./private-hair.png')).blob());
    face=await createFaceProcessor(); const detected=await face.detect(bitmap); face.close(); face=null;
    hair=await createVisionProcessor({hair:true}); const mask=await hair.segment(bitmap,1);
    const misses=[], regions=[];
    if(detected.count!==1) misses.push({name:'portrait face count',expected:1,actual:detected.count});
    const selected=selectFaceHair(mask,detected.count===1?detected.landmarks:null);
    if(!hairTexture(selected)) misses.push({name:'associated portrait hair ready',expected:true,actual:false});
    for(const rect of metadata.backgroundRects) {
        const [x,y,w,h]=rect; let maximum=0, selectedMaximum=0, count=0;
        for(let iy=0;iy<mask.height;iy++) for(let ix=0;ix<mask.width;ix++) {
            const nx=(ix+.5)/mask.width, ny=(iy+.5)/mask.height;
            if(nx>=x && nx<x+w && ny>=y && ny<y+h) {
                count++; maximum=Math.max(maximum,hairCoverage(mask.hair[iy*mask.width+ix]));
                selectedMaximum=Math.max(selectedMaximum,hairCoverage(selected?.hair[iy*mask.width+ix]??0));
            }
        }
        regions.push({rect,count,maximum,selectedMaximum});
        if(!count || maximum>=.05) misses.push({name:'known background hair alpha',rect,expected:'samples >0 and max <0.05',actual:{count,maximum}});
        if(selectedMaximum>=.05) misses.push({name:'associated background hair alpha',rect,expected:'max <0.05',actual:selectedMaximum});
    }
    const peak=mask.hair.reduce((max,v)=>Math.max(max,v),0);
    if(peak<.8) misses.push({name:'portrait contains confident hair',expected:'>=0.8',actual:peak});
    window.photoHairModelProof={regions,peak,misses};
} catch(error) { window.photoHairModelProof={error:error.message}; }
finally { face?.close(); hair?.close(); bitmap?.close(); }
