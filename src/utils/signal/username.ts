/**
 * Signal Username Lookup
 *
 * Provides username to ACI lookup through Signal's username API.
 *
 * Signal usernames are in the format "nickname.discriminator" (e.g., "alice.42").
 * The lookup process:
 * 1. Hash the username using libsignal's Username class
 * 2. Base64url encode the hash
 * 3. Make an unauthenticated GET request to /v1/accounts/username_hash/{hash}
 * 4. Receive the ACI (UUID) if the username exists
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { usernames } from 'react-native-libsignal-client';

// Match Signal Android user-agent format
const USER_AGENT = 'Signal-Android/7.71.2 Android/34';

// Signal server URLs
const SIGNAL_SERVERS = {
	production: 'https://chat.signal.org',
	staging: 'https://chat.staging.signal.org',
} as const;

/**
 * Convert a Uint8Array to base64url encoding (URL-safe base64 without padding)
 */
function toBase64Url(buffer: Uint8Array): string {
	const base64 = Buffer.from(buffer).toString('base64');
	return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export interface UsernameLookupResult {
	username: string;
	aci: string;
}

export type UsernameEnvironment = 'production' | 'staging';

/**
 * Check if username lookup is available.
 */
export function isUsernameLookupAvailable(): boolean {
	try {
		return typeof usernames.hash === 'function';
	} catch {
		return false;
	}
}

/**
 * Hash a username using the Signal username hashing algorithm.
 *
 * @param username The full username (e.g., "alice.42")
 * @returns Base64url-encoded hash of the username
 * @throws Error if the username format is invalid
 */
export async function hashUsername(username: string): Promise<string> {
	const hash = usernames.hash(username);
	return toBase64Url(hash);
}

/**
 * Look up a Signal user by their username.
 *
 * @param username The full username (e.g., "alice.42")
 * @param environment The Signal environment ('production' or 'staging')
 * @returns The ACI (UUID) and username if found, or null if not found
 * @throws Error if the username format is invalid or network error occurs
 *
 * @example
 * ```typescript
 * const result = await lookupByUsername('alice.42');
 * if (result) {
 *   console.log(`Found user: ${result.username} -> ${result.aci}`);
 * } else {
 *   console.log('User not found');
 * }
 * ```
 */
export async function lookupByUsername(
	username: string,
	environment: UsernameEnvironment = 'production',
): Promise<UsernameLookupResult | null> {
	// Validate basic username format (should contain a dot separator)
	if (!username.includes('.')) {
		throw new Error(
			'Invalid username format. Username must include a discriminator (e.g., "nickname.01")',
		);
	}

	const hash = await hashUsername(username);
	const baseUrl = SIGNAL_SERVERS[environment];
	const url = `${baseUrl}/v1/accounts/username_hash/${hash}`;

	try {
		const response = await fetch(url, {
			method: 'GET',
			headers: {
				'User-Agent': USER_AGENT,
				Accept: 'application/json',
			},
		});

		if (response.status === 404) {
			return null;
		}

		if (!response.ok) {
			throw new Error(`Username lookup failed: ${response.status} ${response.statusText}`);
		}

		const data = await response.json();

		if (!data.uuid) {
			return null;
		}

		return {
			username,
			aci: data.uuid,
		};
	} catch (error) {
		if (error instanceof Error && error.message.includes('404')) {
			return null;
		}
		throw error;
	}
}

/**
 * Look up multiple usernames and return all found results.
 *
 * @param usernames Array of usernames to look up
 * @param environment The Signal environment
 * @returns Array of found users (usernames that weren't found are omitted)
 */
export async function lookupMultipleUsernames(
	usernameList: string[],
	environment: UsernameEnvironment = 'production',
): Promise<UsernameLookupResult[]> {
	const results: UsernameLookupResult[] = [];

	// Look up sequentially to avoid rate limiting
	for (const username of usernameList) {
		try {
			const result = await lookupByUsername(username, environment);
			if (result) {
				results.push(result);
			}
		} catch (error) {
			// Log but continue with other usernames
			console.warn(`Failed to look up username "${username}":`, error);
		}
	}

	return results;
}

// Re-export useful functions from the library
export {
	usernames,
};
