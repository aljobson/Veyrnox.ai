const PREFIX='veyrnox-editor-media-v1',ID=/^[A-Za-z0-9_-]{1,80}$/;
const cleanIds=value=>Array.isArray(value)?[...new Set(value.filter(id=>typeof id==='string'&&ID.test(id)))].slice(0,100):[];
const key=actor=>`${PREFIX}:${ID.test(actor || '')?actor:'guest'}`;
export const emptyMediaPreferences=()=>({favorites:[],recent:[]});
export function readMediaPreferences(storage,actor){
    if(!storage)return emptyMediaPreferences();
    try{const value=JSON.parse(storage.getItem(key(actor)) || '{}');return {favorites:cleanIds(value.favorites),recent:cleanIds(value.recent).slice(0,20)};}
    catch{return emptyMediaPreferences();}
}
export function writeMediaPreferences(storage,actor,value){
    const clean={favorites:cleanIds(value.favorites),recent:cleanIds(value.recent).slice(0,20)};storage?.setItem(key(actor),JSON.stringify(clean));return clean;
}
export function toggleMediaFavorite(value,id){
    const favorites=value.favorites.includes(id)?value.favorites.filter(item=>item!==id):[id,...value.favorites];return {...value,favorites};
}
export function noteRecentMedia(value,id){return {...value,recent:[id,...value.recent.filter(item=>item!==id)].slice(0,20)};}
