// Signed-in app copy (ADR-0107 phase B).
const messages = {
  "app.editor.audio.processing": "Traitement de la voix et du bruit",
  "app.editor.audio.preserve": "Conserver la hauteur lors du changement de vitesse",
  "app.editor.audio.voicePreset": "Preset de voix",
  "app.editor.audio.pitch": "Hauteur de la voix (demi-tons)",
  "app.editor.audio.noise": "Réduction du bruit (%)",
  "app.editor.audio.noiseStart": "Début de l’échantillon de bruit dans la source (secondes)",
  "app.editor.audio.noiseLength": "Durée de l’échantillon de bruit (secondes)",
  "app.editor.audio.noiseHelp": "Pour réduire le bruit, choisissez une section ne contenant que du bruit de fond. La parole ou la musique de l’échantillon peut être supprimée du résultat. Prévisualisez avant d’appliquer.",
  "app.editor.audio.gate": "Seuil du noise gate (dB)",
  "app.editor.audio.gateHelp": "À −96 dB, le gate est désactivé. L’augmenter atténue les sons sous le seuil. Les voix graves/claires modifient la hauteur ; radio et robot ajoutent des effets originaux.",
  "app.editor.audio.apply": "Appliquer voix et gate à tous les clips audio",
  "app.editor.audio.reset": "Réinitialiser le traitement vocal"
};
export default messages;
