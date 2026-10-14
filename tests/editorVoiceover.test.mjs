import test from 'node:test';
import assert from 'node:assert/strict';
import { voiceoverExtension,voiceoverMime,voiceoverProblem } from '../app/veyrnox/_lib/editorVoiceover.mjs';

test('voiceover recording chooses the first browser-supported safe audio format',()=>{
    assert.equal(voiceoverMime(type=>type==='audio/mp4'),'audio/mp4');
    assert.equal(voiceoverMime(()=>false),'');
    assert.equal(voiceoverExtension('audio/mp4'),'m4a');assert.equal(voiceoverExtension('audio/ogg;codecs=opus'),'ogg');assert.equal(voiceoverExtension('audio/webm'),'webm');
});

test('microphone failures explain the action the editor needs',()=>{
    assert.match(voiceoverProblem({name:'NotAllowedError'}),/Allow it/);
    assert.match(voiceoverProblem({name:'NotFoundError'}),/No microphone/);
    assert.match(voiceoverProblem({name:'NotReadableError'}),/another app/);
});
