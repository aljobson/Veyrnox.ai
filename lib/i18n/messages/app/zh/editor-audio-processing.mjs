// Signed-in app copy (ADR-0107 phase B).
const messages = {
  "app.editor.audio.processing": "人声与噪声处理",
  "app.editor.audio.preserve": "变速时保持音高",
  "app.editor.audio.voicePreset": "语音预设",
  "app.editor.audio.pitch": "音高（半音）",
  "app.editor.audio.noise": "降噪 (%)",
  "app.editor.audio.noiseStart": "噪声样本在源中的起点（秒）",
  "app.editor.audio.noiseLength": "噪声样本时长（秒）",
  "app.editor.audio.noiseHelp": "降噪时，请选择仅含背景噪声的源片段。样本中的语音或音乐可能会从结果中被移除。应用前请预览。",
  "app.editor.audio.gate": "噪声门阈值 (dB)",
  "app.editor.audio.gateHelp": "在 −96 dB 时，噪声门关闭。提高阈值会抑制低于阈值的声音。深沉/明亮语音会调整音高；收音机和机器人会添加原创效果。",
  "app.editor.audio.apply": "将语音和噪声门应用到所有声音片段",
  "app.editor.audio.reset": "重置语音处理"
};
export default messages;
