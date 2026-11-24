// Music MCP shipped after the translated public catalogs were frozen. Keep
// one accurate English fallback in every locale until the next translation
// batch, rather than showing raw tool identifiers or stale capability copy.
export const MCP_MUSIC_COPY = Object.freeze({
  'mcp.lead.current': 'Give an MCP-compatible assistant access to Veyrnox.ai models, exact credit estimates, generation jobs, Music drafts and playlists, and finished Library assets. Credit-spending tools always require an exact confirmed price.',
  'mcp.s3.body.current': 'Ask about models, costs, recent work, Music drafts or playlists. Before an image, video, edit or Music request can spend credits, the assistant must show the exact price and receive your approval.',
  'mcp.what.title.current': 'Models, media, Music and playlists in one connector.',
  'mcp.what.p.current': 'Read models, balances, generations, the authoritative Custom Music draft and owned playlists. Upload your own source media, create images and videos, edit videos, or generate two Music candidates only after the exact price is confirmed. Vocal Music quotes also require your explicit confirmation that you own or have permission to use the draft lyrics.',
  'mcp.pub.lead.current': 'Connect an MCP-compatible assistant to Veyrnox.ai models, media generation, Music drafts and playlists, finished Library assets, and Publish scheduling and analytics.',
  'mcp.pub.s3.body.current': 'Ask about models, costs, recent work, Music drafts, playlists, scheduled posts or analytics. Credit-spending tools show the exact price and wait for your approval.',
  'mcp.pub.what.title.current': 'Media, Music, playlists and publishing in one connector.',
  'mcp.pub.what.p.current': 'Read your Veyrnox.ai work, generate images, videos or two Music candidates after exact-price approval, manage owned Music playlists, and use Publish Plan tools for connected-account scheduling and analytics. Vocal Music quotes require your explicit lyric-rights confirmation.',
  'mcp.tool.reserve_source_upload': 'Reserve a short-lived upload for source media you own; this does not spend credits.',
  'mcp.tool.get_music_draft': 'Read the authoritative Custom Music draft and provider contract; edit the draft in Veyrnox.',
  'mcp.tool.estimate_music_generation': 'Quote two Music candidates from the saved draft without charging credits.',
  'mcp.tool.generate_music': 'Generate two Music candidates only after you approve the exact frozen quote.',
  'mcp.tool.get_music_generation': 'Check both Music candidates and receive short-lived signed audio links when ready.',
  'mcp.tool.list_music_playlists': 'List Music playlists owned by your account.',
  'mcp.tool.create_music_playlist': 'Create an owned Music playlist with a retry-safe key.',
  'mcp.tool.update_music_playlist': 'Replace up to 75 unique songs or change a playlist’s pinned state.',
});

const CURRENT_TRANSLATIONS = Object.freeze({
  de: {
    'mcp.lead.current': 'Gib einem MCP-fähigen Assistenten Zugriff auf Veyrnox.ai-Modelle, genaue Credit-Schätzungen, Generierungen, Musikentwürfe, Playlists und fertige Bibliotheksinhalte. Werkzeuge, die Credits verbrauchen, benötigen immer einen exakt bestätigten Preis.',
    'mcp.s3.body.current': 'Frag nach Modellen, Kosten, letzten Arbeiten, Musikentwürfen oder Playlists. Bevor Bild, Video, Bearbeitung oder Musik Credits verbraucht, muss der Assistent den genauen Preis zeigen und deine Zustimmung erhalten.',
    'mcp.what.title.current': 'Modelle, Medien, Musik und Playlists in einem Connector.',
    'mcp.what.p.current': 'Lies Modelle, Guthaben, Generierungen, den maßgeblichen Musikentwurf und eigene Playlists. Lade eigene Quellen hoch oder erstelle Bilder, Videos, Bearbeitungen und zwei Musikkandidaten erst nach Preisbestätigung. Gesangsentwürfe brauchen deine ausdrückliche Bestätigung der Textrechte.',
  },
  es: {
    'mcp.lead.current': 'Da a un asistente compatible con MCP acceso a modelos, estimaciones exactas, generaciones, borradores de música, playlists y recursos terminados de Veyrnox.ai. Las herramientas que gastan créditos siempre requieren un precio exacto confirmado.',
    'mcp.s3.body.current': 'Pregunta por modelos, costes, trabajos recientes, borradores de música o playlists. Antes de gastar créditos en imagen, vídeo, edición o música, el asistente debe mostrar el precio exacto y recibir tu aprobación.',
    'mcp.what.title.current': 'Modelos, contenido, música y playlists en un conector.',
    'mcp.what.p.current': 'Consulta modelos, saldo, generaciones, el borrador oficial de música y tus playlists. Sube fuentes propias o crea imágenes, vídeos, ediciones y dos candidatos musicales tras confirmar el precio. La música con voz requiere tu confirmación expresa de los derechos de la letra.',
  },
  fr: {
    'mcp.lead.current': 'Donnez à un assistant compatible MCP accès aux modèles Veyrnox.ai, aux estimations exactes, aux générations, aux brouillons musicaux, aux playlists et aux éléments terminés. Tout outil dépensant des crédits exige un prix exact confirmé.',
    'mcp.s3.body.current': 'Demandez des modèles, des coûts, des créations récentes, des brouillons musicaux ou des playlists. Avant toute dépense pour une image, une vidéo, un montage ou de la musique, l’assistant doit afficher le prix exact et obtenir votre accord.',
    'mcp.what.title.current': 'Modèles, médias, musique et playlists dans un seul connecteur.',
    'mcp.what.p.current': 'Consultez modèles, soldes, générations, brouillon musical de référence et playlists. Importez vos sources ou créez images, vidéos, montages et deux propositions musicales après confirmation du prix. Un morceau vocal exige votre confirmation explicite des droits sur les paroles.',
  },
  pt: {
    'mcp.lead.current': 'Dê a um assistente compatível com MCP acesso a modelos, estimativas exatas, gerações, rascunhos de música, playlists e itens finalizados da Veyrnox.ai. Ferramentas que gastam créditos sempre exigem um preço exato confirmado.',
    'mcp.s3.body.current': 'Pergunte sobre modelos, custos, trabalhos recentes, rascunhos de música ou playlists. Antes de gastar créditos com imagem, vídeo, edição ou música, o assistente deve mostrar o preço exato e receber sua aprovação.',
    'mcp.what.title.current': 'Modelos, mídia, música e playlists em um conector.',
    'mcp.what.p.current': 'Consulte modelos, saldos, gerações, o rascunho musical oficial e suas playlists. Envie fontes próprias ou crie imagens, vídeos, edições e duas opções musicais após confirmar o preço. Música com voz exige sua confirmação explícita dos direitos da letra.',
  },
  ru: {
    'mcp.lead.current': 'Дайте MCP-совместимому ассистенту доступ к моделям Veyrnox.ai, точным оценкам, генерациям, музыкальным черновикам, плейлистам и готовым материалам. Инструменты, расходующие кредиты, всегда требуют подтверждения точной цены.',
    'mcp.s3.body.current': 'Спрашивайте о моделях, стоимости, недавних работах, музыкальных черновиках и плейлистах. Перед расходованием кредитов на изображение, видео, монтаж или музыку ассистент должен показать точную цену и получить ваше согласие.',
    'mcp.what.title.current': 'Модели, медиа, музыка и плейлисты в одном коннекторе.',
    'mcp.what.p.current': 'Просматривайте модели, баланс, генерации, основной музыкальный черновик и свои плейлисты. Загружайте собственные исходники или создавайте изображения, видео, монтаж и два музыкальных варианта после подтверждения цены. Для вокала нужно явное подтверждение прав на текст.',
  },
  ja: {
    'mcp.lead.current': 'MCP対応アシスタントから、Veyrnox.aiのモデル、正確なクレジット見積もり、生成履歴、音楽ドラフト、プレイリスト、完成済みライブラリアセットを利用できます。クレジットを使うツールには、必ず正確な料金の確認が必要です。',
    'mcp.s3.body.current': 'モデル、料金、最近の作品、音楽ドラフト、プレイリストについて質問できます。画像・動画・編集・音楽でクレジットを使う前に、アシスタントが正確な料金を示し、あなたの承認を受けます。',
    'mcp.what.title.current': 'モデル、メディア、音楽、プレイリストを1つのコネクタで。',
    'mcp.what.p.current': 'モデル、残高、生成履歴、正式な音楽ドラフト、自分のプレイリストを確認できます。所有する素材をアップロードし、料金確認後に画像、動画、編集、2つの音楽候補を作成できます。ボーカル曲では歌詞の権利確認が必要です。',
  },
  ko: {
    'mcp.lead.current': 'MCP 호환 도우미에서 Veyrnox.ai 모델, 정확한 크레딧 견적, 생성 기록, 음악 초안, 플레이리스트와 완성된 라이브러리 자산을 이용하세요. 크레딧을 쓰는 도구는 항상 정확한 가격 확인이 필요합니다.',
    'mcp.s3.body.current': '모델, 비용, 최근 작업, 음악 초안이나 플레이리스트를 물어보세요. 이미지, 영상, 편집 또는 음악에 크레딧을 쓰기 전에 도우미가 정확한 가격을 보여 주고 승인을 받습니다.',
    'mcp.what.title.current': '모델, 미디어, 음악, 플레이리스트를 하나의 커넥터에서.',
    'mcp.what.p.current': '모델, 잔액, 생성 기록, 공식 음악 초안과 내 플레이리스트를 확인하세요. 소유한 소스를 업로드하고 가격 확인 후 이미지, 영상, 편집과 두 개의 음악 후보를 만들 수 있습니다. 보컬 음악은 가사 권리에 대한 명시적 확인이 필요합니다.',
  },
  zh: {
    'mcp.lead.current': '让兼容 MCP 的助手访问 Veyrnox.ai 模型、准确的点数估算、生成记录、音乐草稿、播放列表和已完成的素材。任何消耗点数的工具都必须先确认准确价格。',
    'mcp.s3.body.current': '可询问模型、费用、近期作品、音乐草稿或播放列表。图片、视频、编辑或音乐在消耗点数前，助手必须显示准确价格并获得你的批准。',
    'mcp.what.title.current': '一个连接器管理模型、媒体、音乐和播放列表。',
    'mcp.what.p.current': '查看模型、余额、生成记录、权威音乐草稿和自己的播放列表。可上传自有素材，并在确认价格后创建图片、视频、编辑任务和两个音乐候选。人声音乐还需要你明确确认拥有歌词使用权。',
  },
  ar: {
    'mcp.lead.current': 'امنح مساعدًا متوافقًا مع MCP وصولًا إلى نماذج Veyrnox.ai وتقديرات الرصيد الدقيقة وعمليات التوليد ومسودات الموسيقى وقوائم التشغيل والمواد المكتملة. تتطلب أدوات إنفاق الرصيد دائمًا تأكيد السعر الدقيق.',
    'mcp.s3.body.current': 'اسأل عن النماذج والتكاليف والأعمال الحديثة ومسودات الموسيقى أو قوائم التشغيل. قبل إنفاق الرصيد على صورة أو فيديو أو تحرير أو موسيقى، يجب أن يعرض المساعد السعر الدقيق ويحصل على موافقتك.',
    'mcp.what.title.current': 'النماذج والوسائط والموسيقى وقوائم التشغيل في موصل واحد.',
    'mcp.what.p.current': 'اطّلع على النماذج والأرصدة وعمليات التوليد ومسودة الموسيقى المعتمدة وقوائمك. ارفع مواد تملكها أو أنشئ صورًا وفيديوهات وتحريرات وخيارين موسيقيين بعد تأكيد السعر. تتطلب الموسيقى الغنائية تأكيدك الصريح لحقوق الكلمات.',
  },
  hi: {
    'mcp.lead.current': 'MCP-संगत सहायक को Veyrnox.ai मॉडल, सटीक क्रेडिट अनुमान, जनरेशन, संगीत ड्राफ़्ट, प्लेलिस्ट और तैयार लाइब्रेरी सामग्री तक पहुँच दें। क्रेडिट खर्च करने वाले टूल के लिए हमेशा सटीक कीमत की पुष्टि जरूरी है।',
    'mcp.s3.body.current': 'मॉडल, लागत, हाल के काम, संगीत ड्राफ़्ट या प्लेलिस्ट के बारे में पूछें। इमेज, वीडियो, एडिट या संगीत पर क्रेडिट खर्च होने से पहले सहायक सटीक कीमत दिखाकर आपकी मंजूरी लेता है।',
    'mcp.what.title.current': 'एक कनेक्टर में मॉडल, मीडिया, संगीत और प्लेलिस्ट।',
    'mcp.what.p.current': 'मॉडल, बैलेंस, जनरेशन, आधिकारिक संगीत ड्राफ़्ट और अपनी प्लेलिस्ट देखें। अपनी स्रोत सामग्री अपलोड करें या कीमत की पुष्टि के बाद इमेज, वीडियो, एडिट और दो संगीत विकल्प बनाएँ। वोकल संगीत के लिए गीत के अधिकारों की स्पष्ट पुष्टि जरूरी है।',
  },
});

export function mcpMusicCurrent(locale) {
  return CURRENT_TRANSLATIONS[locale] || {};
}
