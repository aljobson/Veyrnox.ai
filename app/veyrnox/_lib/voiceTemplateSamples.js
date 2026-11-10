// Original sample lines for the voice template library: one per palette category in each of
// the ten languages that are both a site language and a speech language. No brand, real
// person or cloned voice. Language names match TTS_LANGUAGES in textToSpeech.js.

export const VOICE_TEMPLATE_LANGUAGES = Object.freeze([
  'English', 'Spanish', 'French', 'German', 'Portuguese', 'Russian', 'Chinese', 'Japanese', 'Korean', 'Arabic',
]);

const line = (narration, marketing, explainers, characters, service) => Object.freeze({
  Narration: narration, Marketing: marketing, Explainers: explainers, Characters: characters, Service: service,
});

export const VOICE_TEMPLATE_SAMPLES = Object.freeze({
  English: line(
    'The corridor was longer than she remembered. At the far end, a single door stood open, and the lamp behind it was still burning.',
    'Meet the lamp that follows your day. Warm in the morning, cool at noon, soft at night.',
    "First, open Settings and tap Account. Next, choose Backup and switch it on. That's it.",
    'I have walked a long way to reach this gate, and I will not turn back now.',
    'Thank you for calling. Please stay on the line and the next available team member will be with you shortly.',
  ),
  Spanish: line(
    'El pasillo era más largo de lo que recordaba. Al fondo, una puerta estaba abierta y la lámpara de detrás seguía encendida.',
    'Conoce la lámpara que sigue tu día. Cálida por la mañana, fresca al mediodía, suave por la noche.',
    'Primero, abre Ajustes y toca Cuenta. Después, elige Copia de seguridad y actívala. Eso es todo.',
    'He caminado mucho para llegar a esta puerta y ahora no pienso volver atrás.',
    'Gracias por llamar. Permanezca en la línea y el siguiente agente disponible le atenderá en breve.',
  ),
  French: line(
    'Le couloir était plus long que dans son souvenir. Tout au bout, une porte était ouverte et la lampe derrière brûlait encore.',
    'Découvrez la lampe qui suit votre journée. Chaude le matin, fraîche à midi, douce le soir.',
    'D’abord, ouvrez Réglages et touchez Compte. Ensuite, choisissez Sauvegarde et activez-la. Voilà.',
    'J’ai marché longtemps pour atteindre cette porte, et je ne ferai pas demi-tour maintenant.',
    'Merci de votre appel. Veuillez patienter, le prochain conseiller disponible va vous répondre.',
  ),
  German: line(
    'Der Flur war länger, als sie ihn in Erinnerung hatte. Am Ende stand eine Tür offen, und die Lampe dahinter brannte noch.',
    'Lernen Sie die Lampe kennen, die Ihren Tag begleitet. Morgens warm, mittags kühl, abends sanft.',
    'Öffnen Sie zuerst die Einstellungen und tippen Sie auf Konto. Wählen Sie dann Backup und schalten Sie es ein. Fertig.',
    'Ich bin weit gelaufen, um dieses Tor zu erreichen, und ich kehre jetzt nicht um.',
    'Vielen Dank für Ihren Anruf. Bitte bleiben Sie in der Leitung, der nächste freie Mitarbeiter meldet sich gleich.',
  ),
  Portuguese: line(
    'O corredor era mais longo do que ela se lembrava. No fundo, uma porta estava aberta e o candeeiro atrás dela ainda ardia.',
    'Conheça o candeeiro que acompanha o seu dia. Quente de manhã, fresco ao meio-dia, suave à noite.',
    'Primeiro, abra as Definições e toque em Conta. Depois, escolha Cópia de segurança e ative-a. Pronto.',
    'Caminhei muito para chegar a este portão e não vou voltar atrás agora.',
    'Obrigado pela sua chamada. Aguarde na linha, o próximo atendente disponível falará consigo em breve.',
  ),
  Russian: line(
    'Коридор был длиннее, чем она помнила. В конце стояла открытая дверь, а лампа за ней всё ещё горела.',
    'Познакомьтесь с лампой, которая следует за вашим днём. Тёплая утром, прохладная днём, мягкая вечером.',
    'Сначала откройте Настройки и нажмите Аккаунт. Затем выберите Резервное копирование и включите его. Это всё.',
    'Я долго шёл к этим воротам и не поверну назад.',
    'Спасибо за звонок. Оставайтесь на линии, первый освободившийся сотрудник скоро ответит вам.',
  ),
  Chinese: line(
    '走廊比她记忆中的更长。尽头有一扇敞开的门，门后的灯还亮着。',
    '认识一盏陪你度过一天的灯。早晨温暖，中午清爽，夜晚柔和。',
    '首先打开设置，点击账户。然后选择备份并打开开关。就这样。',
    '我走了很远才来到这扇门前，现在绝不会回头。',
    '感谢您的来电。请不要挂断，下一位空闲的客服很快为您服务。',
  ),
  Japanese: line(
    '廊下は記憶よりずっと長かった。突き当たりのドアは開いていて、その奥の明かりはまだ灯っていた。',
    '一日に寄り添うランプをご紹介します。朝は暖かく、昼は爽やかに、夜はやさしく。',
    'まず設定を開いて、アカウントをタップします。次にバックアップを選んでオンにします。これで完了です。',
    '長い道のりを歩いてこの門にたどり着いた。今さら引き返すつもりはない。',
    'お電話ありがとうございます。そのままお待ちください。順番に担当者がご案内いたします。',
  ),
  Korean: line(
    '복도는 기억보다 훨씬 길었다. 끝에는 문이 열려 있었고, 그 뒤의 등불은 여전히 켜져 있었다.',
    '하루를 따라다니는 조명을 소개합니다. 아침엔 따뜻하게, 낮엔 시원하게, 밤엔 부드럽게.',
    '먼저 설정을 열고 계정을 누르세요. 그다음 백업을 선택해 켜면 됩니다. 이게 전부예요.',
    '이 문까지 먼 길을 걸어왔다. 이제 와서 돌아서지는 않겠다.',
    '전화해 주셔서 감사합니다. 잠시만 기다려 주시면 다음 상담원이 곧 연결해 드리겠습니다.',
  ),
  Arabic: line(
    'كان الممر أطول مما تتذكر. وفي نهايته بابٌ مفتوح، والمصباح خلفه ما زال مضاءً.',
    'تعرّف على المصباح الذي يرافق يومك. دافئ في الصباح، منعش عند الظهر، هادئ في المساء.',
    'أولاً افتح الإعدادات واضغط على الحساب. ثم اختر النسخ الاحتياطي وفعّله. هذا كل شيء.',
    'مشيت طويلاً حتى وصلت إلى هذه البوابة، ولن أعود أدراجي الآن.',
    'شكراً لاتصالك. يرجى البقاء على الخط وسيرد عليك أول موظف متاح خلال لحظات.',
  ),
});

export const voiceTemplateSample = (language, category) => VOICE_TEMPLATE_SAMPLES[language]?.[category] || '';
