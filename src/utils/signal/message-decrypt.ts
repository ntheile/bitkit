/**
 * Signal Message Decryption
 *
 * Handles decryption of incoming Signal messages using libsignal.
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
	PublicKey,
	PrivateKey,
	ProtocolAddress,
	SessionRecord,
	PreKeyRecord,
	SignedPreKeyRecord,
	KyberPreKeyRecord,
	SignalMessage,
	PreKeySignalMessage,
	SessionStore,
	IdentityKeyStore,
	PreKeyStore,
	SignedPreKeyStore,
	KyberPreKeyStore,
	Direction,
	signalDecrypt,
	signalDecryptPreKey,
	sealedSenderDecrypt,
} from 'react-native-libsignal-client';

import {
	getAccountInfo,
	getIdentityKey,
	getSession,
	storeSession,
	getPreKey,
	deletePreKey,
	getSignedPreKey,
	getKyberPreKey,
	getRegistrationId,
	getAllSessionAddresses,
	getAllPreKeyIds,
	getAllSignedPreKeyIds,
	getAllKyberPreKeyIds,
} from '../../storage/signal-store';

// Signal's production trust root public keys (base64-encoded)
// Used for validating sender certificates in sealed sender messages
const SIGNAL_TRUST_ROOTS = [
	'BXu6QIKVz5MA8gstzfOgRQGqyLqOwNKHL6INkv3IHWMF',
	'BUkY0I+9+oPgDCn4+Ac6Iu813yvqkDr/ga8DzLxFxuk6',
];

import { EnvelopeType, type IEnvelope } from './message-socket';

// Cache for session records
const sessionCache = new Map<string, SessionRecord>();

// Cache for identity keys
const identityCache = new Map<string, PublicKey>();

/**
 * Session store implementation for decryption.
 */
class DecryptSessionStore extends SessionStore {
	async saveSession(name: ProtocolAddress, record: SessionRecord): Promise<void> {
		const key = `${name.name}.${name.deviceId}`;
		console.log('DecryptSessionStore: Saving session for:', key);
		sessionCache.set(key, record);
		storeSession(key, record.serialized);
		console.log('DecryptSessionStore: Session saved successfully');
	}

	async getSession(name: ProtocolAddress): Promise<SessionRecord | null> {
		const key = `${name.name}.${name.deviceId}`;
		const cached = sessionCache.get(key);
		if (cached) {
			console.log('DecryptSessionStore: Found cached session for:', key);
			return cached;
		}

		let stored = getSession(key);

		// Fallback: try without ACI: prefix for backward compatibility with old sessions
		if (!stored && name.name.startsWith('ACI:')) {
			const legacyKey = `${name.name.replace('ACI:', '')}.${name.deviceId}`;
			stored = getSession(legacyKey);
			if (stored) {
				console.log('DecryptSessionStore: Found session with legacy key:', legacyKey);
				// Migrate to new format
				storeSession(key, stored);
			}
		}

		if (stored) {
			console.log('DecryptSessionStore: Loaded session from storage for:', key);
			const record = SessionRecord._fromSerialized(stored);
			sessionCache.set(key, record);
			return record;
		}
		console.log('DecryptSessionStore: No session found for:', key);
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
 * Identity key store implementation for decryption.
 */
class DecryptIdentityStore extends IdentityKeyStore {
	private ourIdentityKey: { publicKey: PublicKey; privateKey: PrivateKey } | null = null;
	private ourAci: string | null = null;

	async initialize(): Promise<void> {
		const aciIdentity = await getIdentityKey('aci');
		const accountInfo = getAccountInfo();

		if (aciIdentity) {
			this.ourIdentityKey = {
				publicKey: PublicKey._fromSerialized(aciIdentity.publicKey),
				privateKey: PrivateKey._fromSerialized(aciIdentity.privateKey),
			};

			// Cache our own identity key so we can decrypt "note to self" messages
			if (accountInfo?.aci) {
				this.ourAci = accountInfo.aci;
				identityCache.set(accountInfo.aci, this.ourIdentityKey.publicKey);
				console.log('DecryptIdentityStore: Cached own identity for ACI:', accountInfo.aci);
			}
		}
	}

	async getIdentityKey(): Promise<PrivateKey> {
		if (!this.ourIdentityKey) {
			await this.initialize();
		}
		if (!this.ourIdentityKey) {
			throw new Error('Identity key not available');
		}
		return this.ourIdentityKey.privateKey;
	}

	async getLocalRegistrationId(): Promise<number> {
		return getRegistrationId() || 1;
	}

	async saveIdentity(name: ProtocolAddress, key: PublicKey): Promise<boolean> {
		const existing = identityCache.get(name.name);
		identityCache.set(name.name, key);
		console.log('DecryptIdentityStore: Saved identity for:', name.name);
		if (!existing) return true;
		const existingBytes = existing.serialized;
		const newBytes = key.serialized;
		if (existingBytes.length !== newBytes.length) return true;
		for (let i = 0; i < existingBytes.length; i++) {
			if (existingBytes[i] !== newBytes[i]) return true;
		}
		return false;
	}

	async isTrustedIdentity(
		_name: ProtocolAddress,
		_key: PublicKey,
		_direction: Direction,
	): Promise<boolean> {
		// TOFU - Trust On First Use
		return true;
	}

	async getIdentity(name: ProtocolAddress): Promise<PublicKey | null> {
		const cached = identityCache.get(name.name);
		if (cached) {
			return cached;
		}

		// Check if this is our own identity
		if (this.ourAci && name.name === this.ourAci && this.ourIdentityKey) {
			return this.ourIdentityKey.publicKey;
		}

		console.log('DecryptIdentityStore: No identity found for:', name.name);
		return null;
	}
}

/**
 * PreKey store implementation for decryption.
 */
class DecryptPreKeyStore extends PreKeyStore {
	async savePreKey(id: number, _record: PreKeyRecord): Promise<void> {
		// PreKeys are generated during registration, not during decryption
		console.log('DecryptPreKeyStore: savePreKey called for id:', id);
	}

	async getPreKey(id: number): Promise<PreKeyRecord> {
		try {
			const stored = getPreKey(id);
			if (!stored) {
				throw new Error(`PreKey ${id} not found`);
			}
			return PreKeyRecord._fromSerialized(stored);
		} catch (error) {
			console.error(`DecryptPreKeyStore: Error loading prekey ${id}:`, error);
			throw error;
		}
	}

	async removePreKey(id: number): Promise<void> {
		deletePreKey(id);
	}
}

/**
 * Signed PreKey store implementation for decryption.
 */
class DecryptSignedPreKeyStore extends SignedPreKeyStore {
	async saveSignedPreKey(id: number, _record: SignedPreKeyRecord): Promise<void> {
		console.log('DecryptSignedPreKeyStore: saveSignedPreKey called for id:', id);
	}

	async getSignedPreKey(id: number): Promise<SignedPreKeyRecord> {
		try {
			const stored = getSignedPreKey(id);
			if (!stored) {
				console.error(`DecryptSignedPreKeyStore: SignedPreKey ${id} not found in storage`);
				throw new Error(`SignedPreKey ${id} not found`);
			}
			console.log(`DecryptSignedPreKeyStore: Loaded signed prekey ${id}, size:`, stored.length);
			const record = SignedPreKeyRecord._fromSerialized(stored);
			console.log(`DecryptSignedPreKeyStore: Deserialized signed prekey ${id} successfully`);
			return record;
		} catch (error) {
			console.error(`DecryptSignedPreKeyStore: Error loading signed prekey ${id}:`, error);
			throw error;
		}
	}
}

/**
 * Kyber PreKey store implementation for decryption (post-quantum).
 */
class DecryptKyberPreKeyStore extends KyberPreKeyStore {
	async saveKyberPreKey(_id: number, _record: KyberPreKeyRecord): Promise<void> {
		console.log('DecryptKyberPreKeyStore: saveKyberPreKey called');
	}

	async getKyberPreKey(id: number): Promise<KyberPreKeyRecord> {
		try {
			const stored = getKyberPreKey(id);
			if (!stored) {
				console.error(`DecryptKyberPreKeyStore: KyberPreKey ${id} not found in storage`);
				throw new Error(`KyberPreKey ${id} not found`);
			}
			console.log(`DecryptKyberPreKeyStore: Loaded kyber prekey ${id}, size:`, stored.length);
			const record = KyberPreKeyRecord._fromSerialized(stored);
			console.log(`DecryptKyberPreKeyStore: Deserialized kyber prekey ${id} successfully`);
			return record;
		} catch (error) {
			console.error(`DecryptKyberPreKeyStore: Error loading kyber prekey ${id}:`, error);
			throw error;
		}
	}

	async markKyberPreKeyUsed(_id: number): Promise<void> {
		// No-op for now - kyber prekeys can be reused
	}
}

// Global store instances
const decryptSessionStore = new DecryptSessionStore();
const decryptIdentityStore = new DecryptIdentityStore();
const decryptPreKeyStore = new DecryptPreKeyStore();
const decryptSignedPreKeyStore = new DecryptSignedPreKeyStore();
const decryptKyberPreKeyStore = new DecryptKyberPreKeyStore();

export interface DecryptedMessage {
	senderAci: string;
	senderDeviceId: number;
	plaintext: Uint8Array;
	timestamp: number;
}

/**
 * Decrypt a Signal envelope.
 */
export async function decryptEnvelope(envelope: IEnvelope): Promise<DecryptedMessage | null> {
	const accountInfo = getAccountInfo();
	if (!accountInfo) {
		console.error('MessageDecrypt: No account info available');
		return null;
	}

	// Initialize identity store
	await decryptIdentityStore.initialize();

	try {
		switch (envelope.type) {
			case EnvelopeType.UNIDENTIFIED_SENDER:
				return await decryptSealedSender(envelope, accountInfo);
			case EnvelopeType.CIPHERTEXT:
				return await decryptCiphertext(envelope);
			case EnvelopeType.PREKEY_BUNDLE:
				return await decryptPreKeyBundle(envelope);
			default:
				console.log('MessageDecrypt: Unsupported envelope type:', envelope.type);
				return null;
		}
	} catch (error) {
		console.error('MessageDecrypt: Decryption failed:', error);
		return null;
	}
}

/**
 * Decrypt a sealed sender (UNIDENTIFIED_SENDER) envelope.
 * This handles messages where the sender's identity is encrypted.
 */
async function decryptSealedSender(
	envelope: IEnvelope,
	accountInfo: { aci: string; deviceId: number; phoneNumber?: string },
): Promise<DecryptedMessage | null> {
	if (!envelope.content) {
		console.error('MessageDecrypt: Sealed sender envelope missing content');
		return null;
	}

	// Get known session addresses for decryption
	// Normalize addresses to include ACI:/PNI: prefix for proper lookup
	const sessionAddresses = getAllSessionAddresses();
	const knownSessionAddresses = sessionAddresses.map((addr) => {
		const [name, deviceIdStr] = addr.split('.');
		// Add ACI: prefix if not already present (for backward compatibility with old sessions)
		const normalizedName = name.startsWith('ACI:') || name.startsWith('PNI:')
			? name
			: `ACI:${name}`;
		return new ProtocolAddress(normalizedName, Number.parseInt(deviceIdStr, 10) || 1);
	});

	// Get known prekey IDs
	const knownPrekeyIds = getAllPreKeyIds();
	const knownSignedPrekeyIds = getAllSignedPreKeyIds();
	const knownKyberPrekeyIds = getAllKyberPreKeyIds();

	console.log('MessageDecrypt: Sealed sender decryption with:');
	console.log('  - sessions:', knownSessionAddresses.length, sessionAddresses.slice(0, 3));
	console.log('  - prekeys:', knownPrekeyIds.length, knownPrekeyIds.slice(0, 5));
	console.log('  - signedPrekeys:', knownSignedPrekeyIds.length, knownSignedPrekeyIds);
	console.log('  - kyberPrekeys:', knownKyberPrekeyIds.length, knownKyberPrekeyIds);

	// Try each trust root until one works
	let lastError: Error | null = null;
	for (const trustRootBase64 of SIGNAL_TRUST_ROOTS) {
		try {
			const trustRootBytes = Uint8Array.from(
				Buffer.from(trustRootBase64, 'base64'),
			);
			const trustRoot = PublicKey._fromSerialized(trustRootBytes);

			const result = await sealedSenderDecrypt({
				message: envelope.content,
				trustRoot,
				timestamp: Number(envelope.timestamp) || Date.now(),
				localE164: accountInfo.phoneNumber || null,
				localUuid: accountInfo.aci,
				localDeviceId: accountInfo.deviceId,
				sessionStore: decryptSessionStore,
				identityStore: decryptIdentityStore,
				prekeyStore: decryptPreKeyStore,
				signedPrekeyStore: decryptSignedPreKeyStore,
				kyberPrekeyStore: decryptKyberPreKeyStore,
				knownSessionAddresses,
				knownPrekeyIds,
				knownSignedPrekeyIds,
				knownKyberPrekeyIds,
			});

			const senderAci = result.senderUuid();
			const senderDeviceId = result.deviceId();
			const plaintext = result.message();

			console.log('MessageDecrypt: Sealed sender decrypted from:', senderAci);

			return {
				senderAci,
				senderDeviceId,
				plaintext,
				timestamp: Number(envelope.timestamp),
			};
		} catch (error) {
			lastError = error as Error;
			// Try next trust root
		}
	}

	// All trust roots failed
	console.error('MessageDecrypt: Sealed sender decryption failed:', lastError);
	throw lastError;
}

/**
 * Decrypt a regular CIPHERTEXT envelope.
 */
async function decryptCiphertext(envelope: IEnvelope): Promise<DecryptedMessage | null> {
	if (!envelope.content || !envelope.sourceServiceId) {
		console.error('MessageDecrypt: Ciphertext envelope missing content or source');
		return null;
	}

	// Keep the full ServiceId (with ACI: prefix) for session lookup
	const senderServiceId = envelope.sourceServiceId;
	const senderAci = senderServiceId.replace('ACI:', '');
	const senderDeviceId = envelope.sourceDevice || 1;

	try {
		const address = new ProtocolAddress(senderServiceId, senderDeviceId);
		const message = SignalMessage._fromSerialized(envelope.content);

		const plaintext = await signalDecrypt(
			message,
			address,
			decryptSessionStore,
			decryptIdentityStore,
		);

		console.log('MessageDecrypt: Ciphertext decrypted from:', senderAci);

		return {
			senderAci,
			senderDeviceId,
			plaintext,
			timestamp: Number(envelope.timestamp),
		};
	} catch (error) {
		console.error('MessageDecrypt: Ciphertext decryption failed:', error);
		throw error;
	}
}

/**
 * Decrypt a PREKEY_BUNDLE envelope (initial key exchange).
 */
async function decryptPreKeyBundle(envelope: IEnvelope): Promise<DecryptedMessage | null> {
	if (!envelope.content || !envelope.sourceServiceId) {
		console.error('MessageDecrypt: PreKey envelope missing content or source');
		return null;
	}

	// Keep the full ServiceId (with ACI: prefix) for session storage
	const senderServiceId = envelope.sourceServiceId;
	const senderAci = senderServiceId.replace('ACI:', '');
	const senderDeviceId = envelope.sourceDevice || 1;

	// Get known kyber prekey IDs for this message
	const knownKyberPrekeyIds = getAllKyberPreKeyIds();
	console.log('MessageDecrypt: Decrypting PreKey bundle with kyber prekeys:', knownKyberPrekeyIds);

	try {
		// Use full ServiceId for address so session is stored with ACI: prefix
		const address = new ProtocolAddress(senderServiceId, senderDeviceId);
		const message = PreKeySignalMessage._fromSerialized(envelope.content);

		const plaintext = await signalDecryptPreKey(
			message,
			address,
			decryptSessionStore,
			decryptIdentityStore,
			decryptPreKeyStore,
			decryptSignedPreKeyStore,
			decryptKyberPreKeyStore,
			knownKyberPrekeyIds,
		);

		console.log('MessageDecrypt: PreKey bundle decrypted from:', senderServiceId);

		return {
			senderAci,
			senderDeviceId,
			plaintext,
			timestamp: Number(envelope.timestamp),
		};
	} catch (error) {
		console.error('MessageDecrypt: PreKey decryption failed:', error);
		throw error;
	}
}

/**
 * Parse the decrypted plaintext to extract the message content.
 * Signal messages are protobuf-encoded Content messages.
 */
export function parseMessageContent(plaintext: Uint8Array): string | null {
	// The plaintext is a protobuf-encoded Content message
	// For now, try to extract text as a simple approach
	// A full implementation would use proper protobuf parsing
	try {
		// Signal Content protobuf structure has DataMessage at field 1
		// DataMessage has body at field 1
		// This is a simplified extraction - proper protobuf parsing is recommended
		const textDecoder = new TextDecoder('utf-8', { fatal: false });
		const text = textDecoder.decode(plaintext);

		// Try to find readable text in the protobuf
		// This is hacky but may work for simple text messages
		// Remove non-printable characters
		const readable = text.replace(/[^\x20-\x7E]/g, '').trim();
		if (readable.length > 0) {
			return readable;
		}
		return null;
	} catch (error) {
		console.error('MessageDecrypt: Failed to parse message content:', error);
		return null;
	}
}
