import test from 'node:test';
import assert from 'node:assert/strict';
import { filmStarterForTemplate, takeFilmStarter, writeFilmStarter } from '../app/veyrnox/_lib/filmTemplateDraft.js';
import { filmFromTemplate } from '../app/veyrnox/_lib/filmStudio.js';

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

test('starting a film keeps the selected template linked to the project',()=>{
  const starter=filmStarterForTemplate(preset,'An edited prompt',120);
  const film=filmFromTemplate(starter,'kling-3.0-i2v');
  assert.equal(film.templateId,'paper-fragments');
  assert.equal(film.name,'PAPER FRAGMENTS');
  assert.equal(film.script,'An edited prompt');
  assert.equal(film.targetSeconds,120);
  assert.equal(film.stack.video,'kling-3.0-i2v');
  assert.equal(film.stack.aspect,'9:16');
});
