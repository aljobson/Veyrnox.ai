// Signed-in app copy (ADR-0107 phase B).
const messages = {
  "app.editor.audio.processing": "音声とノイズの処理",
  "app.editor.audio.preserve": "速度変更時に音程を維持",
  "app.editor.audio.voicePreset": "音声プリセット",
  "app.editor.audio.pitch": "音声のピッチ（半音）",
  "app.editor.audio.noise": "ノイズ低減 (%)",
  "app.editor.audio.noiseStart": "ソース内のノイズサンプル開始位置（秒）",
  "app.editor.audio.noiseLength": "ノイズサンプルの長さ（秒）",
  "app.editor.audio.noiseHelp": "背景ノイズだけを含むソース区間を選んでください。サンプル内の会話や音楽も結果から除去される場合があります。適用前にプレビューしてください。",
  "app.editor.audio.gate": "ノイズゲートのしきい値 (dB)",
  "app.editor.audio.gateHelp": "−96 dB ではゲートはオフです。値を上げるとしきい値以下の音が抑えられます。深い声／明るい声は音程を調整し、ラジオとロボットは独自の効果を加えます。",
  "app.editor.audio.apply": "すべての音声クリップに音声処理とゲートを適用",
  "app.editor.audio.reset": "音声処理をリセット"
};
export default messages;
