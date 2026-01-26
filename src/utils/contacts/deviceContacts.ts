/**
 * Device Contacts Utility
 *
 * Provides functions for accessing device contacts with proper permissions handling.
 * Uses react-native-contacts for contact access and react-native-permissions
 * for permission management.
 */

import { Platform } from 'react-native';
import Contacts, { Contact } from 'react-native-contacts';
import { PERMISSIONS, RESULTS, check, request } from 'react-native-permissions';
import { formatE164 } from '../signal/cdsi';

export type PermissionStatus =
	| 'authorized'
	| 'denied'
	| 'blocked'
	| 'unavailable';

export interface DeviceContact {
	recordID: string;
	displayName: string;
	phoneNumbers: string[];
	rawContact: Contact;
}

/**
 * Request permission to access device contacts.
 *
 * @returns Permission status after requesting
 */
export async function requestContactsPermission(): Promise<PermissionStatus> {
	const permission =
		Platform.OS === 'ios'
			? PERMISSIONS.IOS.CONTACTS
			: PERMISSIONS.ANDROID.READ_CONTACTS;

	try {
		// First check current permission status
		const checkResponse = await check(permission);

		switch (checkResponse) {
			case RESULTS.UNAVAILABLE:
				console.log('Contacts: Permission unavailable on this device');
				return 'unavailable';

			case RESULTS.BLOCKED:
				console.log('Contacts: Permission blocked, user must enable in settings');
				return 'blocked';

			case RESULTS.DENIED: {
				console.log('Contacts: Permission denied, requesting...');
				const requestResponse = await request(permission);
				if (requestResponse === RESULTS.GRANTED) {
					console.log('Contacts: Permission granted');
					return 'authorized';
				}
				console.log('Contacts: Permission request denied');
				return 'denied';
			}

			case RESULTS.LIMITED:
			case RESULTS.GRANTED:
				console.log('Contacts: Permission already granted');
				return 'authorized';

			default:
				console.log('Contacts: Unknown permission status:', checkResponse);
				return 'denied';
		}
	} catch (error) {
		console.error('Contacts: Error requesting permission:', error);
		return 'denied';
	}
}

/**
 * Check if contacts permission is currently granted.
 *
 * @returns true if permission is granted, false otherwise
 */
export async function hasContactsPermission(): Promise<boolean> {
	const permission =
		Platform.OS === 'ios'
			? PERMISSIONS.IOS.CONTACTS
			: PERMISSIONS.ANDROID.READ_CONTACTS;

	try {
		const status = await check(permission);
		return status === RESULTS.GRANTED || status === RESULTS.LIMITED;
	} catch (error) {
		console.error('Contacts: Error checking permission:', error);
		return false;
	}
}

/**
 * Get all contacts from the device.
 *
 * @returns Array of device contacts with phone numbers
 */
export async function getDeviceContacts(): Promise<DeviceContact[]> {
	try {
		console.log('Contacts: Fetching device contacts...');
		const contacts = await Contacts.getAll();
		console.log('Contacts: Found', contacts.length, 'total contacts');

		// Filter and transform contacts that have phone numbers
		const contactsWithPhones: DeviceContact[] = contacts
			.filter((contact) => contact.phoneNumbers && contact.phoneNumbers.length > 0)
			.map((contact) => ({
				recordID: contact.recordID,
				displayName: getContactDisplayName(contact),
				phoneNumbers: contact.phoneNumbers.map((phone) => phone.number),
				rawContact: contact,
			}));

		console.log('Contacts:', contactsWithPhones.length, 'contacts with phone numbers');
		return contactsWithPhones;
	} catch (error) {
		console.error('Contacts: Error fetching contacts:', error);
		throw error;
	}
}

/**
 * Extract unique E.164 formatted phone numbers from device contacts.
 *
 * @param contacts Array of device contacts
 * @returns Array of unique phone numbers in E.164 format
 */
export function extractPhoneNumbers(contacts: DeviceContact[]): string[] {
	const phoneSet = new Set<string>();

	for (const contact of contacts) {
		for (const phoneNumber of contact.phoneNumbers) {
			try {
				const e164 = formatE164(phoneNumber);
				// Basic validation: must start with + and have at least 8 digits after
				if (e164.startsWith('+') && e164.length >= 9) {
					phoneSet.add(e164);
				}
			} catch (error) {
				console.log('Contacts: Invalid phone number:', phoneNumber);
			}
		}
	}

	const uniqueNumbers = Array.from(phoneSet);
	console.log('Contacts: Extracted', uniqueNumbers.length, 'unique E.164 numbers');
	return uniqueNumbers;
}

/**
 * Get a display name for a contact.
 *
 * @param contact The raw contact object
 * @returns Best available display name
 */
function getContactDisplayName(contact: Contact): string {
	// Try full name first
	if (contact.givenName || contact.familyName) {
		const parts = [contact.givenName, contact.middleName, contact.familyName]
			.filter(Boolean)
			.join(' ');
		if (parts) {
			return parts;
		}
	}

	// Fall back to display name
	if (contact.displayName) {
		return contact.displayName;
	}

	// Fall back to company
	if (contact.company) {
		return contact.company;
	}

	// Last resort: use first phone number
	if (contact.phoneNumbers && contact.phoneNumbers.length > 0) {
		return contact.phoneNumbers[0].number;
	}

	return 'Unknown Contact';
}

/**
 * Build a map from phone number to contact display name.
 * Useful for enriching discovered Signal contacts with names from device contacts.
 *
 * @param contacts Array of device contacts
 * @returns Map of E.164 phone number to display name
 */
export function buildPhoneToNameMap(
	contacts: DeviceContact[],
): Map<string, string> {
	const phoneToName = new Map<string, string>();

	for (const contact of contacts) {
		for (const phoneNumber of contact.phoneNumbers) {
			try {
				const e164 = formatE164(phoneNumber);
				if (e164.startsWith('+') && e164.length >= 9) {
					// Only set if not already present (prefer first contact found)
					if (!phoneToName.has(e164)) {
						phoneToName.set(e164, contact.displayName);
					}
				}
			} catch (error) {
				// Skip invalid numbers
			}
		}
	}

	return phoneToName;
}
