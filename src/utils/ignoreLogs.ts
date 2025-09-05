import { LogBox } from 'react-native';
import { __E2E__, __ENABLE_LDK_LOGS__ } from '../constants/env';

if (__DEV__) {
	const ignoredLogs: string[] = [];
	const ignoredInfo: string[] = [];
	const ignoredWarnings: string[] = ['Require cycle'];
	const ignoredErrors: string[] = [
		'BackHandler.removeEventListener is not a function',
		'removeEventListener is not a function',
		'_reactNative.BackHandler.removeEventListener is not a function',
		'TypeError: _reactNative.BackHandler.removeEventListener is not a function',
	];

	// disable all logs for E2E tests running in debug mode
	if (__E2E__) {
		LogBox.ignoreAllLogs();
	}

	if (!__ENABLE_LDK_LOGS__) {
		ignoredLogs.push('LDK:', 'react-native-ldk:', 'DEBUG (JS)', 'ERROR (JS)');
	}

	// Ignore specific BackHandler deprecation error and related errors
	LogBox.ignoreLogs([
		'BackHandler.removeEventListener is not a function',
		'removeEventListener is not a function', 
		'_reactNative.BackHandler.removeEventListener is not a function',
		'TypeError: _reactNative.BackHandler.removeEventListener is not a function',
		'componentWillUnmount',
		// Additional patterns that might appear
		'BackHandler.removeEventListener',
		'TypeError:',
		'safelyCallComponentWillUnmount',
		'commitDeletionEffectsOnFiber',
	]);

	const withoutIgnored = (
		logger: (...data: any[]) => void,
		ignoreList: string[],
	): any => {
		return (...args): void => {
			let output: string;
			try {
				output = args.join(' ');
			} catch (_err) {
				// if we can't check if the log should be ignored, just log it
				logger(...args);
				return;
			}

			if (!ignoreList.some((log) => output.includes(log))) {
				logger(...args);
			}
		};
	};

	console.log = withoutIgnored(console.log, ignoredLogs);
	console.info = withoutIgnored(console.info, ignoredInfo);
	console.warn = withoutIgnored(console.warn, ignoredWarnings);
	console.error = withoutIgnored(console.error, ignoredErrors);
}
