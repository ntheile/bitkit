/**
 * Signal Message WebSocket
 *
 * Handles WebSocket connection to Signal's message endpoint for receiving
 * real-time encrypted messages.
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as protobuf from 'protobufjs';

import {
	decodeWebSocketMessage,
	encodeWebSocketMessage,
	WebSocketMessageType,
	type IWebSocketMessage,
} from './protos/provisioning';
import {
	getAccountInfo,
	getAuthPassword,
} from '../../storage/signal-store';
import { decryptEnvelope, parseMessageContent } from './message-decrypt';

// Signal server endpoints
const SIGNAL_SERVER = 'chat.signal.org';
const SIGNAL_SERVER_HTTPS = 'https://chat.signal.org';
const MESSAGE_PATH = '/v1/websocket/';

// Define Envelope protobuf schema (for incoming messages)
const envelopeRoot = new protobuf.Root();

// Envelope - wrapper for incoming messages
envelopeRoot.define('signalservice').add(
	new protobuf.Type('Envelope')
		.add(new protobuf.Field('type', 1, 'int32'))
		.add(new protobuf.Field('sourceServiceId', 11, 'string'))
		.add(new protobuf.Field('sourceDevice', 7, 'uint32'))
		.add(new protobuf.Field('destinationServiceId', 13, 'string'))
		.add(new protobuf.Field('timestamp', 5, 'uint64'))
		.add(new protobuf.Field('content', 8, 'bytes'))
		.add(new protobuf.Field('serverGuid', 9, 'string'))
		.add(new protobuf.Field('serverTimestamp', 10, 'uint64'))
		.add(new protobuf.Field('urgent', 14, 'bool'))
		.add(new protobuf.Field('story', 16, 'bool'))
);

const Envelope = envelopeRoot.lookupType('signalservice.Envelope');

// Envelope types
export enum EnvelopeType {
	UNKNOWN = 0,
	CIPHERTEXT = 1,
	KEY_EXCHANGE = 2,
	PREKEY_BUNDLE = 3,
	RECEIPT = 5,
	UNIDENTIFIED_SENDER = 6,
	PLAINTEXT_CONTENT = 8,
}

export interface IEnvelope {
	type: EnvelopeType;
	sourceServiceId?: string;
	sourceDevice?: number;
	destinationServiceId?: string;
	timestamp: number;
	content?: Uint8Array;
	serverGuid?: string;
	serverTimestamp?: number;
	urgent?: boolean;
	story?: boolean;
}

export interface ReceivedMessage {
	id: string;
	senderAci: string;
	senderDevice: number;
	text: string;
	timestamp: number;
	serverTimestamp: number;
}

export interface MessageSocketCallbacks {
	onMessageReceived: (message: ReceivedMessage) => void;
	onEnvelopeReceived?: (envelope: IEnvelope) => void;
	onConnected: () => void;
	onDisconnected: () => void;
	onError: (error: Error) => void;
}

export class MessageSocket {
	private ws: WebSocket | null = null;
	private callbacks: MessageSocketCallbacks;
	private requestId = 0;
	private keepAliveInterval: ReturnType<typeof setInterval> | null = null;
	private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
	private pollInterval: ReturnType<typeof setInterval> | null = null;
	private isManualDisconnect = false;
	private seenMessageGuids = new Set<string>();

	constructor(callbacks: MessageSocketCallbacks) {
		this.callbacks = callbacks;
	}

	/**
	 * Connect to the Signal message WebSocket endpoint.
	 */
	async connect(): Promise<void> {
		if (this.ws) {
			console.warn('MessageSocket: Already connected');
			return;
		}

		const accountInfo = getAccountInfo();
		if (!accountInfo) {
			this.callbacks.onError(new Error('Signal account not linked'));
			return;
		}

		const password = await getAuthPassword();
		if (!password) {
			this.callbacks.onError(new Error('No auth password'));
			return;
		}

		// Build URL with auth parameters
		// Signal requires specific format: login=uuid.deviceId&password=...
		const login = encodeURIComponent(`${accountInfo.aci}.${accountInfo.deviceId}`);
		const pass = encodeURIComponent(password);
		// Add agent=OWD (Signal Desktop identifier) to potentially receive messages
		const url = `wss://${SIGNAL_SERVER}${MESSAGE_PATH}?login=${login}&password=${pass}&agent=OWD`;

		console.log('MessageSocket: URL (redacted):', `wss://${SIGNAL_SERVER}${MESSAGE_PATH}?login=${accountInfo.aci.slice(0,8)}...&password=***&agent=OWD`);

		console.log('MessageSocket: Connecting...');
		this.isManualDisconnect = false;

		try {
			this.ws = new WebSocket(url);
			// @ts-expect-error - binaryType exists on WebSocket in React Native
			this.ws.binaryType = 'arraybuffer';

			this.ws.onopen = this.handleOpen.bind(this);
			this.ws.onmessage = this.handleMessage.bind(this);
			this.ws.onerror = this.handleError.bind(this);
			this.ws.onclose = this.handleClose.bind(this);
		} catch (error) {
			console.error('MessageSocket: Failed to create WebSocket:', error);
			this.callbacks.onError(
				error instanceof Error ? error : new Error(String(error)),
			);
		}
	}

	/**
	 * Disconnect from the message socket.
	 */
	disconnect(): void {
		this.isManualDisconnect = true;
		this.stopKeepAlive();
		this.stopReconnect();
		this.stopPolling();

		if (this.ws) {
			this.ws.close();
			this.ws = null;
		}
	}

	/**
	 * Check if socket is currently connected.
	 */
	isConnected(): boolean {
		return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
	}

	private handleOpen(): void {
		console.log('MessageSocket: Connected');
		this.startKeepAlive();
		this.startPolling();
		this.callbacks.onConnected();

		// Fetch any pending/queued messages after connecting
		this.fetchPendingMessages();
	}

	/**
	 * Fetch pending messages via REST API.
	 * Signal queues messages when the device is offline - we need to fetch them.
	 * Also used for polling since WebSocket push may not work reliably.
	 */
	private async fetchPendingMessages(): Promise<void> {
		try {
			const accountInfo = getAccountInfo();
			if (!accountInfo) {
				console.log('MessageSocket: Cannot fetch pending - no account info');
				return;
			}

			const password = await getAuthPassword();
			if (!password) {
				console.log('MessageSocket: Cannot fetch pending - no password');
				return;
			}

			// Build auth header
			const credentials = `${accountInfo.aci}.${accountInfo.deviceId}:${password}`;
			const authHeader = `Basic ${Buffer.from(credentials).toString('base64')}`;

			const response = await fetch(`${SIGNAL_SERVER_HTTPS}/v1/messages`, {
				method: 'GET',
				headers: {
					'Authorization': authHeader,
					'Content-Type': 'application/json',
				},
			});

			if (response.ok) {
				const data = await response.json();

				// Process the messages array
				// Response format: { messages: [{ guid, type, timestamp, sourceUuid, sourceDevice, content, serverTimestamp, ... }], more: boolean }
				if (data.messages && Array.isArray(data.messages)) {
					// Filter to only new messages we haven't seen
					const newMessages = data.messages.filter(
						(msg: any) => msg.guid && !this.seenMessageGuids.has(msg.guid),
					);

					if (newMessages.length > 0) {
						console.log('MessageSocket: [Poll] Found', newMessages.length, 'new messages (total:', data.messages.length, ')');

						// Count message types for logging
						const typeCounts = newMessages.reduce((acc: Record<number, number>, msg: any) => {
							acc[msg.type] = (acc[msg.type] || 0) + 1;
							return acc;
						}, {});
						console.log('MessageSocket: [Poll] New message types:', JSON.stringify(typeCounts));

						// Mark all as seen
						for (const msg of newMessages) {
							if (msg.guid) {
								this.seenMessageGuids.add(msg.guid);
							}
						}

						// Process each new message envelope
						for (const msg of newMessages) {
							this.processRestMessage(msg);
						}

						// Note: Messages stay in queue - can only be acknowledged via WebSocket
						// The seenMessageGuids set prevents reprocessing locally
					} else if (data.messages.length > 0) {
						console.log('MessageSocket: [Poll] No new messages (', data.messages.length, 'already seen)');
					}

					// Keep seenMessageGuids from growing indefinitely
					if (this.seenMessageGuids.size > 1000) {
						const guidsArray = Array.from(this.seenMessageGuids);
						this.seenMessageGuids = new Set(guidsArray.slice(-500));
					}
				}
			} else if (response.status !== 204) {
				const errorText = await response.text();
				console.log('MessageSocket: Failed to fetch messages:', response.status, errorText);
			}
		} catch (error) {
			console.error('MessageSocket: Error fetching pending messages:', error);
		}
	}

	/**
	 * Process a message from the REST API.
	 * REST format differs from WebSocket protobuf format.
	 */
	private processRestMessage(msg: any): void {
		const envelope: IEnvelope = {
			type: msg.type,
			sourceServiceId: msg.sourceUuid ? `ACI:${msg.sourceUuid}` : undefined,
			sourceDevice: msg.sourceDevice,
			destinationServiceId: msg.destinationUuid ? `ACI:${msg.destinationUuid}` : undefined,
			timestamp: msg.timestamp,
			content: msg.content ? this.base64ToUint8Array(msg.content) : undefined,
			serverGuid: msg.guid,
			serverTimestamp: msg.serverTimestamp,
			urgent: msg.urgent,
			story: msg.story,
		};

		// Process the envelope (includes decryption)
		this.processEnvelope(envelope, msg.guid);
	}

	private base64ToUint8Array(base64: string): Uint8Array {
		const binaryString = atob(base64);
		const bytes = new Uint8Array(binaryString.length);
		for (let i = 0; i < binaryString.length; i++) {
			bytes[i] = binaryString.charCodeAt(i);
		}
		return bytes;
	}

	/**
	 * Start polling for messages via REST API.
	 * Workaround for WebSocket push not working reliably.
	 */
	private startPolling(): void {
		this.stopPolling();
		console.log('MessageSocket: Starting REST polling every 15 seconds');
		this.pollInterval = setInterval(() => {
			this.fetchPendingMessages();
		}, 15000);
	}

	private stopPolling(): void {
		if (this.pollInterval) {
			clearInterval(this.pollInterval);
			this.pollInterval = null;
		}
	}


	private handleMessage(event: WebSocketMessageEvent): void {
		try {
			const data = new Uint8Array(event.data as ArrayBuffer);
			console.log('MessageSocket: Raw message received, length:', data.length);

			const message = decodeWebSocketMessage(data);
			console.log('MessageSocket: Decoded message type:', message.type);

			if (message.type === WebSocketMessageType.REQUEST && message.request) {
				this.handleRequest(message);
			} else if (message.type === WebSocketMessageType.RESPONSE && message.response) {
				this.handleResponse(message);
			} else {
				console.log('MessageSocket: Unknown message type:', message.type);
			}
		} catch (error) {
			console.error('MessageSocket: Error parsing message:', error);
		}
	}

	private handleRequest(message: IWebSocketMessage): void {
		const request = message.request;
		if (!request) return;

		console.log('MessageSocket: Request -', request.verb, request.path, 'id:', request.id, 'body length:', request.body?.length || 0);

		// Handle message paths - Signal uses various path formats
		if (request.verb === 'PUT' && (
			request.path === '/api/v1/message' ||
			request.path === '/v1/message' ||
			request.path?.includes('/message')
		)) {
			// Incoming encrypted message
			this.handleIncomingMessage(request.body, request.id);
		} else if (request.verb === 'PUT' && (
			request.path === '/api/v1/queue/empty' ||
			request.path === '/v1/queue/empty' ||
			request.path?.includes('/queue/empty')
		)) {
			// Queue is empty notification
			console.log('MessageSocket: Message queue empty');
			this.sendAck(request.id);
		} else {
			console.log('MessageSocket: Unhandled request - acking anyway');
			// If it has a body, try to process it as a message
			if (request.body && request.body.length > 0) {
				console.log('MessageSocket: Request has body, attempting to process as message');
				this.handleIncomingMessage(request.body, request.id);
			} else {
				this.sendAck(request.id);
			}
		}
	}

	private handleResponse(message: IWebSocketMessage): void {
		const response = message.response;
		if (!response) return;

		if (response.status !== 200) {
			console.warn(
				'MessageSocket: Non-200 response:',
				response.status,
				response.message,
			);
		}
	}

	private handleIncomingMessage(
		body: Uint8Array | undefined,
		requestId: number,
	): void {
		if (!body) {
			console.warn('MessageSocket: Message request missing body');
			this.sendAck(requestId);
			return;
		}

		try {
			// Decode the protobuf envelope from WebSocket
			const envelopeMsg = Envelope.decode(body);
			const envelope = Envelope.toObject(envelopeMsg, {
				longs: Number,
				bytes: Uint8Array,
			}) as IEnvelope;

			// Acknowledge receipt
			this.sendAck(requestId);

			// Process the envelope
			this.processEnvelope(envelope, envelope.serverGuid);
		} catch (error) {
			console.error('MessageSocket: Error processing message:', error);
			this.sendAck(requestId);
		}
	}

	/**
	 * Process a decoded envelope (from WebSocket or REST API).
	 */
	private async processEnvelope(envelope: IEnvelope, guid?: string): Promise<void> {
		const senderAci = envelope.sourceServiceId?.replace('ACI:', '') || 'unknown';

		// Notify about envelope (for debugging/logging)
		this.callbacks.onEnvelopeReceived?.(envelope);

		// Handle receipts differently - no decryption needed
		if (envelope.type === EnvelopeType.RECEIPT) {
			console.log('MessageSocket: Receipt from:', senderAci);
			return;
		}

		// Attempt to decrypt the envelope
		try {
			const decrypted = await decryptEnvelope(envelope);
			if (decrypted) {
				const textContent = parseMessageContent(decrypted.plaintext);
				console.log('MessageSocket: Decrypted message from:', decrypted.senderAci);
				if (textContent) {
					console.log('MessageSocket: Message content:', textContent.substring(0, 100));
				}

				// Notify callback about decrypted message
				this.callbacks.onMessageReceived({
					id: `${decrypted.senderAci}-${decrypted.timestamp}`,
					senderAci: decrypted.senderAci,
					senderDevice: decrypted.senderDeviceId,
					text: textContent || '[binary content]',
					timestamp: decrypted.timestamp,
					serverTimestamp: Number(envelope.serverTimestamp) || decrypted.timestamp,
				});
			} else {
				console.log('MessageSocket: Could not decrypt envelope type:', envelope.type, 'from:', senderAci);
				// Delete undecryptable message from queue if we have a guid
				if (guid) {
					await this.deleteMessage(guid);
				}
			}
		} catch (error) {
			console.error('MessageSocket: Decryption error for type:', envelope.type, 'from:', senderAci, error);
			// Check if this is a NoSessionException - delete these messages as they're unrecoverable
			const errorMessage = error instanceof Error ? error.message : String(error);
			if (errorMessage.includes('NoSessionException') && guid) {
				console.log('MessageSocket: Deleting unrecoverable message (no session):', guid);
				await this.deleteMessage(guid);
			}
		}
	}

	/**
	 * Delete a message from the server queue.
	 * Used to clear messages we cannot decrypt (e.g., from unknown sessions).
	 */
	private async deleteMessage(guid: string): Promise<void> {
		try {
			const accountInfo = getAccountInfo();
			const password = await getAuthPassword();
			if (!accountInfo || !password) {
				console.warn('MessageSocket: Cannot delete message - no auth');
				return;
			}

			const credentials = `${accountInfo.aci}.${accountInfo.deviceId}:${password}`;
			const authHeader = `Basic ${btoa(credentials)}`;

			const response = await fetch(`${SIGNAL_SERVER_HTTPS}/v1/messages/uuid/${guid}`, {
				method: 'DELETE',
				headers: {
					'Authorization': authHeader,
				},
			});

			if (response.ok || response.status === 204) {
				console.log('MessageSocket: Deleted message from queue:', guid);
				// Also remove from seen set so we don't try to process it again
				this.seenMessageGuids.delete(guid);
			} else {
				console.warn('MessageSocket: Failed to delete message:', response.status);
			}
		} catch (error) {
			console.error('MessageSocket: Error deleting message:', error);
		}
	}

	private sendAck(requestId: number): void {
		const response: IWebSocketMessage = {
			type: WebSocketMessageType.RESPONSE,
			response: {
				id: requestId,
				status: 200,
				message: 'OK',
			},
		};

		this.send(response);
	}

	private sendKeepAlive(): void {
		if (!this.isConnected()) return;

		this.requestId++;
		const request: IWebSocketMessage = {
			type: WebSocketMessageType.REQUEST,
			request: {
				id: this.requestId,
				verb: 'GET',
				path: '/v1/keepalive',
			},
		};

		this.send(request);
	}

	private send(message: IWebSocketMessage): void {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
			console.warn('MessageSocket: Cannot send - socket not open');
			return;
		}

		const encoded = encodeWebSocketMessage(message);
		this.ws.send(encoded);
	}

	private startKeepAlive(): void {
		this.keepAliveInterval = setInterval(() => {
			this.sendKeepAlive();
		}, 30000);
	}

	private stopKeepAlive(): void {
		if (this.keepAliveInterval) {
			clearInterval(this.keepAliveInterval);
			this.keepAliveInterval = null;
		}
	}

	private stopReconnect(): void {
		if (this.reconnectTimeout) {
			clearTimeout(this.reconnectTimeout);
			this.reconnectTimeout = null;
		}
	}

	private scheduleReconnect(): void {
		if (this.isManualDisconnect) return;

		this.stopReconnect();
		console.log('MessageSocket: Scheduling reconnect in 5 seconds');
		this.reconnectTimeout = setTimeout(() => {
			this.connect();
		}, 5000);
	}

	private handleError(_event: Event): void {
		console.error('MessageSocket: WebSocket error');
		this.callbacks.onError(new Error('WebSocket connection error'));
	}

	private handleClose(event: any): void {
		console.log('MessageSocket: Connection closed - code:', event?.code);
		this.stopKeepAlive();
		this.stopPolling();
		this.ws = null;
		this.callbacks.onDisconnected();

		// Auto-reconnect unless manually disconnected
		if (!this.isManualDisconnect) {
			this.scheduleReconnect();
		}
	}
}

// Singleton instance
let messageSocketInstance: MessageSocket | null = null;

/**
 * Get or create the message socket instance.
 */
export function getMessageSocket(callbacks: MessageSocketCallbacks): MessageSocket {
	if (!messageSocketInstance) {
		messageSocketInstance = new MessageSocket(callbacks);
	}
	return messageSocketInstance;
}

/**
 * Disconnect and clear the message socket instance.
 */
export function disconnectMessageSocket(): void {
	if (messageSocketInstance) {
		messageSocketInstance.disconnect();
		messageSocketInstance = null;
	}
}
