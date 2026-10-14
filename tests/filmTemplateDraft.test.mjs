import test from 'node:test';
import assert from 'node:assert/strict';
import { filmStarterForTemplate, takeFilmStarter, writeFilmStarter } from '../app/veyrnox/_lib/filmTemplateDraft.js';

const preset={id:'paper-fragments',name:'PAPER FRAGMENTS',model:'Kling 3.0 · I2V',aspect:'9:16'};

test('template films carry the edited prompt and requested long runtime',()=>{
  const storage=new Map();const adapter={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};
  assert.equal(writeFilmStarter(adapter,preset,'An edited prompt',90),true);
  assert.deepEqual(takeFilmStarter(adapter),{templateId:'paper-fragments',title:'PAPER FRAGMENTS',prompt:'An edited prompt',model:'Kling 3.0 · I2V',aspect:'9:16',targetSeconds:90});
  assert.equal(takeFilmStarter(adapter),null,'a handoff is consumed once');
});

test('invalid film targets and unsupported aspects fall back safely',()=>{
  assert.deepEqual(filmStarterForTemplate({...preset,aspect:'4:5'},'Prompt',999),{templateId:'paper-fragments',title:'PAPER FRAGMENTS',prompt:'Prompt',model:'Kling 3.0 · I2V',aspect:'16:9',targetSeconds:60});
});
