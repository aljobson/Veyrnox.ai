// Shared output topology for live playback and offline export.
export function beatOutput(context, destination = context.destination) {
  const master = context.createGain();
  master.gain.value = 0.8;
  const compressor = context.createDynamicsCompressor();
  master.connect(compressor).connect(destination);
  master.outputNode = compressor;
  return master;
}
export function connectTrackChannel(context, destination, gain = 1, pan = 0) {
  const input = context.createGain();
  input.channelCount = 2;
  input.channelCountMode = 'explicit';
  input.channelInterpretation = 'speakers';
  input.gain.value = gain;
  const panner = context.createStereoPanner();
  panner.pan.value = pan;
  input.connect(panner).connect(destination);
  return { input, panner };
}
