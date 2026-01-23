/**
 * Signal Contacts Manager
 *
 * Handles contact discovery and sync with Signal servers.
 * Signal doesn't expose a direct contacts API - contacts are discovered
 * through device contact hash intersection.
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { getAccountInfo, getAuthPassword } from '../../storage/signal-store';

const SIGNAL_SERVER = 'https://chat.signal.org';
const SIGNAL_CDSI = 'https://cdsi.signal.org'; // Contact Discovery Service

export interface SignalContact {
	aci: string;
	pni?: string;
	phoneNumber: string;
	name?: string;
	profileName?: string;
	profileKey?: string;
	avatarUrl?: string;
}

export interface ContactDiscoveryResult {
	contacts: SignalContact[];
	error?: string;
}

/**
 * Discover Signal users from a list of phone numbers.
 * 
 * Note: This is a simplified implementation. The actual Signal protocol
 * uses CDSI (Contact Discovery Service) with encrypted phone number hashes
 * to preserve privacy.
 */
export async function discoverContacts(
	phoneNumbers: string[],
): Promise<ContactDiscoveryResult> {
	const accountInfo = getAccountInfo();
	if (!accountInfo) {
		return {
			contacts: [],
			error: 'Signal account not linked',
		};
	}

	console.log('Signal Contacts: Discovering contacts from', phoneNumbers.length, 'numbers');

	// TODO: Implement actual CDSI protocol
	// For now, return empty - full implementation requires:
	// 1. Hash phone numbers with contact discovery key
	// 2. Send to CDSI service via encrypted connection
	// 3. Receive back ACI/PNI for matching numbers

	return {
		contacts: [],
		error: 'Contact discovery not yet implemented. Enter phone number or ACI directly.',
	};
}

/**
 * Look up a single contact by phone number.
 * Uses Signal's directory endpoint to check if a phone number is registered.
 * 
 * Note: This is a simplified lookup - full CDSI implementation is more complex.
 */
export async function lookupContact(
	phoneNumber: string,
): Promise<SignalContact | null> {
	const accountInfo = getAccountInfo();
	if (!accountInfo) {
		console.error('Signal Contacts: No account info');
		return null;
	}

	const password = await getAuthPassword();
	if (!password) {
		console.error('Signal Contacts: No auth password');
		return null;
	}

	// Normalize phone number (should be E.164 format)
	const normalized = normalizePhoneNumber(phoneNumber);
	if (!normalized) {
		console.error('Signal Contacts: Invalid phone number format');
		return null;
	}

	console.log('Signal Contacts: Looking up', normalized);

	try {
		// Authentication header
		const credentials = `${accountInfo.aci}.${accountInfo.deviceId}:${password}`;
		const authHeader = `Basic ${Buffer.from(credentials).toString('base64')}`;

		// Try to get profile by phone number identifier
		// Signal uses the format: phone number hash or direct identifier
		// The /v1/profile endpoint can accept a phone number identifier
		const response = await fetch(`${SIGNAL_SERVER}/v1/profile/${encodeURIComponent(normalized)}`, {
			method: 'GET',
			headers: {
				'Authorization': authHeader,
				'Accept': 'application/json',
			},
		});

		console.log('Signal Contacts: Lookup response:', response.status);

		if (response.ok) {
			const data = await response.json();
			console.log('Signal Contacts: Found contact:', data);
			
			return {
				aci: data.uuid || data.aci || '',
				pni: data.pni,
				phoneNumber: normalized,
				profileName: data.name,
				avatarUrl: data.avatar,
			};
		} else if (response.status === 404) {
			console.log('Signal Contacts: Phone number not registered on Signal');
			return null;
		} else {
			const errorText = await response.text();
			console.log('Signal Contacts: Lookup failed:', response.status, errorText);
			return null;
		}
	} catch (error) {
		console.error('Signal Contacts: Error looking up contact:', error);
		return null;
	}
}

/**
 * Look up a contact by ACI (if you already have it).
 * Returns profile information.
 */
export async function lookupByAci(aci: string): Promise<SignalContact | null> {
	const accountInfo = getAccountInfo();
	if (!accountInfo) {
		console.error('Signal Contacts: No account info');
		return null;
	}

	const password = await getAuthPassword();
	if (!password) {
		console.error('Signal Contacts: No auth password');
		return null;
	}

	console.log('Signal Contacts: Looking up ACI', aci);

	try {
		const credentials = `${accountInfo.aci}.${accountInfo.deviceId}:${password}`;
		const authHeader = `Basic ${Buffer.from(credentials).toString('base64')}`;

		const response = await fetch(`${SIGNAL_SERVER}/v1/profile/${aci}`, {
			method: 'GET',
			headers: {
				'Authorization': authHeader,
				'Accept': 'application/json',
			},
		});

		console.log('Signal Contacts: ACI lookup response:', response.status);

		if (response.ok) {
			const data = await response.json();
			return {
				aci: aci,
				pni: data.pni,
				phoneNumber: '', // Not returned for ACI lookup
				profileName: data.name,
				avatarUrl: data.avatar,
			};
		} else {
			console.log('Signal Contacts: ACI not found or error:', response.status);
			return null;
		}
	} catch (error) {
		console.error('Signal Contacts: Error looking up ACI:', error);
		return null;
	}
}

/**
 * Get profile info for a known contact by ACI.
 */
export async function getProfile(aci: string): Promise<Partial<SignalContact> | null> {
	const accountInfo = getAccountInfo();
	if (!accountInfo) {
		return null;
	}

	const password = await getAuthPassword();
	if (!password) {
		return null;
	}

	try {
		// Profile fetch requires authentication
		const credentials = `${accountInfo.aci}.${accountInfo.deviceId}:${password}`;
		const authHeader = `Basic ${Buffer.from(credentials).toString('base64')}`;

		const response = await fetch(`${SIGNAL_SERVER}/v1/profile/${aci}`, {
			method: 'GET',
			headers: {
				'Authorization': authHeader,
				'Accept': 'application/json',
			},
		});

		if (!response.ok) {
			console.log('Signal Contacts: Profile fetch failed:', response.status);
			return null;
		}

		const data = await response.json();
		return {
			aci,
			profileName: data.name,
			avatarUrl: data.avatar,
		};
	} catch (error) {
		console.error('Signal Contacts: Error fetching profile:', error);
		return null;
	}
}

/**
 * Normalize phone number to E.164 format.
 */
export function normalizePhoneNumber(phone: string): string | null {
	// Remove all non-digit characters except leading +
	let cleaned = phone.replace(/[^\d+]/g, '');

	// If no + prefix and looks like US number, add +1
	if (!cleaned.startsWith('+')) {
		if (cleaned.length === 10) {
			cleaned = '+1' + cleaned;
		} else if (cleaned.length === 11 && cleaned.startsWith('1')) {
			cleaned = '+' + cleaned;
		} else {
			// Assume it needs a + prefix
			cleaned = '+' + cleaned;
		}
	}

	// Basic validation - E.164 should be 8-15 digits after +
	const digits = cleaned.slice(1);
	if (digits.length < 8 || digits.length > 15) {
		return null;
	}

	return cleaned;
}

/**
 * Create a manual contact entry (for testing/development).
 */
export function createManualContact(
	phoneNumber: string,
	aci?: string,
	name?: string,
): SignalContact {
	return {
		aci: aci || '',
		phoneNumber: normalizePhoneNumber(phoneNumber) || phoneNumber,
		name: name || phoneNumber,
	};
}
