import { helperEnglish } from '../../../lib/helperMessages.mjs';
import {assertPicture} from './editorMotionAnalysis.mjs';
import {assertVisionMasks} from './editorVisionPixelProcessing.mjs';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const linear=v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4;
const srgb=v=>v<=.0031308?v*12.92:1.055*v**(1/2.4)-.055;
export function personLightProblem(s){
 if(!Number.isFinite(s.lightAngle)||s.lightAngle < -180||s.lightAngle>180)return helperEnglish('choose_a_light_direction_between_180_and_180');
 if(!Number.isFinite(s.lightExposure)||s.lightExposure<0||s.lightExposure>1.5)return helperEnglish('choose_light_intensity_between_0_and_15_stops');
 if(!Number.isFinite(s.lightAmbient)||s.lightAmbient<-.5||s.lightAmbient>.5)return helperEnglish('choose_ambient_light_between_05_and_05_stops');
 if(!Array.isArray(s.colour)||s.colour.length!==3||!s.colour.every(v=>Number.isInteger(v)&&v>=0&&v<=255))return helperEnglish('choose_a_valid_light_colour');
 if(!s.lightExposure&&!s.lightAmbient)return helperEnglish('increase_the_light_intensity_or_change_the_ambient');
 return null;
}
/** Directional 2D colour/exposure across a semantic person matte; never estimates surface depth. */
export function lightPersonPixels(frame,masks,bounds,s){
 assertPicture(frame,4);assertVisionMasks(masks);
 const problem=personLightProblem(s);if(problem)throw new Error(problem);
 const data=new Uint8ClampedArray(frame.data);if(!bounds)return {...frame,data};
 if(!['x','y','width','height'].every(k=>Number.isFinite(bounds[k]))||bounds.width<=0||bounds.height<=0||bounds.x<0||bounds.y<0||bounds.x+bounds.width>1.000001||bounds.y+bounds.height>1.000001)throw new Error('Choose valid person bounds.');
 const angle=s.lightAngle*Math.PI/180,ax=Math.cos(angle),ay=Math.sin(angle),cx=bounds.x+bounds.width/2,cy=bounds.y+bounds.height/2,colour=s.colour.map(v=>linear(v/255));
 for(let y=0;y<frame.height;y++)for(let x=0;x<frame.width;x++){
  const mx=(x+.5)/frame.width,my=(y+.5)/frame.height,fx=clamp(mx*masks.width-.5,0,masks.width-1),fy=clamp(my*masks.height-.5,0,masks.height-1),ix=Math.floor(fx),iy=Math.floor(fy),nx=Math.min(ix+1,masks.width-1),ny=Math.min(iy+1,masks.height-1),dx=fx-ix,dy=fy-iy,b=masks.background;
  const background=b[iy*masks.width+ix]*(1-dx)*(1-dy)+b[iy*masks.width+nx]*dx*(1-dy)+b[ny*masks.width+ix]*(1-dx)*dy+b[ny*masks.width+nx]*dx*dy;
  const mask=clamp(((1-background)-.2)/.6,0,1),alpha=mask*mask*(3-2*mask);if(!alpha||mx<bounds.x||mx>bounds.x+bounds.width||my<bounds.y||my>bounds.y+bounds.height)continue;
  const direction=clamp(((mx-cx)/Math.max(.01,bounds.width/2)*ax+(my-cy)/Math.max(.01,bounds.height/2)*ay)*.5+.5,0,1),key=2**(s.lightExposure*direction)-1,ambient=2**s.lightAmbient,p=(y*frame.width+x)*4;
  for(let c=0;c<3;c++){const original=linear(frame.data[p+c]/255),lit=original*ambient*(1+key*colour[c]);data[p+c]=clamp(srgb(original*(1-alpha)+lit*alpha)*255,0,255);}
 }
 return {width:frame.width,height:frame.height,data};
}
