// Signed-in app copy (ADR-0107 phase B).
const messages = {
  "app.editor.audio.processing": "Voice and noise processing",
  "app.editor.audio.preserve": "Preserve pitch when changing speed",
  "app.editor.audio.voicePreset": "Voice preset",
  "app.editor.audio.pitch": "Voice pitch (semitones)",
  "app.editor.audio.noise": "Noise reduction (%)",
  "app.editor.audio.noiseStart": "Noise sample source start (seconds)",
  "app.editor.audio.noiseLength": "Noise sample length (seconds)",
  "app.editor.audio.noiseHelp": "For noise reduction, choose a source section containing background noise alone. Speech or music in the sample can be removed from the result. Preview before applying it.",
  "app.editor.audio.gate": "Noise gate threshold (dB)",
  "app.editor.audio.gateHelp": "At −96 dB the gate is off. Raising it suppresses sound below the threshold. Deep/bright voices adjust pitch; radio and robot add original effects.",
  "app.editor.audio.apply": "Apply voice and gate to all sound clips",
  "app.editor.audio.reset": "Reset voice processing"
};
export default messages;
