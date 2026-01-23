/**
 * Signal Message Sender
 *
 * Handles encryption and sending of messages through Signal protocol.
 * Used to send Lightning invoices to Signal contacts.
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
	PublicKey,
	PrivateKey,
	IdentityKeyPair,
} from 'react-native-libsignal-client';
import {
	getIdentityKey,
	getAccountInfo,
	getSession,
} from '../../storage/signal-store';
import type { SignalIdentity } from '../../store/types/slashtags';

// Signal server endpoints
const SIGNAL_SERVER = 'https://chat.signal.org';

export interface SendMessageResult {
	success: boolean;
	error?: string;
	timestamp?: number;
}

export interface InvoiceMessage {
	type: 'lightning_invoice';
	invoice: string;
	amount?: number;
	description?: string;
	expiry?: number;
}

/**
 * Send a Lightning invoice to a Signal contact.
 *
 * @param recipientIdentity - The Signal identity of the recipient
 * @param invoice - The Lightning invoice string (BOLT11)
 * @param amount - Optional amount in sats
 * @param description - Optional description
 * @returns Result of the send operation
 */
export async function sendInvoiceToContact(
	recipientIdentity: SignalIdentity,
	invoice: string,
	amount?: number,
	description?: string,
): Promise<SendMessageResult> {
	try {
		// Validate recipient has Signal identity
		if (!recipientIdentity.aci) {
			return {
				success: false,
				error: 'Recipient does not have a Signal identity linked',
			};
		}

		// Check if we're linked
		const accountInfo = getAccountInfo();
		if (!accountInfo) {
			return {
				success: false,
				error: 'Signal account not linked. Please link your Signal account first.',
			};
		}

		// Build the message payload
		const messagePayload: InvoiceMessage = {
			type: 'lightning_invoice',
			invoice,
			amount,
			description,
		};

		// Encrypt and send the message
		const result = await sendEncryptedMessage(
			recipientIdentity.aci,
			JSON.stringify(messagePayload),
		);

		return result;
	} catch (error) {
		console.error('SignalSender: Error sending invoice:', error);
		return {
			success: false,
			error: error instanceof Error ? error.message : 'Unknown error',
		};
	}
}

/**
 * Encrypt and send a message to a Signal recipient.
 *
 * @param recipientAci - The recipient's Account Identity (UUID)
 * @param plaintext - The message to send
 * @returns Result of the send operation
 */
async function sendEncryptedMessage(
	recipientAci: string,
	plaintext: string,
): Promise<SendMessageResult> {
	try {
		// Get our identity key
		const identityKey = await getIdentityKey('aci');
		if (!identityKey) {
			return {
				success: false,
				error: 'Identity key not found',
			};
		}

		// Create protocol address for recipient (device 1 is primary)
		// Note: ProtocolAddress requires a full session/store implementation
		const _recipientAddress = `${recipientAci}.1`;

		// Check if we have a session with this recipient
		const sessionAddress = `${recipientAci}.1`;
		const sessionData = getSession(sessionAddress);

		// If no session exists, we need to establish one
		// This requires fetching the recipient's PreKey bundle from Signal servers
		if (!sessionData) {
			console.log('SignalSender: No existing session, need to establish one');

			// Fetch recipient's PreKey bundle from server
			const preKeyBundle = await fetchPreKeyBundle(recipientAci, 1);
			if (!preKeyBundle) {
				return {
					success: false,
					error: 'Could not fetch recipient PreKey bundle',
				};
			}

			// Build session using the PreKey bundle
			// Note: This requires implementing the full session builder which needs
			// the identity key store implementation
			// For now, we'll return a placeholder

			return {
				success: false,
				error: 'Session establishment not yet fully implemented',
			};
		}

		// Encrypt the message using the existing session
		const plaintextBytes = new Uint8Array(Buffer.from(plaintext, 'utf-8'));

		// Create identity key pair for encryption
		const _publicKey = PublicKey._fromSerialized(new Uint8Array(identityKey.publicKey));
		const _privateKey = PrivateKey._fromSerialized(new Uint8Array(identityKey.privateKey));
		const _identityKeyPair = new IdentityKeyPair(_publicKey, _privateKey);

		// Encrypt the message
		// Note: signalEncrypt requires a full session store implementation
		// This is a simplified version

		const timestamp = Date.now();

		// Send the encrypted message to Signal servers
		const sendResult = await sendToServer(recipientAci, plaintextBytes, timestamp);

		if (sendResult.success) {
			return {
				success: true,
				timestamp,
			};
		}

		return sendResult;
	} catch (error) {
		console.error('SignalSender: Encryption error:', error);
		return {
			success: false,
			error: error instanceof Error ? error.message : 'Encryption failed',
		};
	}
}

/**
 * PreKey bundle structure returned from Signal servers.
 * Used for establishing new sessions.
 */
interface PreKeyBundleData {
	registrationId: number;
	deviceId: number;
	preKeyId: number;
	preKeyPublic: Uint8Array;
	signedPreKeyId: number;
	signedPreKeyPublic: Uint8Array;
	signedPreKeySignature: Uint8Array;
	identityKey: Uint8Array;
}

/**
 * Fetch a recipient's PreKey bundle from Signal servers.
 * Required for establishing a new session.
 */
async function fetchPreKeyBundle(
	recipientAci: string,
	deviceId: number,
): Promise<PreKeyBundleData | null> {
	try {
		const accountInfo = getAccountInfo();
		if (!accountInfo) {
			console.error('SignalSender: No account info for authentication');
			return null;
		}

		// TODO: Implement actual API call to Signal servers
		// GET /v2/keys/{destination}/{device_id}
		// Requires authentication with our credentials

		const url = `${SIGNAL_SERVER}/v2/keys/${recipientAci}/${deviceId}`;

		// For now, return null as we need proper authentication
		console.log('SignalSender: PreKey bundle fetch not yet implemented');
		console.log('SignalSender: Would fetch from:', url);

		return null;
	} catch (error) {
		console.error('SignalSender: Error fetching PreKey bundle:', error);
		return null;
	}
}

/**
 * Send an encrypted message to Signal servers.
 */
async function sendToServer(
	recipientAci: string,
	_encryptedMessage: Uint8Array,
	_timestamp: number,
): Promise<SendMessageResult> {
	try {
		const accountInfo = getAccountInfo();
		if (!accountInfo) {
			return {
				success: false,
				error: 'No account info for authentication',
			};
		}

		// TODO: Implement actual API call to Signal servers
		// PUT /v1/messages/{destination}
		// Body: { messages: [{ type, destinationDeviceId, content }], timestamp }

		const url = `${SIGNAL_SERVER}/v1/messages/${recipientAci}`;

		console.log('SignalSender: Message send not yet fully implemented');
		console.log('SignalSender: Would send to:', url);

		// For now, return a placeholder
		return {
			success: false,
			error: 'Message sending to Signal servers not yet implemented',
		};
	} catch (error) {
		console.error('SignalSender: Error sending to server:', error);
		return {
			success: false,
			error: error instanceof Error ? error.message : 'Send failed',
		};
	}
}

/**
 * Check if a contact has Signal identity linked.
 */
export function hasSignalIdentity(signal?: SignalIdentity): boolean {
	return !!(signal?.aci || signal?.phoneNumber);
}

/**
 * Get Signal contacts from a list of contacts.
 */
export function filterSignalContacts<T extends { signal?: SignalIdentity }>(
	contacts: T[],
): T[] {
	return contacts.filter((contact) => hasSignalIdentity(contact.signal));
}

export { SIGNAL_SERVER };
