/**
 * Signal Protocol Integration
 *
 * This module provides Signal protocol support for Bitkit, enabling
 * encrypted messaging of Lightning invoices to Signal contacts.
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Device linking
export {
	DeviceLinkManager,
	DeviceLinkingStatus,
	buildProvisioningUrl,
	parseProvisioningUrl,
	type DeviceLinkingState,
	type DeviceLinkingCallbacks,
} from './device-link';

// Provisioning
export {
	ProvisioningSocket,
	type ProvisioningSocketCallbacks,
	SIGNAL_SERVER,
	PROVISIONING_PATH,
} from './provisioning-socket';

// Cipher
export {
	decryptProvisionEnvelope,
	encryptProvisionMessage,
	generateRandomBytes,
	type ProvisionEnvelope,
	type DecryptedEnvelope,
} from './provisioning-cipher';

// Protobuf types
export {
	encodeProvisionEnvelope,
	decodeProvisionEnvelope,
	encodeProvisionMessage,
	decodeProvisionMessage,
	encodeWebSocketMessage,
	decodeWebSocketMessage,
	WebSocketMessageType,
	type IProvisionEnvelope,
	type IProvisionMessage,
	type IWebSocketMessage,
	type IWebSocketRequestMessage,
	type IWebSocketResponseMessage,
} from './protos/provisioning';

// Message sender
export {
	sendInvoiceToContact,
	hasSignalIdentity,
	filterSignalContacts,
	type SendMessageResult,
	type InvoiceMessage,
} from './message-sender';

// Username lookup
export {
	lookupByUsername,
	hashUsername,
	lookupMultipleUsernames,
	isUsernameLookupAvailable,
	type UsernameLookupResult,
	type UsernameEnvironment,
} from './username';

// Message receiving
export {
	MessageSocket,
	getMessageSocket,
	disconnectMessageSocket,
	EnvelopeType,
	type MessageSocketCallbacks,
	type ReceivedMessage,
} from './message-socket';
