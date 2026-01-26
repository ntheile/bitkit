/**
 * Signal Captcha Handler
 *
 * Opens the Signal captcha challenge in an external browser.
 * When the user solves the captcha, the browser redirects to signalcaptcha://[token]
 * which is handled as a deep link by the app.
 *
 * This component just listens for deep links and doesn't render anything visible.
 */

import { memo, ReactElement, useEffect } from 'react';
import { Linking } from 'react-native';

import { rootNavigation } from '../navigation/root/RootNavigationContainer';
import {
	getCaptchaCallback,
	clearCaptchaCallback,
	isCaptchaVisible,
	setCaptchaVisible,
	getChallengeToken,
	getPendingChatContext,
	clearPendingChatContext,
} from '../utils/signal/captchaCallback';

const CAPTCHA_URL = 'https://signalcaptchas.org/challenge/generate.html';

const SignalCaptchaSheet = (): ReactElement | null => {
	// Listen for signalcaptcha:// deep links
	useEffect(() => {
		const handleUrl = async (event: { url: string }) => {
			const { url } = event;
			if (url.startsWith('signalcaptcha://')) {
				const captchaToken = url.replace('signalcaptcha://', '');
				console.log('Signal Captcha: Deep link received, token:', captchaToken.slice(0, 50) + '...');

				// Get stored context
				const callback = getCaptchaCallback();
				const challengeToken = getChallengeToken();
				const chatContext = getPendingChatContext();

				// Navigate back to chat first
				if (chatContext) {
					console.log('Signal Captcha: Navigating back to chat with', chatContext.name);
					rootNavigation.navigate('Chat', chatContext);
					clearPendingChatContext();
				}

				// Call the stored callback with both the captcha solution and challenge token
				if (callback && challengeToken) {
					// Small delay to let navigation complete
					setTimeout(() => {
						callback(captchaToken, challengeToken);
						clearCaptchaCallback();
					}, 500);
				} else {
					console.log('Signal Captcha: Missing callback or challenge token');
				}
				setCaptchaVisible(false);
			}
		};

		// Check if app was opened with a captcha URL
		Linking.getInitialURL().then((url) => {
			if (url && url.startsWith('signalcaptcha://')) {
				handleUrl({ url });
			}
		});

		// Listen for incoming links while app is running
		const subscription = Linking.addEventListener('url', handleUrl);

		return () => {
			subscription.remove();
		};
	}, []);

	// Open browser when captcha is needed
	useEffect(() => {
		const checkAndOpenBrowser = async () => {
			if (isCaptchaVisible()) {
				console.log('Signal Captcha: Opening browser for captcha');
				try {
					await Linking.openURL(CAPTCHA_URL);
				} catch (error) {
					console.error('Signal Captcha: Failed to open browser:', error);
				}
				// Reset visibility so we don't keep opening
				setCaptchaVisible(false);
			}
		};

		const interval = setInterval(checkAndOpenBrowser, 100);
		return () => clearInterval(interval);
	}, []);

	// This component doesn't render anything
	return null;
};

export default memo(SignalCaptchaSheet);
