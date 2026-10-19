// Signed-in app copy (ADR-0107 phase B).
const messages = {
  "app.editor.lyrics.title": "入力した歌詞を同期",
  "app.editor.lyrics.help": "使用許可のある歌詞を表示行ごとに改行して貼り付けます。読み込んだ字幕やローカル自動字幕の単語タイムスタンプに合わせます。特に歌唱は同期前に認識結果を確認してください。選択した時間付き字幕を置き換え、カラオケ表示を追加します。元に戻すと復元できます。有料リクエストは行いません。",
  "app.editor.lyrics.source": "時間付き歌詞のソース",
  "app.editor.lyrics.all": "元の単語タイミングがあるすべての字幕",
  "app.editor.lyrics.changed": "ソースが変わりました — 選び直してください",
  "app.editor.lyrics.supplied": "入力した歌詞",
  "app.editor.lyrics.status": "歌詞同期ソースの状態",
  "app.editor.lyrics.available.one": "時間付き字幕のソースが {count} 件あります。欠落や曖昧な一致は修正が必要です。",
  "app.editor.lyrics.available.other": "時間付き字幕のソースが {count} 件あります。欠落や曖昧な一致は修正が必要です。",
  "app.editor.lyrics.empty": "まず単語タイミング JSON、タイムスタンプ付き VTT、拡張 LRC を読み込むか、ローカル自動字幕を作成してください。均等に割り当てられた単語タイミングは推定値です。",
  "app.editor.lyrics.align": "歌詞を同期して時間付き字幕を置き換える",
  "app.editor.lyrics.available.zero": "時間付き字幕のソースが {count} 件あります。欠落や曖昧な一致は修正が必要です。",
  "app.editor.lyrics.available.two": "時間付き字幕のソースが {count} 件あります。欠落や曖昧な一致は修正が必要です。",
  "app.editor.lyrics.available.few": "時間付き字幕のソースが {count} 件あります。欠落や曖昧な一致は修正が必要です。",
  "app.editor.lyrics.available.many": "時間付き字幕のソースが {count} 件あります。欠落や曖昧な一致は修正が必要です。"
};
export default messages;
