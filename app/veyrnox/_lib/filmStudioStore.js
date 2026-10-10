import { emptyFilm } from './filmStudio.js';
let state={film:emptyFilm(),stage:0,ready:false,userId:null,error:null,saved:false};
const listeners=new Set();
export const filmStudioStore={
  getState:()=>state,
  subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener);},
  set:patch=>{state={...state,...patch};for(const listener of listeners) listener();},
};
