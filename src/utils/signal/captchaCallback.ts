/**
 * Signal Captcha Callback Storage
 *
 * Simple module to store and retrieve the captcha callback.
 * This is needed because BottomSheet data can't easily pass callbacks.
 */

import type { SignalIdentity } from '../../store/types/slashtags';

type CaptchaCallback = (captchaToken: string, challengeToken: string) => void;

let pendingCallback: CaptchaCallback | null = null;
let captchaVisible = false;
let storedChallengeToken: string | null = null;
let pendingChatContext: { name: string; signal: SignalIdentity } | null = null;

export function setCaptchaCallback(callback: CaptchaCallback): void {
	pendingCallback = callback;
}

export function getCaptchaCallback(): CaptchaCallback | null {
	return pendingCallback;
}

export function clearCaptchaCallback(): void {
	pendingCallback = null;
	storedChallengeToken = null;
}

export function setCaptchaVisible(visible: boolean): void {
	captchaVisible = visible;
}

export function isCaptchaVisible(): boolean {
	return captchaVisible;
}

export function setChallengeToken(token: string): void {
	storedChallengeToken = token;
}

export function getChallengeToken(): string | null {
	return storedChallengeToken;
}

// Store chat context so we can navigate back after captcha
export function setPendingChatContext(context: { name: string; signal: SignalIdentity }): void {
	pendingChatContext = context;
}

export function getPendingChatContext(): { name: string; signal: SignalIdentity } | null {
	return pendingChatContext;
}

export function clearPendingChatContext(): void {
	pendingChatContext = null;
}
