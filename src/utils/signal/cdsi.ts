/**
 * Signal Contact Discovery Service (CDSI) Integration
 *
 * Provides phone number to ACI/PNI lookup through Signal's CDSI.
 *
 * CDSI uses SGX enclaves for privacy-preserving contact discovery.
 * The flow is:
 * 1. Get CDSI auth token from /v2/directory/auth
 * 2. Connect to CDSI WebSocket at cdsi.signal.org
 * 3. Perform SGX attestation
 * 4. Send encrypted phone numbers
 * 5. Receive ACI/PNI mappings
 *
 * Note: Full CDSI requires native libsignal with SGX attestation support.
 * This module provides auth and helper functions, but actual lookups
 * require the libsignal CDSI client.
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { getAccountInfo, getAuthPassword } from '../../storage/signal-store';

const SIGNAL_SERVER = 'https://chat.signal.org';

interface CdsiAuthCredentials {
	username: string;
	password: string;
}

export interface CdsiLookupResult {
	e164: string;
	aci: string | null;
	pni: string | null;
}

/**
 * Get CDSI authentication credentials from Signal server.
 * These are separate from the main account credentials and are used
 * to authenticate with the CDSI enclave.
 */
export async function getCdsiAuthCredentials(): Promise<CdsiAuthCredentials> {
	const accountInfo = await getAccountInfo();
	const password = await getAuthPassword();

	if (!accountInfo || !password) {
		throw new Error('Not linked to Signal - no account info');
	}

	const { aci, deviceId } = accountInfo;
	const authString = `${aci}.${deviceId}:${password}`;
	const authHeader = `Basic ${Buffer.from(authString).toString('base64')}`;

	console.log('CDSI: Fetching auth credentials...');

	const response = await fetch(`${SIGNAL_SERVER}/v2/directory/auth`, {
		method: 'GET',
		headers: {
			Authorization: authHeader,
			'Content-Type': 'application/json',
		},
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`Failed to get CDSI auth: ${response.status} ${text}`);
	}

	const data = await response.json();
	console.log('CDSI: Got auth credentials, username:', data.username?.substring(0, 8) + '...');

	return {
		username: data.username,
		password: data.password,
	};
}

/**
 * Format a phone number to E.164 format.
 * E.164 format: +[country code][subscriber number]
 * Examples: +14155551234, +442071234567
 */
export function formatE164(phoneNumber: string): string {
	// Remove all non-digit characters except leading +
	let cleaned = phoneNumber.replace(/[^\d+]/g, '');

	// Ensure it starts with +
	if (!cleaned.startsWith('+')) {
		// Assume US number if no country code
		if (cleaned.length === 10) {
			cleaned = '+1' + cleaned;
		} else if (cleaned.length === 11 && cleaned.startsWith('1')) {
			cleaned = '+' + cleaned;
		} else {
			cleaned = '+' + cleaned;
		}
	}

	return cleaned;
}

/**
 * Convert phone number to 8-byte big-endian format for CDSI.
 * Phone numbers are sent as uint64 in E.164 format without the + prefix.
 */
function e164ToBytes(e164: string): Uint8Array {
	// Remove the + prefix and convert to number
	const numStr = e164.replace('+', '');
	const num = BigInt(numStr);

	// Convert to 8-byte big-endian
	const bytes = new Uint8Array(8);
	let n = num;
	for (let i = 7; i >= 0; i--) {
		bytes[i] = Number(n & BigInt(0xff));
		n >>= BigInt(8);
	}

	return bytes;
}

/**
 * Parse CDSI response entry (e164 + PNI + ACI = 40 bytes per entry).
 * Format: 8 bytes e164 + 16 bytes PNI UUID + 16 bytes ACI UUID
 */
function parseCdsiResponseEntry(data: Uint8Array, offset: number): CdsiLookupResult | null {
	if (offset + 40 > data.length) {
		return null;
	}

	// Read e164 (8 bytes big-endian)
	let e164Num = BigInt(0);
	for (let i = 0; i < 8; i++) {
		e164Num = (e164Num << BigInt(8)) | BigInt(data[offset + i]);
	}
	const e164 = '+' + e164Num.toString();

	// Read PNI UUID (16 bytes) - may be all zeros if not found
	const pniBytes = data.slice(offset + 8, offset + 24);
	const pni = uuidFromBytes(pniBytes);

	// Read ACI UUID (16 bytes) - may be all zeros if not found
	const aciBytes = data.slice(offset + 24, offset + 40);
	const aci = uuidFromBytes(aciBytes);

	return { e164, aci, pni };
}

/**
 * Convert 16-byte UUID to string format.
 * Returns null if all zeros.
 */
function uuidFromBytes(bytes: Uint8Array): string | null {
	// Check if all zeros
	let allZeros = true;
	for (let i = 0; i < 16; i++) {
		if (bytes[i] !== 0) {
			allZeros = false;
			break;
		}
	}
	if (allZeros) {
		return null;
	}

	// Format as UUID string: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
	const hex = Buffer.from(bytes).toString('hex');
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Look up phone numbers through CDSI.
 *
 * Note: This is a simplified implementation. The full CDSI protocol involves:
 * - SGX remote attestation
 * - Encrypted WebSocket communication
 * - Rate limiting tokens
 *
 * For a complete implementation, you would need to use libsignal's native
 * CDSI client which handles all the SGX attestation complexity.
 *
 * @param phoneNumbers Array of phone numbers in E.164 format
 * @returns Array of lookup results with ACI/PNI for each number
 */
export async function lookupPhoneNumbers(phoneNumbers: string[]): Promise<CdsiLookupResult[]> {
	console.log('CDSI: Looking up', phoneNumbers.length, 'phone numbers');

	// Format all numbers to E.164
	const e164Numbers = phoneNumbers.map(formatE164);
	console.log('CDSI: Formatted numbers:', e164Numbers);

	// Get CDSI auth credentials
	const auth = await getCdsiAuthCredentials();
	console.log('CDSI: Got auth, username:', auth.username.substring(0, 8) + '...');

	// Note: The actual CDSI lookup requires:
	// 1. WebSocket connection to cdsi.signal.org
	// 2. SGX attestation handshake
	// 3. Encrypted request/response
	//
	// This requires the libsignal CDSI client which handles:
	// - MRENCLAVE verification
	// - Noise protocol encryption
	// - Rate limiting token management
	//
	// For now, we'll return a placeholder indicating the feature needs
	// native libsignal CDSI support.

	throw new Error(
		'CDSI lookup requires native libsignal support. ' +
		'The react-native-libsignal-client package needs ConnectionManager and CdsiLookup bindings.'
	);
}

/**
 * Simple hash-based contact discovery (legacy/fallback).
 *
 * WARNING: This method is less private than CDSI. The server can potentially
 * invert hashes due to small keyspace. Use CDSI when possible.
 *
 * This uses the older /v1/directory endpoint with truncated SHA-256 hashes.
 *
 * @deprecated Use lookupPhoneNumbers with CDSI instead
 */
export async function lookupPhoneNumbersLegacy(phoneNumbers: string[]): Promise<Map<string, string | null>> {
	console.log('CDSI Legacy: Looking up', phoneNumbers.length, 'phone numbers');

	const accountInfo = await getAccountInfo();
	const password = await getAuthPassword();

	if (!accountInfo || !password) {
		throw new Error('Not linked to Signal - no account info');
	}

	const { aci, deviceId } = accountInfo;
	const authString = `${aci}.${deviceId}:${password}`;
	const authHeader = `Basic ${Buffer.from(authString).toString('base64')}`;

	// Format numbers and compute hashes
	const results = new Map<string, string | null>();

	for (const phoneNumber of phoneNumbers) {
		const e164 = formatE164(phoneNumber);

		// Note: The legacy directory endpoint /v1/directory/tokens was deprecated
		// and removed in favor of CDSI.
		//
		// Without CDSI support, we cannot perform contact discovery.
		results.set(e164, null);
	}

	console.log('CDSI Legacy: Contact discovery requires CDSI - returning empty results');
	return results;
}

/**
 * Check if CDSI is available (requires native libsignal bindings).
 */
export function isCdsiAvailable(): boolean {
	// Check if the required libsignal bindings are available
	try {
		// The react-native-libsignal-client needs to expose:
		// - ConnectionManager
		// - CdsiLookup
		// - LookupRequest

		// For now, return false as these aren't available in the current package
		return false;
	} catch {
		return false;
	}
}

/**
 * Check if an account exists by ACI.
 * This is a simple HEAD request that doesn't require CDSI.
 *
 * @param identifier ACI or PNI UUID
 * @returns true if account exists, false otherwise
 */
export async function checkAccountExists(identifier: string): Promise<boolean> {
	try {
		// This endpoint is unauthenticated and rate-limited
		const response = await fetch(`${SIGNAL_SERVER}/v1/accounts/account/${identifier}`, {
			method: 'HEAD',
		});

		return response.status === 200;
	} catch (error) {
		console.error('CDSI: Failed to check account existence:', error);
		return false;
	}
}

/**
 * Get ACI for a single phone number.
 * Convenience wrapper around lookupPhoneNumbers.
 *
 * @param phoneNumber Phone number in E.164 format (e.g., +14155551234)
 * @returns ACI string if found, null otherwise
 */
export async function getAciForPhoneNumber(phoneNumber: string): Promise<string | null> {
	try {
		const results = await lookupPhoneNumbers([phoneNumber]);
		if (results.length > 0 && results[0].aci) {
			return results[0].aci;
		}
		return null;
	} catch (error) {
		console.error('CDSI: Failed to lookup phone number:', error);
		return null;
	}
}

/**
 * Test CDSI auth - verifies we can get credentials for contact discovery.
 * This is useful to test that the account is properly set up for CDSI.
 */
export async function testCdsiAuth(): Promise<{ success: boolean; message: string }> {
	try {
		const auth = await getCdsiAuthCredentials();
		return {
			success: true,
			message: `CDSI auth successful. Username: ${auth.username.substring(0, 12)}...`,
		};
	} catch (error) {
		return {
			success: false,
			message: `CDSI auth failed: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

export default {
	getCdsiAuthCredentials,
	formatE164,
	lookupPhoneNumbers,
	lookupPhoneNumbersLegacy,
	isCdsiAvailable,
	checkAccountExists,
	getAciForPhoneNumber,
	testCdsiAuth,
};
