'use client';

import { adoptSession, gotruePost, withCaptcha } from './authClient.js';

/** Request one SMS code. GoTrue creates the account only after verification. */
export async function sendPhoneOtp(phone, captchaToken) {
    await gotruePost('/auth/v1/otp', withCaptcha({ phone, create_user: true }, captchaToken));
}

/** Verify the SMS code and adopt the returned session through the shared store. */
export async function verifyPhoneOtp(phone, token) {
    const data = await gotruePost('/auth/v1/verify', { phone, token, type: 'sms' });
    if (!data?.access_token) throw new Error('Phone verification returned no session');
    return adoptSession(data);
}
