export const TEXT_FONTS=Object.freeze(['sans-serif','serif','monospace','Arial','Helvetica','Verdana','Georgia','Times New Roman','Courier New','Impact']);
export const TEXT_EXTRAS=Object.freeze({italic:false,underline:false,letterSpacing:0,lineHeight:1.2,shadowColor:'#000000',shadowOpacity:0,shadowBlur:4,shadowX:2,shadowY:2});
export function textExtrasProblem(style) {
    if(!TEXT_FONTS.includes(style.font)&&!isCustomFontFamily(style.font))return 'Choose an available font.';
    for(const key of ['italic','underline'])if(style[key]!==undefined && typeof style[key]!=='boolean')return 'Invalid text emphasis.';
    if(style.shadowColor!==undefined && !/^#[0-9a-fA-F]{6}$/.test(style.shadowColor))return 'Invalid shadow colour.';
    for(const [key,min,max] of [['letterSpacing',-10,30],['lineHeight',.8,3],['shadowOpacity',0,1],['shadowBlur',0,30],['shadowX',-50,50],['shadowY',-50,50]])if(style[key]!==undefined && (!Number.isFinite(style[key]) || style[key]<min || style[key]>max))return 'Invalid text spacing or shadow.';
    return null;
}
import {isCustomFontFamily} from './editorOrganization.mjs';
