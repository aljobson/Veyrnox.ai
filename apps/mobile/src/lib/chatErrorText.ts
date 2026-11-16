import { t } from './i18n';

export const ERROR_TEXT: Record<string, string> = {
    insufficient_credits: t('chat.notenoughcreditsforthisreply'),
    insufficient_balance: t('chat.notenoughcreditsforthisreply'),
    rate_limited: t('chat.toomanymessagesWaitamoment'),
    option_unavailable: t('chat.thatchoiceisnotavailableforthis'),
    invalid_text: t('chat.composer.tooLong'),
    chat_not_open: t('chat.chatisnotavailablerightnow'),
    consent_declined: t('chat.youneedtoagreetoAIsharing'),
};
