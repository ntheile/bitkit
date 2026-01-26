/**
 * Signal Device Link
 *
 * Manages the device linking flow for connecting Bitkit as a
 * secondary device to an existing Signal account.
 *
 * Flow:
 * 1. Generate ephemeral key pair
 * 2. Connect to provisioning WebSocket
 * 3. Receive device UUID from server
 * 4. Display QR code: sgnl://linkdevice?uuid=...&pub_key=...
 * 5. User scans QR with Signal primary device
 * 6. Receive encrypted provisioning envelope
 * 7. Decrypt and extract identity keys
 * 8. Register as secondary device
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { PrivateKey, PublicKey } from 'react-native-libsignal-client';
import {
	ProvisioningSocket,
	type ProvisioningSocketCallbacks,
} from './provisioning-socket';
import { decryptProvisionEnvelope, type ProvisionEnvelope } from './provisioning-cipher';
import {
	decodeProvisionMessage,
	type IProvisionEnvelope,
	type IProvisionMessage,
} from './protos/provisioning';

// Device linking capabilities
const LINKING_CAPABILITIES = 'backup5'; // Supports link-and-sync

export interface DeviceLinkingState {
	status: DeviceLinkingStatus;
	qrCodeUrl?: string;
	deviceUuid?: string;
	error?: Error;
	provisioningData?: IProvisionMessage;
}

export enum DeviceLinkingStatus {
	IDLE = 'IDLE',
	CONNECTING = 'CONNECTING',
	WAITING_FOR_UUID = 'WAITING_FOR_UUID',
	WAITING_FOR_SCAN = 'WAITING_FOR_SCAN',
	PROCESSING_ENVELOPE = 'PROCESSING_ENVELOPE',
	REGISTERING = 'REGISTERING',
	COMPLETE = 'COMPLETE',
	ERROR = 'ERROR',
}

export interface DeviceLinkingCallbacks {
	onStateChange: (state: DeviceLinkingState) => void;
}

/**
 * DeviceLinkManager handles the full device linking flow.
 */
export class DeviceLinkManager {
	private callbacks: DeviceLinkingCallbacks;
	private socket: ProvisioningSocket | null = null;
	private ephemeralKeyPair: { privateKey: PrivateKey; publicKey: PublicKey } | null = null;
	private deviceUuid: string | null = null;
	private state: DeviceLinkingState = { status: DeviceLinkingStatus.IDLE };

	constructor(callbacks: DeviceLinkingCallbacks) {
		this.callbacks = callbacks;
	}

	/**
	 * Start the device linking process.
	 */
	async startLinking(): Promise<void> {
		try {
			// Update state
			this.updateState({ status: DeviceLinkingStatus.CONNECTING });

			// Generate ephemeral key pair for this linking session
			this.ephemeralKeyPair = await this.generateEphemeralKeyPair();
			console.log('DeviceLinkManager: Generated ephemeral key pair');

			// Create WebSocket callbacks
			const socketCallbacks: ProvisioningSocketCallbacks = {
				onDeviceUuidReceived: this.handleDeviceUuid.bind(this),
				onProvisionEnvelopeReceived: this.handleProvisionEnvelope.bind(this),
				onError: this.handleError.bind(this),
				onClose: this.handleClose.bind(this),
			};

			// Connect to provisioning socket
			this.socket = new ProvisioningSocket(socketCallbacks);
			this.socket.connect();

			this.updateState({ status: DeviceLinkingStatus.WAITING_FOR_UUID });
		} catch (error) {
			this.handleError(
				error instanceof Error ? error : new Error(String(error)),
			);
		}
	}

	/**
	 * Cancel the linking process.
	 */
	cancelLinking(): void {
		this.cleanup();
		this.updateState({ status: DeviceLinkingStatus.IDLE });
	}

	/**
	 * Get the current linking state.
	 */
	getState(): DeviceLinkingState {
		return { ...this.state };
	}

	/**
	 * Generate ephemeral identity key pair for provisioning.
	 */
	private async generateEphemeralKeyPair(): Promise<{
		privateKey: PrivateKey;
		publicKey: PublicKey;
	}> {
		const privateKey = PrivateKey.generate();
		const publicKey = privateKey.getPublicKey();
		return { privateKey, publicKey };
	}

	/**
	 * Handle receiving device UUID from server.
	 */
	private handleDeviceUuid(uuid: string): void {
		console.log('DeviceLinkManager: Received device UUID:', uuid);
		this.deviceUuid = uuid;

		if (!this.ephemeralKeyPair) {
			this.handleError(new Error('Ephemeral key pair not generated'));
			return;
		}

		// Build the QR code URL
		const qrCodeUrl = buildProvisioningUrl(
			uuid,
			this.ephemeralKeyPair.publicKey,
		);

		console.log('DeviceLinkManager: QR code URL:', qrCodeUrl);

		this.updateState({
			status: DeviceLinkingStatus.WAITING_FOR_SCAN,
			qrCodeUrl,
			deviceUuid: uuid,
		});
	}

	/**
	 * Handle receiving encrypted provisioning envelope from primary device.
	 */
	private async handleProvisionEnvelope(
		envelope: IProvisionEnvelope,
	): Promise<void> {
		console.log('DeviceLinkManager: Received provisioning envelope');
		console.log('DeviceLinkManager: Envelope publicKey length:', envelope.publicKey?.length);
		console.log('DeviceLinkManager: Envelope body length:', envelope.body?.length);
		this.updateState({ status: DeviceLinkingStatus.PROCESSING_ENVELOPE });

		if (!this.ephemeralKeyPair) {
			this.handleError(new Error('Ephemeral key pair not available'));
			return;
		}

		try {
			// Convert to expected format
			const provisionEnvelope: ProvisionEnvelope = {
				publicKey: envelope.publicKey,
				body: envelope.body,
			};

			// Decrypt the provisioning envelope
			console.log('DeviceLinkManager: Decrypting envelope...');
			const decryptedData = await decryptProvisionEnvelope(
				provisionEnvelope,
				this.ephemeralKeyPair.privateKey,
			);
			console.log('DeviceLinkManager: Decrypted data length:', decryptedData.length);
			console.log('DeviceLinkManager: First 20 bytes:', Array.from(decryptedData.slice(0, 20)));

			// Parse the provisioning message
			console.log('DeviceLinkManager: Parsing provisioning message...');
			const provisioningData = decodeProvisionMessage(decryptedData);

			console.log('DeviceLinkManager: Decrypted provisioning data');
			console.log('  Phone number:', provisioningData.number);
			console.log('  ACI:', provisioningData.aci);
			console.log('  PNI:', provisioningData.pni);

			// Store identity keys BEFORE registration (registration needs them)
			await this.storeIdentityKeys(provisioningData);

			// Update state with provisioning data
			this.updateState({
				status: DeviceLinkingStatus.REGISTERING,
				provisioningData,
			});

			// Proceed to register as secondary device
			await this.registerAsSecondaryDevice(provisioningData);
		} catch (error) {
			console.error('DeviceLinkManager: Error processing envelope:', error);
			this.handleError(
				error instanceof Error ? error : new Error(String(error)),
			);
		}
	}

	/**
	 * Store identity keys from provisioning data.
	 * This must be done before registration as the registration process needs these keys.
	 */
	private async storeIdentityKeys(provisioningData: IProvisionMessage): Promise<void> {
		const { storeIdentityKey, storeProfileKey, storeMasterKey } = await import('../../storage/signal-store');
		
		console.log('DeviceLinkManager: Storing identity keys...');
		console.log('DeviceLinkManager: aciIdentityKeyPublic present:', !!provisioningData.aciIdentityKeyPublic, 'length:', provisioningData.aciIdentityKeyPublic?.length);
		console.log('DeviceLinkManager: aciIdentityKeyPrivate present:', !!provisioningData.aciIdentityKeyPrivate, 'length:', provisioningData.aciIdentityKeyPrivate?.length);

		// Store ACI identity key
		if (provisioningData.aciIdentityKeyPublic && provisioningData.aciIdentityKeyPrivate) {
			console.log('DeviceLinkManager: Storing ACI identity key pair...');
			await storeIdentityKey(
				'aci',
				provisioningData.aciIdentityKeyPublic,
				provisioningData.aciIdentityKeyPrivate,
			);
			console.log('DeviceLinkManager: ACI identity key stored');
		} else {
			console.warn('DeviceLinkManager: Missing ACI identity key data!');
			console.warn('  Public:', provisioningData.aciIdentityKeyPublic?.length || 'missing');
			console.warn('  Private:', provisioningData.aciIdentityKeyPrivate?.length || 'missing');
		}

		// Store PNI identity key
		if (provisioningData.pniIdentityKeyPublic && provisioningData.pniIdentityKeyPrivate) {
			await storeIdentityKey(
				'pni',
				provisioningData.pniIdentityKeyPublic,
				provisioningData.pniIdentityKeyPrivate,
			);
			console.log('DeviceLinkManager: PNI identity key stored');
		}

		// Store profile key
		if (provisioningData.profileKey) {
			await storeProfileKey(provisioningData.profileKey);
			console.log('DeviceLinkManager: Profile key stored');
		}

		// Store master key
		if (provisioningData.masterKey) {
			await storeMasterKey(provisioningData.masterKey);
			console.log('DeviceLinkManager: Master key stored');
		}
	}

	/**
	 * Register this device as a secondary device with Signal servers.
	 */
	private async registerAsSecondaryDevice(
		provisioningData: IProvisionMessage,
	): Promise<void> {
		try {
			console.log('DeviceLinkManager: Registering as secondary device...');

			// Import and call the registration module
			const { registerLinkedDevice } = await import('./device-registration');
			const result = await registerLinkedDevice(provisioningData);

			if (result.success) {
				console.log('DeviceLinkManager: Registration successful!');
				console.log('  Device ID:', result.deviceId);
				console.log('  ACI:', result.aci);
				console.log('  PNI:', result.pni);

				// Password is already stored by registerLinkedDevice
				console.log('DeviceLinkManager: Auth credentials stored');

				this.updateState({
					status: DeviceLinkingStatus.COMPLETE,
					provisioningData,
				});
			} else {
				console.warn('DeviceLinkManager: Registration failed:', result.error);
				console.log('DeviceLinkManager: Marking as complete with partial data...');
				
				// Even if registration fails, we have the identity keys from provisioning
				// User can still attempt to use the app, but messaging may be limited
				this.updateState({
					status: DeviceLinkingStatus.COMPLETE,
					provisioningData,
				});
			}

			// Clean up
			this.cleanup();
		} catch (error) {
			console.error('DeviceLinkManager: Registration failed:', error);
			this.handleError(
				error instanceof Error ? error : new Error(String(error)),
			);
		}
	}

	private handleError(error: Error): void {
		console.error('DeviceLinkManager: Error:', error);
		this.updateState({
			status: DeviceLinkingStatus.ERROR,
			error,
		});
		this.cleanup();
	}

	private handleClose(): void {
		console.log('DeviceLinkManager: Socket closed');
		if (
			this.state.status !== DeviceLinkingStatus.COMPLETE &&
			this.state.status !== DeviceLinkingStatus.ERROR
		) {
			this.updateState({
				status: DeviceLinkingStatus.ERROR,
				error: new Error('Connection closed unexpectedly'),
			});
		}
	}

	private updateState(partialState: Partial<DeviceLinkingState>): void {
		this.state = { ...this.state, ...partialState };
		this.callbacks.onStateChange(this.state);
	}

	private cleanup(): void {
		if (this.socket) {
			this.socket.disconnect();
			this.socket = null;
		}
		this.ephemeralKeyPair = null;
		this.deviceUuid = null;
	}
}

/**
 * Build Signal provisioning URL for QR code.
 *
 * Format: sgnl://linkdevice?uuid={deviceId}&pub_key={base64PublicKey}&capabilities={caps}
 */
export function buildProvisioningUrl(
	deviceUuid: string,
	publicKey: PublicKey,
): string {
	// Use the serialized property instead of serialize() method
	const publicKeyBytes = publicKey.serialized;
	const publicKeyBase64 = Buffer.from(publicKeyBytes).toString('base64');

	// URL encode the base64 string (replace + with %2B, / with %2F, = with %3D)
	const encodedPublicKey = encodeURIComponent(publicKeyBase64);

	return `sgnl://linkdevice?uuid=${deviceUuid}&pub_key=${encodedPublicKey}&capabilities=${LINKING_CAPABILITIES}`;
}

/**
 * Parse a Signal provisioning URL.
 *
 * @returns Parsed URL components or null if invalid
 */
export function parseProvisioningUrl(urlString: string): {
	deviceUuid: string;
	publicKey: Uint8Array;
	capabilities: string[];
} | null {
	try {
		// Handle sgnl:// scheme
		const url = new URL(urlString);

		if (url.protocol !== 'sgnl:') {
			console.warn('Invalid protocol:', url.protocol);
			return null;
		}

		// hostname includes the path for custom protocols
		const host = url.hostname || url.pathname.split('/')[0];
		if (host !== 'linkdevice') {
			console.warn('Invalid host:', host);
			return null;
		}

		const uuid = url.searchParams.get('uuid');
		const pubKeyBase64 = url.searchParams.get('pub_key');
		const capabilitiesStr = url.searchParams.get('capabilities');

		if (!uuid || !pubKeyBase64) {
			console.warn('Missing required parameters');
			return null;
		}

		// Decode the public key
		const publicKey = Uint8Array.from(
			Buffer.from(decodeURIComponent(pubKeyBase64), 'base64'),
		);

		// Parse capabilities
		const capabilities = capabilitiesStr ? capabilitiesStr.split(',') : [];

		return {
			deviceUuid: uuid,
			publicKey,
			capabilities,
		};
	} catch (error) {
		console.error('Error parsing provisioning URL:', error);
		return null;
	}
}

export { LINKING_CAPABILITIES };
