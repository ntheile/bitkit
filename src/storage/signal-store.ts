/**
 * Signal Protocol Storage Layer
 *
 * Implements persistent storage for Signal protocol state including:
 * - Identity keys (ACI and PNI)
 * - Session state
 * - PreKeys and Signed PreKeys
 * - Sender Keys for group messaging
 *
 * Uses react-native-keychain for sensitive identity keys and
 * react-native-mmkv for session/prekey data.
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as Keychain from 'react-native-keychain';
import { MMKV } from 'react-native-mmkv';

// Separate MMKV instance for Signal data
const signalStorage = new MMKV({ id: 'signal-protocol-store' });

// Keychain service identifiers
const KEYCHAIN_SERVICE = {
	ACI_IDENTITY_KEY: 'bitkit.signal.aci.identity',
	PNI_IDENTITY_KEY: 'bitkit.signal.pni.identity',
	PROFILE_KEY: 'bitkit.signal.profile',
	MASTER_KEY: 'bitkit.signal.master',
	AUTH_PASSWORD: 'bitkit.signal.password',
};

// MMKV key prefixes
const MMKV_KEYS = {
	ACCOUNT_INFO: 'signal:account',
	SESSION: 'signal:session:',
	PRE_KEY: 'signal:prekey:',
	SIGNED_PRE_KEY: 'signal:signedprekey:',
	SENDER_KEY: 'signal:senderkey:',
	KYBER_PRE_KEY: 'signal:kyberprekey:',
	REGISTRATION_ID: 'signal:registrationId',
	DEVICE_ID: 'signal:deviceId',
	LINKED_AT: 'signal:linkedAt',
};

/**
 * Account information stored after successful linking.
 */
export interface SignalAccountInfo {
	phoneNumber: string;
	aci: string; // Account Identity
	pni: string; // Phone Number Identity
	deviceId: number;
	registrationId: number;
	linkedAt: number; // Timestamp
	readReceipts?: boolean;
	password?: string; // Authentication password for API calls
}

/**
 * Store identity key pair in secure keychain.
 */
export async function storeIdentityKey(
	type: 'aci' | 'pni',
	publicKey: Uint8Array,
	privateKey: Uint8Array,
): Promise<void> {
	const service =
		type === 'aci'
			? KEYCHAIN_SERVICE.ACI_IDENTITY_KEY
			: KEYCHAIN_SERVICE.PNI_IDENTITY_KEY;

	// Combine public and private keys with length prefix
	const combined = new Uint8Array(4 + publicKey.length + privateKey.length);
	const view = new DataView(combined.buffer);
	view.setUint32(0, publicKey.length, true);
	combined.set(publicKey, 4);
	combined.set(privateKey, 4 + publicKey.length);

	const base64 = Buffer.from(combined).toString('base64');

	await Keychain.setGenericPassword(type, base64, {
		service,
		accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
	});
}

/**
 * Retrieve identity key pair from secure keychain.
 */
export async function getIdentityKey(
	type: 'aci' | 'pni',
): Promise<{ publicKey: Uint8Array; privateKey: Uint8Array } | null> {
	const service =
		type === 'aci'
			? KEYCHAIN_SERVICE.ACI_IDENTITY_KEY
			: KEYCHAIN_SERVICE.PNI_IDENTITY_KEY;

	try {
		const result = await Keychain.getGenericPassword({ service });

		if (!result || typeof result === 'boolean') {
			return null;
		}

		const combined = Uint8Array.from(Buffer.from(result.password, 'base64'));
		const view = new DataView(combined.buffer);
		const publicKeyLength = view.getUint32(0, true);

		const publicKey = combined.slice(4, 4 + publicKeyLength);
		const privateKey = combined.slice(4 + publicKeyLength);

		return { publicKey, privateKey };
	} catch (error) {
		console.error('SignalStore: Error getting identity key:', error);
		return null;
	}
}

/**
 * Store profile key in secure keychain.
 */
export async function storeProfileKey(profileKey: Uint8Array): Promise<void> {
	const base64 = Buffer.from(profileKey).toString('base64');

	await Keychain.setGenericPassword('profile', base64, {
		service: KEYCHAIN_SERVICE.PROFILE_KEY,
		accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
	});
}

/**
 * Retrieve profile key from secure keychain.
 */
export async function getProfileKey(): Promise<Uint8Array | null> {
	try {
		const result = await Keychain.getGenericPassword({
			service: KEYCHAIN_SERVICE.PROFILE_KEY,
		});

		if (!result || typeof result === 'boolean') {
			return null;
		}

		return Uint8Array.from(Buffer.from(result.password, 'base64'));
	} catch (error) {
		console.error('SignalStore: Error getting profile key:', error);
		return null;
	}
}

/**
 * Store master key in secure keychain.
 */
export async function storeMasterKey(masterKey: Uint8Array): Promise<void> {
	const base64 = Buffer.from(masterKey).toString('base64');

	await Keychain.setGenericPassword('master', base64, {
		service: KEYCHAIN_SERVICE.MASTER_KEY,
		accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
	});
}

/**
 * Retrieve master key from secure keychain.
 */
export async function getMasterKey(): Promise<Uint8Array | null> {
	try {
		const result = await Keychain.getGenericPassword({
			service: KEYCHAIN_SERVICE.MASTER_KEY,
		});

		if (!result || typeof result === 'boolean') {
			return null;
		}

		return Uint8Array.from(Buffer.from(result.password, 'base64'));
	} catch (error) {
		console.error('SignalStore: Error getting master key:', error);
		return null;
	}
}

/**
 * Store authentication password in secure keychain.
 * This password is used for API calls to Signal servers.
 */
export async function storeAuthPassword(password: string): Promise<void> {
	await Keychain.setGenericPassword('password', password, {
		service: KEYCHAIN_SERVICE.AUTH_PASSWORD,
		accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
	});
}

/**
 * Retrieve authentication password from secure keychain.
 */
export async function getAuthPassword(): Promise<string | null> {
	try {
		const result = await Keychain.getGenericPassword({
			service: KEYCHAIN_SERVICE.AUTH_PASSWORD,
		});

		if (!result || typeof result === 'boolean') {
			return null;
		}

		return result.password;
	} catch (error) {
		console.error('SignalStore: Error getting auth password:', error);
		return null;
	}
}

/**
 * Store account information after successful linking.
 */
export function storeAccountInfo(accountInfo: SignalAccountInfo): void {
	signalStorage.set(MMKV_KEYS.ACCOUNT_INFO, JSON.stringify(accountInfo));
	signalStorage.set(MMKV_KEYS.REGISTRATION_ID, accountInfo.registrationId);
	signalStorage.set(MMKV_KEYS.DEVICE_ID, accountInfo.deviceId);
	signalStorage.set(MMKV_KEYS.LINKED_AT, accountInfo.linkedAt);
}

/**
 * Retrieve account information.
 */
export function getAccountInfo(): SignalAccountInfo | null {
	const json = signalStorage.getString(MMKV_KEYS.ACCOUNT_INFO);
	if (!json) return null;

	try {
		return JSON.parse(json) as SignalAccountInfo;
	} catch {
		return null;
	}
}

/**
 * Check if Signal account is linked.
 */
export function isSignalLinked(): boolean {
	return signalStorage.contains(MMKV_KEYS.ACCOUNT_INFO);
}

/**
 * Get registration ID.
 */
export function getRegistrationId(): number | null {
	if (!signalStorage.contains(MMKV_KEYS.REGISTRATION_ID)) return null;
	return signalStorage.getNumber(MMKV_KEYS.REGISTRATION_ID) ?? null;
}

/**
 * Get device ID.
 */
export function getDeviceId(): number | null {
	if (!signalStorage.contains(MMKV_KEYS.DEVICE_ID)) return null;
	return signalStorage.getNumber(MMKV_KEYS.DEVICE_ID) ?? null;
}

// ============================================================================
// Session Storage
// ============================================================================

/**
 * Store session data for a recipient.
 * @param address - Protocol address (e.g., "uuid.deviceId")
 * @param sessionData - Serialized session record
 */
export function storeSession(address: string, sessionData: Uint8Array): void {
	const key = MMKV_KEYS.SESSION + address;
	signalStorage.set(key, Buffer.from(sessionData).toString('base64'));
}

/**
 * Retrieve session data for a recipient.
 */
export function getSession(address: string): Uint8Array | null {
	const key = MMKV_KEYS.SESSION + address;
	const base64 = signalStorage.getString(key);
	if (!base64) return null;
	return Uint8Array.from(Buffer.from(base64, 'base64'));
}

/**
 * Delete session for a recipient.
 */
export function deleteSession(address: string): void {
	const key = MMKV_KEYS.SESSION + address;
	signalStorage.delete(key);
}

/**
 * Get all session addresses.
 */
export function getAllSessionAddresses(): string[] {
	const allKeys = signalStorage.getAllKeys();
	const prefix = MMKV_KEYS.SESSION;
	return allKeys
		.filter((key) => key.startsWith(prefix))
		.map((key) => key.slice(prefix.length));
}

// ============================================================================
// PreKey Storage
// ============================================================================

/**
 * Store a PreKey.
 */
export function storePreKey(keyId: number, preKeyData: Uint8Array): void {
	const key = MMKV_KEYS.PRE_KEY + keyId;
	signalStorage.set(key, Buffer.from(preKeyData).toString('base64'));
}

/**
 * Retrieve a PreKey.
 */
export function getPreKey(keyId: number): Uint8Array | null {
	const key = MMKV_KEYS.PRE_KEY + keyId;
	const base64 = signalStorage.getString(key);
	if (!base64) return null;
	return Uint8Array.from(Buffer.from(base64, 'base64'));
}

/**
 * Delete a PreKey (after use).
 */
export function deletePreKey(keyId: number): void {
	const key = MMKV_KEYS.PRE_KEY + keyId;
	signalStorage.delete(key);
}

// ============================================================================
// Signed PreKey Storage
// ============================================================================

/**
 * Store a Signed PreKey.
 */
export function storeSignedPreKey(
	keyId: number,
	signedPreKeyData: Uint8Array,
): void {
	const key = MMKV_KEYS.SIGNED_PRE_KEY + keyId;
	signalStorage.set(key, Buffer.from(signedPreKeyData).toString('base64'));
}

/**
 * Retrieve a Signed PreKey.
 */
export function getSignedPreKey(keyId: number): Uint8Array | null {
	const key = MMKV_KEYS.SIGNED_PRE_KEY + keyId;
	const base64 = signalStorage.getString(key);
	if (!base64) return null;
	return Uint8Array.from(Buffer.from(base64, 'base64'));
}

// ============================================================================
// Sender Key Storage (for group messaging)
// ============================================================================

/**
 * Store a Sender Key.
 * @param groupId - Group identifier
 * @param senderAddress - Sender's protocol address
 * @param senderKeyData - Serialized sender key
 */
export function storeSenderKey(
	groupId: string,
	senderAddress: string,
	senderKeyData: Uint8Array,
): void {
	const key = `${MMKV_KEYS.SENDER_KEY}${groupId}:${senderAddress}`;
	signalStorage.set(key, Buffer.from(senderKeyData).toString('base64'));
}

/**
 * Retrieve a Sender Key.
 */
export function getSenderKey(
	groupId: string,
	senderAddress: string,
): Uint8Array | null {
	const key = `${MMKV_KEYS.SENDER_KEY}${groupId}:${senderAddress}`;
	const base64 = signalStorage.getString(key);
	if (!base64) return null;
	return Uint8Array.from(Buffer.from(base64, 'base64'));
}

// ============================================================================
// Cleanup
// ============================================================================

/**
 * Clear all Signal-related data (for unlinking).
 */
export async function clearSignalData(): Promise<void> {
	// Clear MMKV data
	signalStorage.clearAll();

	// Clear Keychain data
	try {
		await Keychain.resetGenericPassword({
			service: KEYCHAIN_SERVICE.ACI_IDENTITY_KEY,
		});
		await Keychain.resetGenericPassword({
			service: KEYCHAIN_SERVICE.PNI_IDENTITY_KEY,
		});
		await Keychain.resetGenericPassword({
			service: KEYCHAIN_SERVICE.PROFILE_KEY,
		});
		await Keychain.resetGenericPassword({
			service: KEYCHAIN_SERVICE.MASTER_KEY,
		});
	} catch (error) {
		console.error('SignalStore: Error clearing keychain data:', error);
	}

	console.log('SignalStore: All Signal data cleared');
}

export { signalStorage };
