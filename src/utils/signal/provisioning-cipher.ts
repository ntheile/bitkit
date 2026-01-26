/**
 * Signal Provisioning Cipher
 *
 * Implements encryption/decryption for Signal device provisioning messages.
 * Adapted from Signal-iOS ProvisioningCipher.swift
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
	PrivateKey,
	PublicKey,
	Aes256Cbc,
	hkdf,
	signHmacSha256,
	constantTimeEqual,
} from 'react-native-libsignal-client';

// Provisioning message version
const CIPHER_VERSION = 0x01;

// HKDF info string used by Signal
const PROVISIONING_INFO = 'TextSecure Provisioning Message';

export interface ProvisionEnvelope {
	publicKey: Uint8Array; // Sender's ephemeral public key (33 bytes)
	body: Uint8Array; // Encrypted ProvisionMessage
}

export interface DecryptedEnvelope {
	aciIdentityKeyPublic: Uint8Array;
	aciIdentityKeyPrivate: Uint8Array;
	pniIdentityKeyPublic?: Uint8Array;
	pniIdentityKeyPrivate?: Uint8Array;
	phoneNumber: string;
	provisioningCode: string;
	profileKey?: Uint8Array;
	aci: string;
	pni?: string;
	masterKey?: Uint8Array;
	readReceipts?: boolean;
}

/**
 * Decrypt a provisioning envelope received from the primary device.
 *
 * @param envelope - The encrypted envelope from primary device
 * @param privateKey - Our ephemeral private key used for key agreement
 * @returns Decrypted provisioning data
 */
export async function decryptProvisionEnvelope(
	envelope: ProvisionEnvelope,
	privateKey: PrivateKey,
): Promise<Uint8Array> {
	// Parse the primary device's public key from serialized bytes
	const theirPublicKey = PublicKey._fromSerialized(
		new Uint8Array(envelope.publicKey),
	);

	// Perform ECDH key agreement
	const sharedSecret = privateKey.agree(theirPublicKey);

	// Derive encryption keys using HKDF
	// 64 bytes: 32 for cipher key, 32 for MAC key
	// Signal uses an empty 32-byte salt (not null!)
	const derivedKeys = hkdf(
		64,
		new Uint8Array(sharedSecret),
		new TextEncoder().encode(PROVISIONING_INFO),
		new Uint8Array(32), // Empty 32-byte salt as per Signal protocol
	);

	const cipherKey = derivedKeys.slice(0, 32);
	const macKey = derivedKeys.slice(32, 64);

	// Parse encrypted body: [version: 1] [iv: 16] [ciphertext: ...] [mac: 32]
	const body = envelope.body;

	if (body.length < 1 + 16 + 32) {
		throw new Error('Provisioning message too short');
	}

	const version = body[0];
	if (version !== CIPHER_VERSION) {
		throw new Error(`Unsupported provisioning cipher version: ${version}`);
	}

	const iv = body.slice(1, 17);
	const ciphertext = body.slice(17, body.length - 32);
	const receivedMac = body.slice(body.length - 32);

	// Verify MAC over (version || iv || ciphertext)
	const dataToMac = body.slice(0, body.length - 32);
	const computedMac = signHmacSha256(new Uint8Array(macKey), new Uint8Array(dataToMac));

	if (!constantTimeEqual(new Uint8Array(computedMac), new Uint8Array(receivedMac))) {
		throw new Error('Provisioning message MAC verification failed');
	}

	// Decrypt using AES-256-CBC
	const cipher = Aes256Cbc.new(new Uint8Array(cipherKey));
	const plaintext = cipher.decrypt(new Uint8Array(ciphertext), new Uint8Array(iv));

	return plaintext;
}

/**
 * Encrypt a provisioning message (for acting as primary device).
 *
 * @param message - The plaintext provisioning message
 * @param theirPublicKey - The secondary device's ephemeral public key
 * @param ourPrivateKey - Our ephemeral private key
 * @returns Encrypted envelope
 */
export async function encryptProvisionMessage(
	message: Uint8Array,
	theirPublicKey: PublicKey,
	ourPrivateKey: PrivateKey,
): Promise<ProvisionEnvelope> {
	// Perform ECDH key agreement
	const sharedSecret = ourPrivateKey.agree(theirPublicKey);

	// Derive encryption keys
	// Signal uses an empty 32-byte salt (not null!)
	const derivedKeys = hkdf(
		64,
		new Uint8Array(sharedSecret),
		new TextEncoder().encode(PROVISIONING_INFO),
		new Uint8Array(32), // Empty 32-byte salt as per Signal protocol
	);

	const cipherKey = derivedKeys.slice(0, 32);
	const macKey = derivedKeys.slice(32, 64);

	// Generate random IV
	const iv = generateRandomBytes(16);

	// Encrypt using AES-256-CBC
	const cipher = Aes256Cbc.new(new Uint8Array(cipherKey));
	const ciphertext = cipher.encrypt(new Uint8Array(message), new Uint8Array(iv));

	// Build body: version || iv || ciphertext
	const bodyWithoutMac = new Uint8Array(1 + 16 + ciphertext.length);
	bodyWithoutMac[0] = CIPHER_VERSION;
	bodyWithoutMac.set(iv, 1);
	bodyWithoutMac.set(ciphertext, 17);

	// Compute MAC
	const mac = signHmacSha256(new Uint8Array(macKey), bodyWithoutMac);

	// Final body: version || iv || ciphertext || mac
	const body = new Uint8Array(bodyWithoutMac.length + 32);
	body.set(bodyWithoutMac, 0);
	body.set(mac, bodyWithoutMac.length);

	// Get our public key for the envelope
	const ourPublicKey = ourPrivateKey.getPublicKey();

	return {
		publicKey: ourPublicKey.serialized,
		body,
	};
}

/**
 * Generate cryptographically secure random bytes.
 */
function generateRandomBytes(length: number): Uint8Array {
	const bytes = new Uint8Array(length);
	// Use react-native-quick-crypto or similar
	if (typeof globalThis.crypto !== 'undefined') {
		globalThis.crypto.getRandomValues(bytes);
	} else {
		// Fallback - should use proper RNG in production
		for (let i = 0; i < length; i++) {
			bytes[i] = Math.floor(Math.random() * 256);
		}
	}
	return bytes;
}

export { generateRandomBytes };
