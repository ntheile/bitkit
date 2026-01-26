/**
 * Signal Device Registration
 *
 * Handles registering Bitkit as a linked device with Signal servers.
 * This completes the device linking process and provides authentication credentials.
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
	PrivateKey,
	PublicKey,
	KyberPreKeyRecord,
	SignedPreKeyRecord,
	PreKeyRecord,
} from 'react-native-libsignal-client';
import {
	getIdentityKey,
	storeAccountInfo,
	storeAuthPassword,
	storeSignedPreKey,
	storeKyberPreKey,
	storePreKey,
	type SignalAccountInfo,
} from '../../storage/signal-store';
import type { IProvisionMessage } from './protos/provisioning';

const SIGNAL_SERVER = 'https://chat.signal.org';

// Generate a random registration ID (14-bit)
export function generateRegistrationId(): number {
	return Math.floor(Math.random() * 16380) + 1;
}

// Generate a random password for device authentication (base64url-safe)
export function generateDevicePassword(): string {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
	let password = '';
	for (let i = 0; i < 24; i++) {
		password += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return password;
}

export interface DeviceRegistrationResult {
	success: boolean;
	deviceId?: number;
	aci?: string;
	pni?: string;
	password?: string;
	error?: string;
}

/**
 * Sign data using an identity private key.
 */
async function signWithIdentityKey(data: Uint8Array, privateKeyBytes: Uint8Array): Promise<Uint8Array> {
	try {
		const key = PrivateKey._fromSerialized(privateKeyBytes);
		const signature = key.sign(data);
		return new Uint8Array(signature);
	} catch (error) {
		console.error('DeviceRegistration: Error signing:', error);
		// Return a placeholder signature if signing fails
		return new Uint8Array(64);
	}
}

/**
 * Generate a Kyber-1024 signed pre-key (post-quantum key exchange)
 * Uses KyberPreKeyRecord which internally generates the Kyber key pair
 * and signs it with the identity key.
 */
async function generateKyberSignedPreKey(
	identityPrivateKey: Uint8Array,
	keyId: number,
): Promise<{ keyId: number; publicKey: Uint8Array; signature: Uint8Array }> {
	try {
		// KyberPreKeyRecord.new handles generating the Kyber key pair
		// and signing the public key with the identity private key
		const timestamp = Date.now();
		const kyberRecord = KyberPreKeyRecord.new(keyId, timestamp, identityPrivateKey);

		// Store the full record (includes private key) for later decryption
		storeKyberPreKey(keyId, kyberRecord.serialized);
		console.log('DeviceRegistration: Stored Kyber prekey', keyId);

		// Get the public key from the record
		const publicKey = kyberRecord.publicKey();
		const publicKeyBytes = new Uint8Array(publicKey.serialized);

		// Get the signature that was generated
		const signature = new Uint8Array(kyberRecord.signature());

		console.log('DeviceRegistration: Kyber public key size:', publicKeyBytes.length);
		console.log('DeviceRegistration: Kyber signature size:', signature.length);

		if (publicKeyBytes.length === 0) {
			throw new Error('Kyber public key is empty');
		}

		return {
			keyId,
			publicKey: publicKeyBytes,
			signature,
		};
	} catch (error) {
		console.error('DeviceRegistration: Error generating Kyber key:', error);
		throw error; // Don't fall back - Kyber keys are required
	}
}

/**
 * Generate a signed pre-key using SignedPreKeyRecord.
 * This properly handles key generation, signing, and storage.
 */
async function generateSignedPreKey(
	identityPrivateKey: Uint8Array,
	keyId: number,
): Promise<{ keyId: number; publicKey: Uint8Array; signature: Uint8Array }> {
	const timestamp = Date.now();

	// Generate a new EC key pair for the signed prekey
	const preKeyPrivate = PrivateKey.generate();
	const preKeyPublic = preKeyPrivate.getPublicKey();

	// Sign the public key with our identity key
	const identityKey = PrivateKey._fromSerialized(identityPrivateKey);
	const signature = identityKey.sign(preKeyPublic.serialized);

	// Create SignedPreKeyRecord with the generated keys
	const record = SignedPreKeyRecord.new(
		keyId,
		timestamp,
		preKeyPublic,
		preKeyPrivate,
		signature,
	);

	// Store the full record (includes private key) for later decryption
	storeSignedPreKey(keyId, record.serialized);
	console.log('DeviceRegistration: Stored signed prekey', keyId);

	// Return the public parts for registration
	return {
		keyId,
		publicKey: new Uint8Array(record.publicKey().serialized),
		signature: new Uint8Array(record.signature()),
	};
}

/**
 * Generate a batch of one-time pre-keys.
 * These are used for initial session establishment (X3DH key agreement).
 * Each prekey can only be used once.
 */
function generateOneTimePreKeys(
	startId: number,
	count: number,
): Array<{ keyId: number; publicKey: Uint8Array }> {
	const preKeys: Array<{ keyId: number; publicKey: Uint8Array }> = [];

	for (let i = 0; i < count; i++) {
		const keyId = startId + i;

		// Generate a new EC key pair
		const privateKey = PrivateKey.generate();
		const publicKey = privateKey.getPublicKey();

		// Create PreKeyRecord and store it
		const record = PreKeyRecord.new(keyId, publicKey, privateKey);
		storePreKey(keyId, record.serialized);

		// Add public key to list for upload
		preKeys.push({
			keyId,
			publicKey: new Uint8Array(publicKey.serialized),
		});
	}

	console.log(`DeviceRegistration: Generated and stored ${count} one-time prekeys`);
	return preKeys;
}

/**
 * Register as a linked device with Signal servers.
 *
 * This is called after receiving the provisioning message from the primary device.
 * It completes the linking process and obtains authentication credentials.
 *
 * Signal's device linking flow:
 * 1. Primary device sends provisioningCode in the provisioning message
 * 2. New device calls PUT /v1/devices/{provisioningCode} with signed pre-keys
 * 3. Server returns deviceId and confirms registration
 */
export async function registerLinkedDevice(
	provisioningData: IProvisionMessage,
): Promise<DeviceRegistrationResult> {
	console.log('DeviceRegistration: Starting registration...');

	try {
		// Get the ACI identity key that was provisioned
		const aciIdentity = await getIdentityKey('aci');
		if (!aciIdentity) {
			return {
				success: false,
				error: 'ACI identity key not found. Device not properly provisioned.',
			};
		}

		// Get the PNI identity key
		const pniIdentity = await getIdentityKey('pni');

		// Generate device credentials
		const registrationId = generateRegistrationId();
		const pniRegistrationId = generateRegistrationId();
		const password = generateDevicePassword();
		const deviceName = 'Bitkit';

		console.log('DeviceRegistration: Generated credentials');
		console.log('  ACI Registration ID:', registrationId);
		console.log('  PNI Registration ID:', pniRegistrationId);

		// The provisioning code from the primary device authorizes this registration
		const provisioningCode = provisioningData.provisioningCode;
		if (!provisioningCode) {
			return {
				success: false,
				error: 'No provisioning code received from primary device',
			};
		}

		console.log('DeviceRegistration: Provisioning code received');
		console.log('DeviceRegistration: Code length:', provisioningCode.length);
		console.log('DeviceRegistration: Code preview:', provisioningCode.slice(0, 20));

		// Generate signed pre-keys (EC keys)
		// Use different IDs for ACI and PNI to avoid storage conflicts
		const aciSignedPreKey = await generateSignedPreKey(aciIdentity.privateKey, 1);
		const pniSignedPreKey = pniIdentity
			? await generateSignedPreKey(pniIdentity.privateKey, 1001) // Different ID for PNI
			: await generateSignedPreKey(aciIdentity.privateKey, 1001);

		console.log('DeviceRegistration: Generated signed EC pre-keys');

		// Generate Kyber-1024 "last resort" pre-keys (post-quantum)
		// Use different IDs for ACI and PNI to avoid storage conflicts
		const aciPqLastResortPreKey = await generateKyberSignedPreKey(aciIdentity.privateKey, 1);
		const pniPqLastResortPreKey = pniIdentity
			? await generateKyberSignedPreKey(pniIdentity.privateKey, 1001) // Different ID for PNI
			: await generateKyberSignedPreKey(aciIdentity.privateKey, 1001);

		console.log('DeviceRegistration: Generated Kyber last resort pre-keys');

		// Generate one-time pre-keys (100 each for ACI and PNI)
		// These are consumed during initial session establishment
		// Use non-overlapping ID ranges to avoid storage conflicts
		const ONE_TIME_PREKEY_COUNT = 100;
		const aciPreKeys = generateOneTimePreKeys(1, ONE_TIME_PREKEY_COUNT);
		const pniPreKeys = generateOneTimePreKeys(1001, ONE_TIME_PREKEY_COUNT); // Different range for PNI

		console.log('DeviceRegistration: Generated one-time pre-keys');

		// Device capabilities required by Signal
		// These must match the capabilities of other devices on the account
		const capabilities: Record<string, boolean> = {
			'pni': true,
			'paymentActivation': false,
			'deleteSync': true,
			'versionedExpirationTimer': true,
		};

		// Prepare registration request body following Signal's LinkDeviceRequest format
		// Structure: { verificationCode, accountAttributes, aciSignedPreKey, pniSignedPreKey, aciPqLastResortPreKey, pniPqLastResortPreKey }
		const requestBody = {
			// The verification code from the provisioning message
			verificationCode: provisioningCode,
			
			// Account attributes (nested object)
			accountAttributes: {
				// Device name encrypted with identity key (Signal uses a special encryption scheme)
				// For now, just base64 encode it - Signal may reject this
				name: Buffer.from(deviceName).toString('base64'),
				registrationId: registrationId,
				pniRegistrationId: pniRegistrationId,
				fetchesMessages: true,
				capabilities: capabilities,
			},
			
			// EC signed pre-keys (required)
			aciSignedPreKey: {
				keyId: aciSignedPreKey.keyId,
				publicKey: Buffer.from(aciSignedPreKey.publicKey).toString('base64'),
				signature: Buffer.from(aciSignedPreKey.signature).toString('base64'),
			},
			pniSignedPreKey: {
				keyId: pniSignedPreKey.keyId,
				publicKey: Buffer.from(pniSignedPreKey.publicKey).toString('base64'),
				signature: Buffer.from(pniSignedPreKey.signature).toString('base64'),
			},
			
			// Kyber-1024 "last resort" pre-keys (required for post-quantum support)
			aciPqLastResortPreKey: {
				keyId: aciPqLastResortPreKey.keyId,
				publicKey: Buffer.from(aciPqLastResortPreKey.publicKey).toString('base64'),
				signature: Buffer.from(aciPqLastResortPreKey.signature).toString('base64'),
			},
			pniPqLastResortPreKey: {
				keyId: pniPqLastResortPreKey.keyId,
				publicKey: Buffer.from(pniPqLastResortPreKey.publicKey).toString('base64'),
				signature: Buffer.from(pniPqLastResortPreKey.signature).toString('base64'),
			},

			// One-time pre-keys for initial session establishment
			aciPreKeys: aciPreKeys.map((pk) => ({
				keyId: pk.keyId,
				publicKey: Buffer.from(pk.publicKey).toString('base64'),
			})),
			pniPreKeys: pniPreKeys.map((pk) => ({
				keyId: pk.keyId,
				publicKey: Buffer.from(pk.publicKey).toString('base64'),
			})),
		};

		console.log('DeviceRegistration: Sending PUT /v1/devices/link...');
		console.log('DeviceRegistration: Request structure:', Object.keys(requestBody).join(', '));
		console.log('DeviceRegistration: AccountAttributes:', Object.keys(requestBody.accountAttributes).join(', '));
		console.log('DeviceRegistration: verificationCode length:', requestBody.verificationCode.length);

		// Get the phone number from provisioning data for authentication
		const phoneNumber = provisioningData.number;
		if (!phoneNumber) {
			return {
				success: false,
				error: 'No phone number received from primary device',
			};
		}

		// Create Basic auth header using e164:password
		// The secondary device uses the phone number and its generated password for authentication
		const authString = `${phoneNumber}:${password}`;
		const basicAuth = Buffer.from(authString).toString('base64');
		console.log('DeviceRegistration: Auth identifier:', phoneNumber);

		// Send to /v1/devices/link endpoint with PUT method
		const response = await fetch(`${SIGNAL_SERVER}/v1/devices/link`, {
			method: 'PUT',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Basic ${basicAuth}`,
			},
			body: JSON.stringify(requestBody),
		});

		const responseText = await response.text();
		console.log('DeviceRegistration: Response status:', response.status);
		console.log('DeviceRegistration: Response body:', responseText.slice(0, 500));

		if (response.ok) {
			let data: any = {};
			try {
				data = JSON.parse(responseText);
			} catch {
				// Response might be empty on success
			}
			
			console.log('DeviceRegistration: Success!');
			console.log('  Device ID:', data.deviceId);

			const result: DeviceRegistrationResult = {
				success: true,
				deviceId: data.deviceId || 2, // Default to device 2 for linked devices
				aci: provisioningData.aci,
				pni: provisioningData.pni,
				password: password,
			};

			// Store the password securely
			await storeAuthPassword(password);

			// Update account info with the device ID
			const accountInfo = {
				phoneNumber: provisioningData.number || '',
				aci: provisioningData.aci || '',
				pni: provisioningData.pni || '',
				deviceId: result.deviceId || 2,
				registrationId: registrationId,
				linkedAt: Date.now(),
				password: password,
			};
			storeAccountInfo(accountInfo);

			console.log('DeviceRegistration: Credentials stored');

			return result;
		} else {
			console.error('DeviceRegistration: Failed:', response.status);
			console.error('DeviceRegistration: Response:', responseText);

			// Handle specific error codes
			if (response.status === 403) {
				return {
					success: false,
					error: 'Provisioning code expired or invalid. Please try linking again.',
				};
			} else if (response.status === 411) {
				return {
					success: false,
					error: 'Missing required fields in registration request.',
				};
			} else if (response.status === 422) {
				return {
					success: false,
					error: 'Invalid registration data: ' + responseText,
				};
			}

			return {
				success: false,
				error: `Registration failed: ${response.status} - ${responseText.slice(0, 100)}`,
			};
		}
	} catch (error) {
		console.error('DeviceRegistration: Exception:', error);
		return {
			success: false,
			error: error instanceof Error ? error.message : 'Unknown error during registration',
		};
	}
}

/**
 * Check if the device is properly registered with Signal.
 * Attempts to authenticate with stored credentials.
 */
export async function verifyRegistration(
	aci: string,
	deviceId: number,
	password: string,
): Promise<boolean> {
	try {
		const credentials = `${aci}.${deviceId}:${password}`;
		const authHeader = `Basic ${Buffer.from(credentials).toString('base64')}`;

		const response = await fetch(`${SIGNAL_SERVER}/v1/accounts/whoami`, {
			method: 'GET',
			headers: {
				'Authorization': authHeader,
			},
		});

		console.log('DeviceRegistration: Verify response:', response.status);
		return response.ok;
	} catch (error) {
		console.error('DeviceRegistration: Verify error:', error);
		return false;
	}
}
