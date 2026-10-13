import { colourDefaults } from './editorColour.mjs';
export const TRANSFORM_DEFAULTS=Object.freeze({x:.5,y:.5,scale:1,rotation:0,opacity:1,flipX:false,flipY:false});
export const FILTER_DEFAULTS=Object.freeze({brightness:1,contrast:1,saturate:1,hue:0,blur:0});
export const EASINGS=Object.freeze(['linear','ease-in','ease-out','ease-in-out']);
export const ANIMATIONS=Object.freeze(['none','fade','slide-left','slide-right','slide-up','slide-down','zoom','spin','bounce','wipe-left','wipe-right','wipe-up','wipe-down']);
export const COMBOS=Object.freeze(['none','float','pulse','spin','drift','sway','wobble','bounce']);
export const PARAMETER_BOUNDS=Object.freeze({brightness:[0,3],contrast:[0,3],saturate:[0,3],hue:[-180,180],blur:[0,30],exposure:[-3,3],temperature:[-1,1],tint:[-1,1]});
const ease=(v,mode)=>mode==='ease-in'?v*v:mode==='ease-out'?1-(1-v)**2:mode==='ease-in-out'?v*v*(3-2*v):v;
function interpolate(keys,offset,names,value) {
    if(!keys?.length)return value;
    const left=[...keys].reverse().find(k=>k.frame<=offset)||keys[0],right=keys.find(k=>k.frame>=offset)||keys.at(-1);
    const p=right.frame===left.frame?0:ease(Math.max(0,Math.min(1,(offset-left.frame)/(right.frame-left.frame))),right.easing);
    for(const key of names)value[key]=left[key]+(right[key]-left[key])*p;
    return value;
}
export function evaluatedTransform(clip,offset,animate=true) {
    const t=interpolate(clip.keyframes,offset,['x','y','scale','rotation','opacity'],{...TRANSFORM_DEFAULTS,...clip.transform});
    const a=clip.animation;
    if(a && animate) {
        const at=offset+(a.offset||0),span=a.span||clip.len;
        for(const [name,progress,exiting] of [[a.in,Math.min(1,at/a.duration),false],[a.out,Math.min(1,(span-1-at)/a.duration),true]]) {
            const p=Math.max(0,progress);
            if(name==='fade')t.opacity*=p;
            if(name==='slide-left')t.x+=(exiting?1:-1)*(1-p);
            if(name==='slide-right')t.x+=(exiting?-1:1)*(1-p);
            if(name==='slide-up')t.y-=1-p;
            if(name==='slide-down')t.y+=1-p;
            if(name==='zoom'){t.scale*=.5+p*.5;t.opacity*=p;}
            if(name==='spin'){t.rotation+=(exiting?1:-1)*(1-p)*180;t.opacity*=p;}
            // An analytic damped bounce has no accumulated simulation state or random seed.
            if(name==='bounce'){t.y+=(exiting?-1:1)*(1-p)*Math.cos(p*Math.PI*3)*.35;t.opacity*=p;}
        }
        const phase=at/(a.period||60)*Math.PI*2,amount=a.amount??.5;
        if(a.combo==='float')t.y+=Math.sin(phase)*.08*amount;
        if(a.combo==='pulse')t.scale*=1+Math.sin(phase)*.15*amount;
        if(a.combo==='spin')t.rotation+=at/(a.period||60)*360*amount;
        if(a.combo==='drift'){t.x+=Math.sin(phase)*.08*amount;t.y+=(Math.cos(phase)-1)*.04*amount;}
        if(a.combo==='sway')t.x+=Math.sin(phase)*.08*amount;
        if(a.combo==='wobble'){t.rotation+=Math.sin(phase)*12*amount;t.x+=Math.sin(phase*2)*.015*amount;}
        if(a.combo==='bounce'){t.y-=(1-Math.cos(phase))*.06*amount;t.scale*=1+(1-Math.cos(phase))*.025*amount;}
    }
    return t;
}
/** Normalized local clipping for original wipe recipes. Both ends intersect; no accumulated frame state. */
export function evaluatedReveal(clip,offset,animate=true) {
    let left=0,top=0,right=1,bottom=1;
    const a=clip.animation;
    if(a && animate) {
        const at=offset+(a.offset||0),span=a.span||clip.len;
        for(const [name,progress] of [[a.in,at/a.duration],[a.out,(span-1-at)/a.duration]]) {
            if(!name?.startsWith('wipe-'))continue;
            const p=Math.max(0,Math.min(1,progress)),reveal=p*p*(3-2*p);
            if(name==='wipe-left')right=Math.min(right,reveal);
            if(name==='wipe-right')left=Math.max(left,1-reveal);
            if(name==='wipe-up')bottom=Math.min(bottom,reveal);
            if(name==='wipe-down')top=Math.max(top,1-reveal);
        }
    }
    return {x:left,y:top,width:Math.max(0,right-left),height:Math.max(0,bottom-top)};
}
export function evaluatedParameters(clip,offset) {
    const filter={...FILTER_DEFAULTS,...clip.filter},colour=clip.colourAdjustment || colourDefaults();
    if(!clip.parameterKeyframes?.length)return {filter,colour};
    const values=interpolate(clip.parameterKeyframes,offset,Object.keys(PARAMETER_BOUNDS),{...filter,exposure:colour.exposure,temperature:colour.temperature,tint:colour.tint});
    return {filter:Object.fromEntries(Object.keys(FILTER_DEFAULTS).map(k=>[k,values[k]])),colour:{...colour,...Object.fromEntries(['exposure','temperature','tint'].map(k=>[k,values[k]]))}};
}
export function parameterKeyframe(clip,frame) {
    const {filter,colour}=evaluatedParameters(clip,frame);
    return {frame,...filter,exposure:colour.exposure,temperature:colour.temperature,tint:colour.tint,easing:'linear'};
}
export function parameterProblem(keys) {
    if(keys===undefined)return null;
    if(!Array.isArray(keys)||keys.length>40||keys.some((k,i)=>!k||typeof k!=='object'||Object.keys(k).length!==10||Object.keys(k).some(name=>!['frame','easing',...Object.keys(PARAMETER_BOUNDS)].includes(name))||!Number.isInteger(k.frame)||Math.abs(k.frame)>18000||(i>0&&k.frame<=keys[i-1].frame)||!EASINGS.includes(k.easing)||Object.entries(PARAMETER_BOUNDS).some(([name,[min,max]])=>!Number.isFinite(k[name])||k[name]<min||k[name]>max)))return 'Invalid animated picture parameters.';
    return null;
}
/** Keep outer anchors: deleting them changes nonlinear interpolation inside the surviving range. */
export function slicedAnimation(clip,from) {
    return {...(clip.keyframes?{keyframes:clip.keyframes.map(k=>({...k,frame:k.frame-from}))}:{}),...(clip.parameterKeyframes?{parameterKeyframes:clip.parameterKeyframes.map(k=>({...k,frame:k.frame-from}))}:{}),...(clip.animation?{animation:{...clip.animation,offset:(clip.animation.offset||0)+from,span:clip.animation.span||clip.len}}:{})};
}
export function motionPreset(clip,name) {
    const base=evaluatedTransform(clip,0,false),end={...base},half={...base};
    if(name==='pan-right'){base.x-=.15;end.x+=.15;}
    else if(name==='rise'){base.y+=.15;end.y-=.15;}
    else if(name==='arc'){base.x-=.15;end.x+=.15;half.y-=.2;}
    else if(name==='push-in'){base.scale*=.8;end.scale*=1.2;}
    else return [];
    const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
    const key=(t,frame)=>({frame,x:clamp(t.x,-2,3),y:clamp(t.y,-2,3),scale:clamp(t.scale,.05,8),rotation:clamp(t.rotation,-360,360),opacity:clamp(t.opacity,0,1),easing:'ease-in-out'});
    return [key(base,0),...(name==='arc'&&clip.len>2?[key(half,Math.floor((clip.len-1)/2))]:[]),key(end,clip.len-1)].filter((p,i,a)=>!i||p.frame>a[i-1].frame);
}
