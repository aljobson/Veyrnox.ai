import { getStoredUserId, onSessionChange } from '../../lib/authClient.js';
import { boundaryPatch } from './filmStudioCloud.js';
import { emptyFilm } from './filmStudio.js';
let state={film:emptyFilm(),stage:0,ready:false,userId:null,error:null,saved:false,cloud:null,generation:0,pending:null};
const listeners=new Set();
export const filmStudioStore={
  getState:()=>state,
  subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener);},
  set:patch=>{state={...state,...patch};for(const listener of listeners) listener();},
};

// Observe account boundaries even while the workspace is unmounted.
if (typeof window !== 'undefined') onSessionChange(() => {
  const patch = boundaryPatch(state, getStoredUserId());
  if (patch) filmStudioStore.set(patch);
});
