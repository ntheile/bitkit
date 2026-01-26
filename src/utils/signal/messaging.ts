/**
 * Signal Direct Messaging
 *
 * Handles sending and receiving encrypted messages through Signal protocol.
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
	PrivateKey,
	PublicKey,
	KEMPublicKey,
	createAndProcessPreKeyBundle,
	signalEncrypt,
	SessionStore,
	IdentityKeyStore,
	SessionRecord,
	Direction,
	ProtocolAddress,
} from 'react-native-libsignal-client';
import * as protobuf from 'protobufjs';
import { getAccountInfo, getIdentityKey, getAuthPassword, storeSession, getSession, getAllSessionAddresses, deleteSession as deleteStoredSession, getProfileKey } from '../../storage/signal-store';
import type { SignalContact } from './contacts';

// Helper to convert base64 to Uint8Array
function base64ToUint8Array(base64: string): Uint8Array {
	const buffer = Buffer.from(base64, 'base64');
	return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

const SIGNAL_SERVER = 'https://chat.signal.org';

// Define Signal protobuf schema for Content and DataMessage
const protoRoot = new protobuf.Root();

// DataMessage - the main message payload
// Based on Signal's SignalService.proto
// Minimal fields for a simple text message:
//   body = 1 (string) - The message text
//   profileKey = 6 (bytes) - 32-byte profile encryption key
// Note: timestamp is in the envelope, not DataMessage
protoRoot.define('signalservice').add(
	new protobuf.Type('DataMessage')
		.add(new protobuf.Field('body', 1, 'string'))
		.add(new protobuf.Field('profileKey', 6, 'bytes'))
);

// Content - wrapper that contains DataMessage
protoRoot.define('signalservice').add(
	new protobuf.Type('Content')
		.add(new protobuf.Field('dataMessage', 1, 'signalservice.DataMessage'))
);

const DataMessage = protoRoot.lookupType('signalservice.DataMessage');
const Content = protoRoot.lookupType('signalservice.Content');

// In-memory session cache (would use MMKV in production)
const sessionCache = new Map<string, SessionRecord>();

// Registration ID cache - stores registrationId for each device
const registrationIdCache = new Map<string, number>();

// PreKey bundle cache with expiry (avoids repeated fetches)
const preKeyBundleCache = new Map<string, { bundle: any; fetchedAt: number; devices: number[] }>();
const PREKEY_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const PREKEY_RATE_LIMIT_DELAY = 60 * 1000; // 1 minute backoff after 429
let lastPreKeyFetchTime = 0;
let rateLimitedUntil = 0;

/**
 * Get cached registrationId for a device.
 */
function getRegistrationId(aci: string, deviceId: number): number | null {
	return registrationIdCache.get(`${aci}.${deviceId}`) || null;
}

/**
 * Store registrationId for a device.
 */
function setRegistrationId(aci: string, deviceId: number, regId: number): void {
	registrationIdCache.set(`${aci}.${deviceId}`, regId);
}

/**
 * Clear a session from cache and storage.
 */
function clearSession(aci: string, deviceId: number): void {
	const key = `${aci}.${deviceId}`;
	sessionCache.delete(key);
	registrationIdCache.delete(key);
	// Also clear from MMKV storage
	try {
		deleteStoredSession(key);
	} catch (e) {
		console.log('Signal DM: Error deleting session from storage:', e);
	}
	console.log('Signal DM: Cleared session for', key);
}

/**
 * Map libsignal ciphertext type to Signal API envelope type.
 * 
 * react-native-libsignal-client CiphertextMessageType:
 *   2 = SignalMessage (Whisper, established session)
 *   3 = PreKeySignalMessage (initial key exchange)
 * 
 * Signal API Envelope.Type:
 *   1 = CIPHERTEXT (normal encrypted message, Whisper)
 *   3 = PREKEY_BUNDLE (initial key exchange)
 *   5 = UNIDENTIFIED_SENDER
 *   6 = PLAINTEXT_CONTENT
 * 
 * NOTE: Testing showed type 1 triggers "Chat session refreshed" on recipients,
 * so the messages ARE being processed. The issue is content encoding.
 */
function mapCiphertextTypeToApiType(libsignalType: number): number {
	switch (libsignalType) {
		case 2: // SignalMessage (Whisper) -> CIPHERTEXT
			return 1;
		case 3: // PreKeySignalMessage -> PREKEY_BUNDLE
			return 3;
		default:
			console.warn('Signal DM: Unknown ciphertext type:', libsignalType, ', defaulting to PREKEY_BUNDLE (3)');
			return 3;
	}
}

/**
 * Check if we have an existing session for a device.
 */
async function hasSession(aci: string, deviceId: number): Promise<boolean> {
	const key = `${aci}.${deviceId}`;
	if (sessionCache.has(key)) return true;
	const stored = getSession(key);
	return stored !== null;
}

/**
 * Get all device IDs we have sessions for (from both cache and MMKV).
 */
function getSessionDeviceIds(aci: string): number[] {
	const deviceIds = new Set<number>();
	
	// Check in-memory cache
	for (const key of sessionCache.keys()) {
		if (key.startsWith(`${aci}.`)) {
			const deviceId = parseInt(key.split('.')[1], 10);
			if (!isNaN(deviceId)) {
				deviceIds.add(deviceId);
			}
		}
	}
	
	// Also check MMKV storage for persisted sessions
	try {
		const allAddresses = getAllSessionAddresses();
		for (const addr of allAddresses) {
			if (addr.startsWith(`${aci}.`)) {
				const parts = addr.split('.');
				const deviceId = parseInt(parts[parts.length - 1], 10);
				if (!isNaN(deviceId)) {
					deviceIds.add(deviceId);
				}
			}
		}
	} catch (e) {
		console.log('Signal DM: Error getting session addresses from storage:', e);
	}
	
	const result = Array.from(deviceIds);
	console.log('Signal DM: Found sessions for devices:', result);
	return result;
}

/**
 * Simple in-memory session store implementation.
 */
class InMemorySessionStore extends SessionStore {
	async saveSession(name: ProtocolAddress, record: SessionRecord): Promise<void> {
		const key = `${name.name}.${name.deviceId}`;
		sessionCache.set(key, record);
		// Also persist to MMKV
		storeSession(key, record.serialized);
	}

	async getSession(name: ProtocolAddress): Promise<SessionRecord | null> {
		const key = `${name.name}.${name.deviceId}`;
		const cached = sessionCache.get(key);
		if (cached) return cached;
		
		// Try loading from MMKV
		const stored = getSession(key);
		if (stored) {
			const record = SessionRecord._fromSerialized(stored);
			sessionCache.set(key, record);
			return record;
		}
		return null;
	}

	async getExistingSessions(addresses: ProtocolAddress[]): Promise<SessionRecord[]> {
		const results: SessionRecord[] = [];
		for (const addr of addresses) {
			const session = await this.getSession(addr);
			if (session) results.push(session);
		}
		return results;
	}
}

/**
 * Simple identity key store implementation.
 */
class InMemoryIdentityStore extends IdentityKeyStore {
	private identityKeys = new Map<string, PublicKey>();
	private ourIdentityKey: { publicKey: PublicKey; privateKey: PrivateKey } | null = null;

	async setOurIdentity(publicKey: PublicKey, privateKey: PrivateKey): Promise<void> {
		this.ourIdentityKey = { publicKey, privateKey };
	}

	async getIdentityKey(): Promise<PrivateKey> {
		if (!this.ourIdentityKey) {
			throw new Error('Identity key not set');
		}
		return this.ourIdentityKey.privateKey;
	}

	async getLocalRegistrationId(): Promise<number> {
		const accountInfo = getAccountInfo();
		return accountInfo?.registrationId || 1;
	}

	async saveIdentity(name: ProtocolAddress, key: PublicKey): Promise<boolean> {
		const existing = this.identityKeys.get(name.name);
		this.identityKeys.set(name.name, key);
		// Return true if the key changed (first time or different key)
		if (!existing) return true;
		// Compare serialized keys
		const existingBytes = existing.serialized;
		const newBytes = key.serialized;
		if (existingBytes.length !== newBytes.length) return true;
		for (let i = 0; i < existingBytes.length; i++) {
			if (existingBytes[i] !== newBytes[i]) return true;
		}
		return false;
	}

	async isTrustedIdentity(
		name: ProtocolAddress,
		key: PublicKey,
		_direction: Direction,
	): Promise<boolean> {
		// For simplicity, trust all identities (TOFU - Trust On First Use)
		// A real implementation would check against stored identities
		return true;
	}

	async getIdentity(name: ProtocolAddress): Promise<PublicKey | null> {
		return this.identityKeys.get(name.name) || null;
	}
}

// Global stores
const sessionStore = new InMemorySessionStore();
const identityStore = new InMemoryIdentityStore();

export interface Message {
	id: string;
	content: string;
	timestamp: number;
	sent: boolean;
	recipientAci?: string;
	senderAci?: string;
	delivered?: boolean;
	read?: boolean;
}

export interface SendResult {
	success: boolean;
	messageId?: string;
	timestamp?: number;
	error?: string;
	captchaRequired?: {
		challengeToken: string;
		options: string[];
	};
}

/**
 * Submit captcha solution to Signal server.
 * Must be called before retrying a message after 428.
 */
export async function submitCaptchaSolution(
	challengeToken: string,
	captchaToken: string,
): Promise<{ success: boolean; error?: string }> {
	const accountInfo = getAccountInfo();
	if (!accountInfo) {
		return { success: false, error: 'No account info' };
	}

	const password = await getAuthPassword();
	if (!password) {
		return { success: false, error: 'No auth password' };
	}

	const credentials = `${accountInfo.aci}.${accountInfo.deviceId}:${password}`;
	const authHeader = `Basic ${Buffer.from(credentials).toString('base64')}`;

	console.log('Signal Captcha: Submitting solution to /v1/challenge');
	console.log('Signal Captcha: Challenge token:', challengeToken);
	console.log('Signal Captcha: Captcha token:', captchaToken.slice(0, 50) + '...');

	try {
		const response = await fetch(`${SIGNAL_SERVER}/v1/challenge`, {
			method: 'PUT',
			headers: {
				'Authorization': authHeader,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				type: 'captcha',
				token: challengeToken,
				captcha: captchaToken,
			}),
		});

		console.log('Signal Captcha: Challenge response:', response.status);

		if (response.ok) {
			console.log('Signal Captcha: Challenge accepted!');
			return { success: true };
		} else {
			const errorText = await response.text();
			console.log('Signal Captcha: Challenge failed:', errorText);
			return { success: false, error: `${response.status}: ${errorText}` };
		}
	} catch (error) {
		console.error('Signal Captcha: Error submitting challenge:', error);
		return { success: false, error: error instanceof Error ? error.message : 'Network error' };
	}
}

export interface Conversation {
	contactAci: string;
	contact: SignalContact;
	messages: Message[];
	lastMessageAt: number;
}

/**
 * Clear ALL sessions for a recipient (all devices).
 * Call this when you get stale device errors or want to force fresh key exchange.
 */
export function clearAllSessions(aci: string): void {
	// Clear from cache - find all keys that start with this ACI
	let count = 0;
	for (const key of sessionCache.keys()) {
		if (key.startsWith(`${aci}.`)) {
			sessionCache.delete(key);
			count++;
			console.log('Signal DM: Cleared session for', key);
		}
	}
	console.log(`Signal DM: Cleared ${count} sessions for ${aci}`);
}

/**
 * Clear all cached sessions. Use when sessions get stale after timeout.
 */
export function clearAllCachedSessions(): void {
	const count = sessionCache.size;
	sessionCache.clear();
	console.log(`Signal DM: Cleared all ${count} cached sessions`);
}

/**
 * Clear ALL sessions from both cache AND MMKV storage.
 */
export function clearAllStoredSessions(): void {
	// Clear in-memory
	sessionCache.clear();
	
	// Clear from MMKV
	try {
		const addresses = getAllSessionAddresses();
		for (const addr of addresses) {
			deleteStoredSession(addr);
		}
		console.log(`Signal DM: Cleared ${addresses.length} sessions from storage`);
	} catch (e) {
		console.log('Signal DM: Error clearing stored sessions:', e);
	}
}

/**
 * Get the remaining rate limit time in seconds, or 0 if not rate limited.
 */
export function getRateLimitRemaining(): number {
	const remaining = rateLimitedUntil - Date.now();
	return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

/**
 * Debug: List all stored sessions.
 */
export function listAllSessions(): string[] {
	const sessions: string[] = [];
	
	// From in-memory cache
	for (const key of sessionCache.keys()) {
		sessions.push(`cache:${key}`);
	}
	
	// From MMKV storage
	try {
		const addresses = getAllSessionAddresses();
		for (const addr of addresses) {
			if (!sessions.includes(`cache:${addr}`)) {
				sessions.push(`storage:${addr}`);
			}
		}
	} catch (e) {
		console.log('Error listing sessions:', e);
	}
	
	console.log('Signal DM: All sessions:', sessions);
	return sessions;
}

/**
 * Debug: Reset rate limit (for testing).
 */
export function resetRateLimit(): void {
	rateLimitedUntil = 0;
	console.log('Signal DM: Rate limit reset');
}

/**
 * Clear the PreKey bundle cache for a specific ACI or all ACIs.
 */
export function clearPreKeyCache(aci?: string): void {
	if (aci) {
		preKeyBundleCache.delete(aci);
		console.log('Signal DM: Cleared PreKey cache for', aci);
	} else {
		preKeyBundleCache.clear();
		console.log('Signal DM: Cleared all PreKey cache');
	}
}

/**
 * Send a text message to a Signal contact.
 *
 * Flow:
 * 1. Fetch recipient's PreKey bundle from server
 * 2. Build Signal session using createAndProcessPreKeyBundle
 * 3. Encrypt message using signalEncrypt
 * 4. Send to Signal server via PUT /v1/messages/{destination}
 *
 * Note: When sending to self, we exclude our own device (can't send to yourself).
 * Note: If you get a 428 captcha challenge, call submitCaptchaSolution() first, then retry.
 */
export async function sendMessage(
	recipient: SignalContact,
	content: string,
	_retryCount: number = 0, // Internal retry counter
): Promise<SendResult> {
	const accountInfo = getAccountInfo();
	if (!accountInfo) {
		return {
			success: false,
			error: 'Signal account not linked',
		};
	}

	// Use ACI if available, otherwise fall back to PNI
	const recipientId = recipient.aci || recipient.pni;
	if (!recipientId) {
		return {
			success: false,
			error: 'Recipient ACI or PNI not available. Need to discover contact first.',
		};
	}

	const usingPni = !recipient.aci && !!recipient.pni;
	if (usingPni) {
		console.log('Signal DM: Using PNI for messaging (no ACI available)');
	}

	// Check if sending to self
	const isSendingToSelf = recipient.aci === accountInfo.aci;
	const ourDeviceId = accountInfo.deviceId;

	console.log('Signal DM: Sending message to', recipientId);
	console.log('Signal DM: Content:', content.slice(0, 50) + '...');
	if (isSendingToSelf) {
		console.log('Signal DM: Sending to SELF - will exclude device', ourDeviceId);
	}

	try {
		// Get our identity key
		const identityKeyData = await getIdentityKey('aci');
		if (!identityKeyData) {
			return {
				success: false,
				error: 'Identity key not found',
			};
		}

		// Initialize our identity in the store
		const ourPrivateKey = PrivateKey._fromSerialized(identityKeyData.privateKey);
		const ourPublicKey = ourPrivateKey.getPublicKey();
		await identityStore.setOurIdentity(ourPublicKey, ourPrivateKey);

		// Get our profile key for including in messages
		const profileKey = await getProfileKey();

		const timestamp = Date.now();
		const messages: Array<{ destinationDeviceId: number; destinationRegistrationId: number; content: string; type: number }> = [];

		// Try to use existing sessions first (avoid rate limiting)
		// Skip if this is a retry after stale devices
		const useExistingSessions = _retryCount === 0;
		
		if (useExistingSessions) {
			// Get all device IDs we have sessions for
			const sessionDeviceIds = getSessionDeviceIds(recipientId);
			
			// Filter out our own device if sending to self
			const targetDeviceIds = isSendingToSelf 
				? sessionDeviceIds.filter(id => id !== ourDeviceId)
				: sessionDeviceIds;
			
			if (targetDeviceIds.length > 0) {
				console.log('Signal DM: Using existing sessions for devices:', targetDeviceIds);
				
				for (const deviceId of targetDeviceIds) {
					try {
						// Need registrationId for sending - if we don't have it cached, skip this device
						const regId = getRegistrationId(recipientId, deviceId);
						if (!regId) {
							console.log('Signal DM: No cached registrationId for device', deviceId, '- need fresh PreKey');
							clearSession(recipientId, deviceId);
							continue;
						}

						const address = new ProtocolAddress(recipientId, deviceId);
						const contentMessage = createContentMessage(content, timestamp, profileKey || undefined);
						const ciphertext = await signalEncrypt(
							contentMessage,
							address,
							sessionStore,
							identityStore,
						);

						const libsignalType = ciphertext.type();
						const apiType = mapCiphertextTypeToApiType(libsignalType);
						
						messages.push({
							destinationDeviceId: deviceId,
							destinationRegistrationId: regId,
							content: Buffer.from(ciphertext.serialized).toString('base64'),
							type: apiType,
						});
						console.log('Signal DM: Encrypted with existing session for device', deviceId, 'libsignal type:', libsignalType, '-> API type:', apiType);
					} catch (sessionError) {
						console.log('Signal DM: Session failed for device', deviceId, '- will need fresh PreKey');
						clearSession(recipientId, deviceId);
					}
				}
			}
		}

		// If we don't have messages yet, fetch PreKeys and establish new sessions
		if (messages.length === 0) {
			console.log('Signal DM: Fetching PreKey bundle...');
			
			// Step 1: Fetch PreKey bundle
			// When sending to self, pass our device ID to exclude from rate-limited fallback
			const preKeyBundle = await fetchPreKeyBundle(recipientId, isSendingToSelf ? ourDeviceId : undefined);
			if (!preKeyBundle) {
				// Check if we're rate limited
				if (rateLimitedUntil > Date.now()) {
					const waitSeconds = Math.ceil((rateLimitedUntil - Date.now()) / 1000);
					return {
						success: false,
						error: `Rate limited by Signal. Please wait ${waitSeconds} seconds and try again.`,
					};
				}
				return {
					success: false,
					error: 'Could not fetch recipient keys. They may not be on Signal or you may be rate limited.',
				};
			}

			console.log('Signal DM: PreKey bundle received, establishing session...');

			// Step 2: Process PreKey bundle and establish session
			// The bundle contains keys for each device
			let devices = preKeyBundle.devices || [preKeyBundle];
			
			// Log what devices we got
			const deviceIds = devices.map((d: any) => d.deviceId || 1);
			console.log('Signal DM: PreKey bundle contains devices:', deviceIds);
			
			// Filter out our own device when sending to self
			if (isSendingToSelf) {
				const beforeCount = devices.length;
				devices = devices.filter((d: any) => (d.deviceId || 1) !== ourDeviceId);
				console.log(`Signal DM: Filtered devices for self-send: ${beforeCount} -> ${devices.length} (excluded device ${ourDeviceId})`);
				
				if (devices.length === 0) {
					return {
						success: false,
						error: 'No other devices to send to. You need at least one other Signal device linked to your account.',
					};
				}
			}

		for (const device of devices) {
			try {
				const deviceId = device.deviceId || 1;
				const address = new ProtocolAddress(recipientId, deviceId);

				console.log(`Signal DM: Processing device ${deviceId}`, {
					hasPreKey: !!device.preKey,
					hasSignedPreKey: !!device.signedPreKey,
					hasPqPreKey: !!device.pqPreKey,
					registrationId: device.registrationId,
				});

				// Skip devices without required keys
				if (!device.signedPreKey) {
					console.log(`Signal DM: Device ${deviceId} has no signedPreKey, skipping`);
					continue;
				}

				// Parse the pre-key bundle components
				const registrationId = device.registrationId;
				
				// One-time prekey is optional - if not present, use null/0
				// Signal protocol allows session establishment with just signed prekey
				const hasPreKey = device.preKey && device.preKey.publicKey;
				const preKeyId = hasPreKey ? device.preKey.keyId : 0;
				let preKeyPublic: PublicKey | null = null;
				if (hasPreKey) {
					preKeyPublic = PublicKey._fromSerialized(base64ToUint8Array(device.preKey.publicKey));
				}

				const signedPreKeyId = device.signedPreKey.keyId;
				const signedPreKeyPublic = PublicKey._fromSerialized(
					base64ToUint8Array(device.signedPreKey.publicKey)
				);
				const signedPreKeySignature = base64ToUint8Array(device.signedPreKey.signature);

				const identityKey = PublicKey._fromSerialized(
					base64ToUint8Array(preKeyBundle.identityKey)
				);

				// Process Kyber key if present
				let kyberData: { kyber_prekey_id: number; kyber_prekey: KEMPublicKey; kyber_prekey_signature: Uint8Array } | null = null;
				if (device.pqPreKey) {
					kyberData = {
						kyber_prekey_id: device.pqPreKey.keyId,
						kyber_prekey: KEMPublicKey._fromSerialized(base64ToUint8Array(device.pqPreKey.publicKey)),
						kyber_prekey_signature: base64ToUint8Array(device.pqPreKey.signature),
					};
				}

				// Create and process the PreKey bundle to establish a session
				// Note: If no one-time prekey, we need to pass a placeholder
				// The library requires a non-null prekey, so we'll generate a dummy if needed
				if (!preKeyPublic) {
					// Generate a temporary key pair just to satisfy the API
					// This won't actually be used in the protocol since preKeyId is 0
					const tempKey = PrivateKey.generate();
					preKeyPublic = tempKey.getPublicKey();
					console.log(`Signal DM: Device ${deviceId} has no one-time prekey, using placeholder`);
				}

				await createAndProcessPreKeyBundle(
					registrationId,
					address,
					preKeyId,
					preKeyPublic,
					signedPreKeyId,
					signedPreKeyPublic,
					signedPreKeySignature,
					identityKey,
					sessionStore,
					identityStore,
					kyberData,
				);

				// Cache the registrationId for future use
				setRegistrationId(recipientId, deviceId, registrationId);

				console.log('Signal DM: Session established with device', deviceId);

				// Step 3: Encrypt the message
				const contentMessage = createContentMessage(content, timestamp, profileKey || undefined);
				const ciphertext = await signalEncrypt(
					contentMessage,
					address,
					sessionStore,
					identityStore,
				);

				console.log('Signal DM: Message encrypted for device', deviceId);

				// Map libsignal type to Signal API type
				const libsignalType = ciphertext.type();
				const apiType = mapCiphertextTypeToApiType(libsignalType);
				console.log('Signal DM: Type mapping - libsignal:', libsignalType, '-> API:', apiType);

				// Add to messages array for this device
				messages.push({
					destinationDeviceId: deviceId,
					destinationRegistrationId: registrationId,
					content: Buffer.from(ciphertext.serialized).toString('base64'),
					type: apiType,
				});
			} catch (deviceError) {
				console.error('Signal DM: Error processing device', device.deviceId || 1, ':', deviceError);
				// Continue with other devices
			}
			}
		} // End of PreKey fetch block

		if (messages.length === 0) {
			return {
				success: false,
				error: 'Could not encrypt message for any device',
			};
		}

		// Step 4: Send to Signal server
		const sendResult = await sendToServer(recipientId, messages, timestamp);
		
		// Handle 410 stale devices - remove stale devices and retry with remaining
		if (sendResult.staleDevices && sendResult.staleDevices.length > 0) {
			console.log('Signal DM: Stale devices detected:', sendResult.staleDevices);
			
			// Filter out stale devices from our messages
			const nonStaleMessages = messages.filter(
				m => !sendResult.staleDevices!.includes(m.destinationDeviceId)
			);
			
			console.log(`Signal DM: Filtering out stale devices. ${messages.length} -> ${nonStaleMessages.length} messages`);
			
			if (nonStaleMessages.length === 0) {
				// All devices were stale - need to refresh the device list
				if (_retryCount >= 1) {
					console.log('Signal DM: Already retried, no valid devices found');
					return {
						success: false,
						error: `All devices stale (${sendResult.staleDevices.join(', ')}). Your linked devices may have been unlinked from Signal.`,
					};
				}
				
				// Clear sessions and PreKey cache to force a fresh fetch
				clearAllSessions(recipientId);
				clearPreKeyCache(recipientId);
				
				console.log('Signal DM: All devices stale. Cleared cache, retrying...');
				return sendMessage(recipient, content, _retryCount + 1);
			}
			
			// Clear sessions for stale devices
			for (const deviceId of sendResult.staleDevices) {
				clearSession(recipientId, deviceId);
			}
			
			// Retry sending with only non-stale messages
			console.log('Signal DM: Retrying with non-stale devices:', nonStaleMessages.map(m => m.destinationDeviceId));
			const retryResult = await sendToServer(recipientId, nonStaleMessages, timestamp);
			
			if (retryResult.success) {
				return {
					success: true,
					messageId: `msg_${timestamp}_${Math.random().toString(36).slice(2)}`,
					timestamp,
				};
			} else {
				return {
					success: false,
					error: retryResult.error || 'Failed to send after removing stale devices',
				};
			}
		}
		
		// Handle 428 captcha challenge
		if (sendResult.captchaRequired) {
			return {
				success: false,
				error: 'Captcha required',
				captchaRequired: sendResult.captchaRequired,
			};
		}

		if (sendResult.success) {
			return {
				success: true,
				messageId: `msg_${timestamp}_${Math.random().toString(36).slice(2)}`,
				timestamp,
			};
		} else {
			return {
				success: false,
				error: sendResult.error || 'Failed to send message',
			};
		}
	} catch (error) {
		console.error('Signal DM: Error sending message:', error);
		return {
			success: false,
			error: error instanceof Error ? error.message : 'Unknown error',
		};
	}
}

/**
 * Send encrypted messages to Signal server.
 * Returns staleDevices array if server returns 410.
 * Returns captchaRequired if server returns 428.
 */
async function sendToServer(
	recipientAci: string,
	messages: Array<{ destinationDeviceId: number; destinationRegistrationId: number; content: string; type: number }>,
	timestamp: number,
): Promise<{ success: boolean; error?: string; staleDevices?: number[]; captchaRequired?: { challengeToken: string; options: string[] } }> {
	const accountInfo = getAccountInfo();
	if (!accountInfo) {
		return { success: false, error: 'No account info' };
	}

	const password = await getAuthPassword();
	if (!password) {
		return { success: false, error: 'No auth password' };
	}

	const credentials = `${accountInfo.aci}.${accountInfo.deviceId}:${password}`;
	const authHeader = `Basic ${Buffer.from(credentials).toString('base64')}`;

	// Signal's message send format
	const requestBody = {
		messages: messages.map(m => ({
			type: m.type, // API types: 1=CIPHERTEXT (existing session), 3=PREKEY_BUNDLE (new session)
			destinationDeviceId: m.destinationDeviceId,
			destinationRegistrationId: m.destinationRegistrationId,
			content: m.content,
		})),
		timestamp,
		online: false,
	};

	console.log('Signal DM: Sending to server...');
	console.log('Signal DM: Endpoint:', `${SIGNAL_SERVER}/v1/messages/${recipientAci}`);

	try {
		const response = await fetch(`${SIGNAL_SERVER}/v1/messages/${recipientAci}`, {
			method: 'PUT',
			headers: {
				'Authorization': authHeader,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(requestBody),
		});

		console.log('Signal DM: Send response:', response.status);

		if (response.ok) {
			console.log('Signal DM: Message sent successfully!');
			return { success: true };
		} else {
			const errorText = await response.text();
			console.log('Signal DM: Send failed:', response.status, errorText);
			
			// Handle 428 captcha challenge
			if (response.status === 428) {
				try {
					const errorData = JSON.parse(errorText);
					if (errorData.token && errorData.options) {
						console.log('Signal DM: Captcha challenge required, token:', errorData.token);
						console.log('Signal DM: Options:', errorData.options);
						return {
							success: false,
							error: 'Captcha required',
							captchaRequired: {
								challengeToken: errorData.token,
								options: errorData.options,
							},
						};
					}
				} catch (e) {
					console.log('Signal DM: Could not parse 428 response');
				}
				return { success: false, error: 'Captcha required but could not parse challenge' };
			}

			// Handle 410 stale devices
			if (response.status === 410) {
				try {
					const errorData = JSON.parse(errorText);
					if (errorData.staleDevices) {
						console.log('Signal DM: Stale devices:', errorData.staleDevices);
						return { success: false, error: 'Stale sessions', staleDevices: errorData.staleDevices };
					}
				} catch (e) {
					// Couldn't parse error response
				}
			}

			return { success: false, error: `${response.status}: ${errorText}` };
		}
	} catch (error) {
		console.error('Signal DM: Network error:', error);
		return { success: false, error: error instanceof Error ? error.message : 'Network error' };
	}
}

/**
 * Fetch PreKey bundle for a recipient from Signal servers.
 * Includes caching and rate limit handling.
 * @param excludeDeviceId - Device ID to exclude (for self-send, pass our own deviceId)
 */
async function fetchPreKeyBundle(recipientAci: string, excludeDeviceId?: number): Promise<any | null> {
	const accountInfo = getAccountInfo();
	if (!accountInfo) {
		console.log('Signal DM: No account info for PreKey fetch');
		return null;
	}

	// Check if we're currently rate limited
	const now = Date.now();
	if (rateLimitedUntil > now) {
		const waitSeconds = Math.ceil((rateLimitedUntil - now) / 1000);
		console.log(`Signal DM: Rate limited. Wait ${waitSeconds}s before trying again.`);
		return null;
	}

	// Check cache first
	const cached = preKeyBundleCache.get(recipientAci);
	if (cached && (now - cached.fetchedAt) < PREKEY_CACHE_TTL) {
		console.log('Signal DM: Using cached PreKey bundle for', recipientAci);
		return cached.bundle;
	}

	try {
		// Get stored authentication password
		const password = await getAuthPassword();
		
		if (!password) {
			console.log('Signal DM: No auth password stored. Device registration may have failed.');
			console.log('Signal DM: Try re-linking your device.');
			return null;
		}

		// Authentication required for PreKey fetch
		// Format: Basic base64(aci.deviceId:password)
		const credentials = `${accountInfo.aci}.${accountInfo.deviceId}:${password}`;
		const authHeader = `Basic ${Buffer.from(credentials).toString('base64')}`;

		console.log('Signal DM: Fetching PreKey for', recipientAci);
		console.log('Signal DM: Using auth for', accountInfo.aci, 'device', accountInfo.deviceId);

		// Track fetch time to avoid hammering the API
		lastPreKeyFetchTime = now;

		// First try fetching all devices
		let response = await fetch(`${SIGNAL_SERVER}/v2/keys/${recipientAci}/*`, {
			method: 'GET',
			headers: {
				'Authorization': authHeader,
				'Accept': 'application/json',
			},
		});

		// If rate limited on /*, try fetching individual devices as fallback
		if (response.status === 429) {
			console.log('Signal DM: Rate limited on /* endpoint, trying individual devices...');
			
			// Try devices 1-4 (excluding the device we want to skip if provided)
			const devicesToTry = [1, 2, 3, 4].filter(d => d !== excludeDeviceId);
			console.log('Signal DM: Will try devices:', devicesToTry);
			const fetchedDevices: any[] = [];
			let identityKey: any = null;
			
			for (const deviceId of devicesToTry) {
				console.log(`Signal DM: Fetching PreKey for device ${deviceId}...`);
				const deviceResponse = await fetch(`${SIGNAL_SERVER}/v2/keys/${recipientAci}/${deviceId}`, {
					method: 'GET',
					headers: {
						'Authorization': authHeader,
						'Accept': 'application/json',
					},
				});
				
				console.log(`Signal DM: Device ${deviceId} response: ${deviceResponse.status}`);
				
				if (deviceResponse.status === 200) {
					const deviceData = await deviceResponse.json();
					if (!identityKey && deviceData.identityKey) {
						identityKey = deviceData.identityKey;
					}
					if (deviceData.devices) {
						fetchedDevices.push(...deviceData.devices);
					} else {
						fetchedDevices.push(deviceData);
					}
					console.log(`Signal DM: Got PreKey for device ${deviceId}, total now: ${fetchedDevices.length}`);
					// Continue to fetch ALL devices
				} else if (deviceResponse.status === 429) {
					console.log(`Signal DM: Rate limited on device ${deviceId}, stopping loop`);
					break;
				} else {
					console.log(`Signal DM: Device ${deviceId} not found or error: ${deviceResponse.status}`);
				}
			}
			
			console.log(`Signal DM: Finished fetching, got ${fetchedDevices.length} devices`);
			
			if (fetchedDevices.length > 0) {
				const data = { identityKey, devices: fetchedDevices };
				const deviceIds = fetchedDevices.map((d: any) => d.deviceId || 1);
				preKeyBundleCache.set(recipientAci, {
					bundle: data,
					fetchedAt: now,
					devices: deviceIds,
				});
				console.log('Signal DM: PreKey bundle from individual fetch, devices:', deviceIds);
				return data;
			}
			
			console.log('Signal DM: Could not fetch PreKey for any device');
			return null;
		}

		console.log('Signal DM: PreKey fetch response:', response.status);

		if (response.status === 401) {
			console.log('Signal DM: Authentication failed. Password may be invalid.');
			console.log('Signal DM: Try re-linking your device.');
			return null;
		}

		if (response.status === 404) {
			console.log('Signal DM: Recipient not found on Signal');
			return null;
		}

		if (response.status === 429) {
			console.log('Signal DM: Rate limited! Setting backoff for 60 seconds.');
			rateLimitedUntil = now + PREKEY_RATE_LIMIT_DELAY;
			const errorText = await response.text();
			console.log('Signal DM: Rate limit response:', errorText);
			return null;
		}

		if (!response.ok) {
			const errorText = await response.text();
			console.log('Signal DM: PreKey fetch failed:', response.status, errorText);
			return null;
		}

		const data = await response.json();
		console.log('Signal DM: PreKey bundle received');
		
		// Cache the bundle
		const devices = data.devices || [data];
		preKeyBundleCache.set(recipientAci, {
			bundle: data,
			fetchedAt: now,
			devices: devices.map((d: any) => d.deviceId || 1),
		});
		
		return data;
	} catch (error) {
		console.error('Signal DM: Error fetching PreKey bundle:', error);
		return null;
	}
}

/**
 * Create a Content protobuf for Signal message.
 * Signal messages are wrapped in a Content message containing DataMessage.
 * 
 * Using MANUAL protobuf encoding to ensure exact byte layout.
 * 
 * DataMessage structure (from SignalService.proto):
 * - body (field 1): string - The message text
 * - timestamp (field 7): uint64 - Message timestamp in milliseconds
 * 
 * Content structure:
 * - dataMessage (field 1): DataMessage
 */
function createContentMessage(text: string, timestamp: number, profileKey?: Uint8Array): Uint8Array {
	// MANUAL protobuf encoding to ensure correctness
	// 
	// DataMessage structure (from official proto):
	//   field 1 (body): string
	//   field 7 (timestamp): uint64
	// 
	// Content structure:
	//   field 1 (dataMessage): DataMessage
	
	const textBytes = new TextEncoder().encode(text);
	
	// Build DataMessage manually:
	const dataMessageParts: number[] = [];
	
	// Field 1 (body): tag = (1 << 3) | 2 = 0x0A (wire type 2 = length-delimited)
	dataMessageParts.push(0x0A);
	// Add length as varint
	const textLen = textBytes.length;
	if (textLen < 128) {
		dataMessageParts.push(textLen);
	} else {
		let len = textLen;
		while (len > 127) {
			dataMessageParts.push((len & 0x7F) | 0x80);
			len >>>= 7;
		}
		dataMessageParts.push(len);
	}
	// Add the text bytes
	for (let i = 0; i < textBytes.length; i++) {
		dataMessageParts.push(textBytes[i]);
	}
	
	// Field 7 (timestamp): tag = (7 << 3) | 0 = 0x38 (wire type 0 = varint)
	dataMessageParts.push(0x38);
	// Encode timestamp as varint (uint64)
	let ts = timestamp;
	while (ts > 127) {
		dataMessageParts.push((ts & 0x7F) | 0x80);
		ts = Math.floor(ts / 128); // JavaScript safe integer division
	}
	dataMessageParts.push(ts);
	
	const dataMessageBytes = new Uint8Array(dataMessageParts);
	console.log('Signal DM: DataMessage hex:', Buffer.from(dataMessageBytes).toString('hex'));
	console.log('Signal DM: Text:', text, 'Timestamp:', timestamp);
	
	// Build Content manually:
	// Field 1 (dataMessage): tag = (1 << 3) | 2 = 0x0A (wire type 2 = length-delimited)
	const contentParts: number[] = [];
	contentParts.push(0x0A);
	// Add length as varint
	const dmLen = dataMessageBytes.length;
	if (dmLen < 128) {
		contentParts.push(dmLen);
	} else {
		let len = dmLen;
		while (len > 127) {
			contentParts.push((len & 0x7F) | 0x80);
			len >>>= 7;
		}
		contentParts.push(len);
	}
	// Add DataMessage bytes
	for (let i = 0; i < dataMessageBytes.length; i++) {
		contentParts.push(dataMessageBytes[i]);
	}
	
	const contentBytes = new Uint8Array(contentParts);
	console.log('Signal DM: Content hex:', Buffer.from(contentBytes).toString('hex'));
	console.log('Signal DM: Content size:', contentBytes.length, 'bytes');
	
	// Add padding (Signal requires padded messages)
	// Signal uses 80-byte padding blocks
	const PADDING_BLOCK_SIZE = 80;
	const paddedLength = Math.ceil((contentBytes.length + 1) / PADDING_BLOCK_SIZE) * PADDING_BLOCK_SIZE;
	const padded = new Uint8Array(paddedLength);
	padded.set(contentBytes, 0);
	// Signal's padding scheme: 0x80 followed by zeros
	padded[contentBytes.length] = 0x80;
	
	console.log('Signal DM: Padded hex:', Buffer.from(padded).toString('hex'));
	console.log('Signal DM: Padded size:', padded.length, 'bytes');
	
	return padded;
}

/**
 * Encode a protobuf field with length-delimited wire type.
 */
function encodeProtobufField(fieldNumber: number, wireType: number, data: Uint8Array): Uint8Array {
	const tag = (fieldNumber << 3) | wireType;
	const tagBytes = encodeVarint(tag);
	const lengthBytes = encodeVarint(data.length);
	
	const result = new Uint8Array(tagBytes.length + lengthBytes.length + data.length);
	result.set(tagBytes, 0);
	result.set(lengthBytes, tagBytes.length);
	result.set(data, tagBytes.length + lengthBytes.length);
	return result;
}

/**
 * Encode a protobuf varint field.
 */
function encodeProtobufVarintField(fieldNumber: number, value: number): Uint8Array {
	const tag = (fieldNumber << 3) | 0; // wire type 0 = varint
	const tagBytes = encodeVarint(tag);
	const valueBytes = encodeVarint(value);
	
	const result = new Uint8Array(tagBytes.length + valueBytes.length);
	result.set(tagBytes, 0);
	result.set(valueBytes, tagBytes.length);
	return result;
}

/**
 * Encode a number as a protobuf varint.
 */
function encodeVarint(value: number): Uint8Array {
	const bytes: number[] = [];
	while (value > 127) {
		bytes.push((value & 0x7f) | 0x80);
		value >>>= 7;
	}
	bytes.push(value & 0x7f);
	return new Uint8Array(bytes);
}

/**
 * Format a phone number for display.
 */
export function formatPhoneNumber(phone: string): string {
	// Simple US formatting
	const digits = phone.replace(/\D/g, '');
	if (digits.length === 11 && digits.startsWith('1')) {
		return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
	}
	if (digits.length === 10) {
		return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
	}
	return phone;
}

/**
 * Generate a unique message ID.
 */
export function generateMessageId(): string {
	return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
