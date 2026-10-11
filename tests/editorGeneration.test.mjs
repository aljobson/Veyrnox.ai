import test from 'node:test';
import assert from 'node:assert/strict';
import { generationQuote, generationInputs, generationModelSupported, generationSources, generationAvatarSupported, generationModelsForMode, generationSourceLabel, generationPromptHelp, generationMovementSupported, generationMovementPrompt } from '../app/veyrnox/_lib/editorGeneration.mjs';
const model = { id: 'existing-model', kind: 'video', credits: 12, takesPrompt: true, promptMax: 2000, durations: [5, 10], aspects: ['16:9', '9:16'] };
test('editor quotes only live catalog credit units and supported generation inputs', () => {
    assert.equal(generationQuote(model, 10), 24); assert.equal(generationQuote({ ...model, kind: 'image' }, 10), 12);
    assert.deepEqual(generationInputs(model, { prompt: ' A shot ', duration: 10, aspect: '9:16', voice: '' }), { inputs: { prompt: 'A shot', duration_seconds: 10, aspect_ratio: '9:16' } });
    assert.equal(generationQuote({ ...model, credits: undefined }, 5), null);
});
test('unsupported durations, shapes, voice descriptions and non-generation models fail before submission', () => {
    const values = { prompt: 'A shot', duration: 5, aspect: '16:9', voice: '' };
    for (const result of [generationInputs(model, { ...values, duration: 60 }), generationInputs(model, { ...values, aspect: '4:3' }), generationInputs({ ...model, takesVoice: true }, values), generationInputs({ ...model, isEdit: true }, values), generationInputs(model, { ...values, prompt: 'x'.repeat(2001) })]) assert.ok(result.error);
});

const start = '33333333-3333-4333-8333-333333333333', end = '44444444-4444-4444-8444-444444444444';
const frames = { ...model, media: { image: { required: true,kind: 'image',label: 'Start frame' },endImage: { required: false,kind: 'image',label: 'End frame' } } };
const selection = (assetId,mimeType = 'image/png') => ({ assetId,mimeType,previewUrl: 'https://preview.example/file.png',label: 'Original frame' });
test('editor exposes supported frame slots and sends only asset IDs and their explicit roles',() => {
    assert.equal(generationModelSupported(frames),true);
    assert.deepEqual(generationSources(frames,{ image: selection(start),endImage: selection(end) },true),{ assets: [{ asset_id: start,slot: 'image' },{ asset_id: end,slot: 'endImage' }] });
    assert.deepEqual(generationSources(frames,{ image: selection(start) },true),{ assets: [{ asset_id: start,slot: 'image' }] });
    assert.deepEqual(generationSources(frames,{ image: selection(start),endImage: selection(start) },true),{ assets: [{ asset_id: start,slot: 'image' },{ asset_id: start,slot: 'endImage' }] });
    assert.notDeepEqual(generationSources(frames,{ image: selection(start),endImage: selection(end) },true),generationSources(frames,{ image: selection(end),endImage: selection(start) },true),'swapped frame roles have distinct idempotency signatures');
    assert.deepEqual(generationSources({ ...model,media: {} },{ image: selection(start) },false),{ assets: [] },'hidden prior model slots cannot leak into a new model');
});
test('editor validates required frame, actual MIME and strict consent before a request is prepared',() => {
    assert.equal(generationSources(frames,{ endImage: selection(end) },true).error,'Choose the start frame.');
    for (const consent of [false,'true',1]) assert.ok(generationSources(frames,{ image: selection(start) },consent).error);
    for (const source of [selection(start,'video/mp4'),selection(start,'image/gif'),selection('https://foreign.example/id'),{ assetId: start }]) assert.ok(generationSources(frames,{ image: source },true).error);
    for (const unsupported of [{ ...frames,gated: true },{ ...frames,media: { reference: {} } },{ ...frames,media: { image: {},endImage: {},video: {} } }]) assert.equal(generationModelSupported(unsupported),false);
});

const avatar = { ...model,id: 'kling-avatar-v2',durations: [5],aspects: null,media: { image: { required: true },audio: { required: true,maxSeconds: 10 } } };
const lipSync = { ...model,id: 'latentsync',takesPrompt: false,durations: [5],aspects: null,media: { video: { required: true,maxSeconds: 40 },audio: { required: true,maxSeconds: 40 } } };
test('avatar selector accepts existing photo/audio and video/audio contracts while excluding unrelated generation models',() => {
    const speech = { ...model,id: 'elevenlabs-tts-turbo',kind: 'audio',isSpeech: true,media: {},promptMax: 1000 };
    assert.deepEqual(generationModelsForMode([model,frames,avatar,lipSync,speech],'avatar').map(m => m.id),['kling-avatar-v2','latentsync']);
    assert.deepEqual(generationModelsForMode([model,frames,avatar,lipSync,speech],'voiceover').map(m => m.id),['elevenlabs-tts-turbo']);
    for (const unsupported of [{ ...avatar,gated: true },{ ...avatar,isEdit: true },{ ...avatar,media: { image: { required: true } } },{ ...avatar,media: { image: { required: true },audio: { required: false,maxSeconds: 10 } } },{ ...lipSync,media: { video: { required: true },audio: { required: true,maxSeconds: 40 } } }]) assert.equal(generationAvatarSupported(unsupported),false);
});
test('source-driven avatar and lip sync buy one catalog unit without invented output-duration inputs',() => {
    const values = { prompt: 'Subtle head motion',duration: 10,aspect: '16:9',voice: '' };
    assert.deepEqual(generationInputs(avatar,values),{ inputs: { prompt: 'Subtle head motion' } });
    assert.deepEqual(generationInputs(lipSync,{ ...values,prompt: 'Hidden text cannot leak' }),{ inputs: {} });
    assert.equal(generationQuote(avatar,10),12); assert.equal(generationQuote(lipSync,40),12);
    assert.deepEqual(generationSources(avatar,{ image: selection(start),audio: selection(end,'audio/wav') },true),{ assets: [{ asset_id: start,slot: 'image' },{ asset_id: end,slot: 'audio' }] });
    assert.deepEqual(generationSources(lipSync,{ video: selection(start,'video/mp4'),audio: selection(end,'audio/mpeg') },true),{ assets: [{ asset_id: start,slot: 'video' },{ asset_id: end,slot: 'audio' }] });
    assert.equal(generationSources(avatar,{ image: selection(start) },true).error,'Choose the speech audio.');
    assert.equal(generationSourceLabel(avatar,'image'),'Avatar photo'); assert.equal(generationSourceLabel(lipSync,'video'),'Source video');
    assert.ok(generationSources(avatar,{ image: selection(start),audio: selection(end,'audio/wav') },false).error);
});
test('speech guidance preserves the real text bound and dialogue speaker contract',() => {
    const speech = { ...model,kind: 'audio',isSpeech: true,promptMax: 1000,media: {} };
    assert.match(generationPromptHelp({ ...speech,id: 'elevenlabs-dialogue' }),/Name: line.*four speakers.*1000 characters/);
    assert.match(generationPromptHelp({ ...speech,id: 'elevenlabs-dialogue-kie' }),/four speakers/);
    assert.match(generationPromptHelp({ ...speech,id: 'elevenlabs-tts-turbo' }),/1000 spoken characters/);
    assert.ok(generationInputs(speech,{ prompt: 'x'.repeat(1001),voice: '' }).error);
    assert.equal(generationPromptHelp(model),null);
});

// Use real public registry metadata so editor bounds/filtering cannot drift from accepted gateway contracts.
const { capabilityFor,publicCapabilities } = await import('../lib/modelCapabilities.js');
function fromRecord(id,endpoint) {
    const capabilities = publicCapabilities(capabilityFor(endpoint));
    return { id,kind: capabilities.kind === 'speech' ? 'audio' : capabilities.kind,isSpeech: capabilities.kind === 'speech',takesPrompt: !!capabilities.inputs.prompt,takesVoice: !!capabilities.inputs.voice_description,promptMax: capabilities.inputs.prompt?.max || 2000,media: capabilities.media,durations: capabilities.lengths,credits: 12 };
}
test('existing Fal and KIE speech contracts are accepted only from the provided catalog while real avatar records expose source-only lip sync',() => {
    const voiceModels = [['elevenlabs-tts-turbo','fal-ai/elevenlabs/tts/turbo-v2.5'],['elevenlabs-dialogue','fal-ai/elevenlabs/text-to-dialogue/eleven-v3'],['inworld-tts','fal-ai/inworld-tts'],['minimax-speech-2.6-hd','fal-ai/minimax/speech-2.6-hd'],['qwen-3-tts-voice-design','fal-ai/qwen-3-tts/voice-design/1.7b'],['elevenlabs-tts-turbo-kie','market:elevenlabs/text-to-speech-turbo-2-5'],['elevenlabs-dialogue-kie','market:elevenlabs/text-to-dialogue-v3']].map(([id,endpoint]) => fromRecord(id,endpoint));
    const realAvatars = [['kling-avatar-v2','fal-ai/kling-video/ai-avatar/v2/standard'],['latentsync','fal-ai/latentsync']].map(([id,endpoint]) => fromRecord(id,endpoint));
    assert.deepEqual(generationModelsForMode([...voiceModels,...realAvatars],'avatar').map(m => m.id),['kling-avatar-v2','latentsync']);
    assert.deepEqual(generationModelsForMode(voiceModels.slice(0,4),'voiceover').map(m => m.id),voiceModels.slice(0,4).map(m => m.id),'registered absent KIE/Qwen rows are never invented into a catalog result');
    for (const voice of voiceModels) assert.ok(generationInputs(voice,{ prompt: 'x'.repeat(voice.promptMax + 1),voice: 'Calm voice' }).error);
    assert.deepEqual(generationInputs(realAvatars[1],{ prompt: 'Hidden prompt',duration: 10 }),{ inputs: {} });
});


test('movement mode uses only existing image-driven FAL/KIE contracts and excludes speech, avatars, optional references and gated rows', () => {
    const fal = fromRecord('kling-3.0-i2v','fal-ai/kling-video/v3/pro/image-to-video');
    const kie = fromRecord('kling-3.0-i2v-kie','market:kling-3.0/video');
    assert.deepEqual(generationModelsForMode([model,fal,kie,avatar,lipSync,{...fal,gated:true},{...fal,media:{image:{required:false}}}],'movement').map(m=>m.id),[fal.id,kie.id]);
    assert.equal(generationMovementSupported({...fal,kind:'image'}),false);
    assert.equal(generationMovementSupported({...fal,media:{image:{required:true},video:{required:false}}}),false);
});
test('complete movement directions retain gateway limits and unchanged source, duration and price semantics', () => {
    const fal = fromRecord('kling-3.0-i2v','fal-ai/kling-video/v3/pro/image-to-video');
    const values = {prompt:' A fox turns toward the camera. ',movement:'orbit-left',pace:'gentle'};
    const result = generationMovementPrompt(fal,values);
    assert.match(result.prompt,/^A fox turns toward the camera\./);
    assert.match(result.prompt,/Orbit the camera to the left.*subtle, gradual/);
    const prepared = generationInputs(fal,{prompt:result.prompt,duration:10});
    assert.deepEqual(Object.keys(prepared.inputs).sort(),['duration_seconds','prompt']);
    assert.equal(prepared.inputs.duration_seconds,10);
    assert.deepEqual(generationSources(fal,{image:selection(start),endImage:selection(end)},true),{assets:[{asset_id:start,slot:'image'},{asset_id:end,slot:'endImage'}]});
    assert.ok(generationSources(fal,{},true).error);
    assert.ok(generationSources(fal,{image:selection(start)},false).error);
    assert.equal(generationQuote(fal,10),24);
    assert.notEqual(result.prompt,generationMovementPrompt(fal,{...values,pace:'fast'}).prompt,'changed directions change the existing idempotency signature');
    const overhead = generationMovementPrompt(fal,{...values,prompt:'x'}).prompt.length-1;
    assert.ok(generationMovementPrompt(fal,{...values,prompt:'x'.repeat(fal.promptMax-overhead)}).prompt);
    assert.ok(generationMovementPrompt(fal,{...values,prompt:'x'.repeat(fal.promptMax-overhead+1)}).error);
    for(const invalid of [{...values,movement:'provider-secret-option'},{...values,pace:'unbounded'},{...values,prompt:''}])assert.ok(generationMovementPrompt(fal,invalid).error);
    assert.ok(generationMovementPrompt({...fal,promptMax:undefined},values).error);
});
