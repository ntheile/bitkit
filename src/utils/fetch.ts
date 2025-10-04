// Add text streaming support via react-native-fetch-api.
// Previous implementation recursively called the patched fetch (global.fetch -> global.fetch),
// causing an early runtime failure that prevented RN from registering core callable modules (e.g. JSTimers).
// Keep an idempotent patch with original reference.

declare const global: any;

if (!global.__BITKIT_FETCH_PATCHED__) {
	const originalFetch: typeof fetch | undefined = global.fetch;
	if (originalFetch) {
		global.fetch = (
			url: RequestInfo | URL,
			options: any = {},
		): Promise<Response> => {
			const { reactNative: rnOpts, ...rest } = options || {};
			return originalFetch(url as any, {
				...rest,
				reactNative: { textStreaming: true, ...(rnOpts || {}) },
			});
		};
		global.__BITKIT_FETCH_PATCHED__ = true;
	}
}

export default global.fetch;
