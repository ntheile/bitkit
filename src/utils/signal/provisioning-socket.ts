/**
 * Signal Provisioning WebSocket
 *
 * Handles WebSocket connection to Signal's provisioning endpoint.
 * Used for secondary device linking flow.
 *
 * Adapted from Signal-iOS ProvisioningSocket.swift
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
	decodeWebSocketMessage,
	encodeWebSocketMessage,
	decodeProvisionEnvelope,
	decodeProvisioningUuid,
	WebSocketMessageType,
	type IWebSocketMessage,
	type IProvisionEnvelope,
} from './protos/provisioning';

// Signal server endpoints
const SIGNAL_SERVER = 'chat.signal.org';
const PROVISIONING_PATH = '/v1/websocket/provisioning/';
const USER_AGENT = 'OWI'; // Signal iOS user agent identifier

export interface ProvisioningSocketCallbacks {
	onDeviceUuidReceived: (uuid: string) => void;
	onProvisionEnvelopeReceived: (envelope: IProvisionEnvelope) => void;
	onError: (error: Error) => void;
	onClose: () => void;
}

export class ProvisioningSocket {
	private ws: WebSocket | null = null;
	private callbacks: ProvisioningSocketCallbacks;
	private requestId = 0;
	private keepAliveInterval: ReturnType<typeof setInterval> | null = null;
	private readonly serverUrl: string;

	constructor(callbacks: ProvisioningSocketCallbacks, customServer?: string) {
		this.callbacks = callbacks;
		const server = customServer || SIGNAL_SERVER;
		this.serverUrl = `wss://${server}${PROVISIONING_PATH}?agent=${USER_AGENT}`;
	}

	/**
	 * Connect to the Signal provisioning WebSocket endpoint.
	 */
	connect(): void {
		if (this.ws) {
			console.warn('ProvisioningSocket: Already connected');
			return;
		}

		console.log('ProvisioningSocket: Connecting to', this.serverUrl);

		try {
			this.ws = new WebSocket(this.serverUrl);
			// @ts-expect-error - binaryType exists on WebSocket in React Native
			this.ws.binaryType = 'arraybuffer';

			this.ws.onopen = this.handleOpen.bind(this);
			this.ws.onmessage = this.handleMessage.bind(this);
			this.ws.onerror = this.handleError.bind(this);
			this.ws.onclose = this.handleClose.bind(this);
		} catch (error) {
			console.error('ProvisioningSocket: Failed to create WebSocket:', error);
			this.callbacks.onError(
				error instanceof Error ? error : new Error(String(error)),
			);
		}
	}

	/**
	 * Disconnect from the provisioning socket.
	 */
	disconnect(): void {
		this.stopKeepAlive();

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
		console.log('ProvisioningSocket: Connected');
		this.startKeepAlive();
	}

	private handleMessage(event: WebSocketMessageEvent): void {
		try {
			const data = new Uint8Array(event.data as ArrayBuffer);
			const message = decodeWebSocketMessage(data);

			console.log('ProvisioningSocket: Received message type:', message.type);

			if (message.type === WebSocketMessageType.REQUEST && message.request) {
				this.handleRequest(message);
			} else if (message.type === WebSocketMessageType.RESPONSE && message.response) {
				this.handleResponse(message);
			}
		} catch (error) {
			console.error('ProvisioningSocket: Error parsing message:', error);
			this.callbacks.onError(
				error instanceof Error ? error : new Error(String(error)),
			);
		}
	}

	private handleRequest(message: IWebSocketMessage): void {
		const request = message.request;
		if (!request) return;

		console.log('ProvisioningSocket: Request -', request.verb, request.path);

		// Handle different request types from server
		if (request.verb === 'PUT' && request.path === '/v1/address') {
			// Server is providing our device UUID
			this.handleDeviceUuidRequest(request.body, request.id);
		} else if (request.verb === 'PUT' && request.path === '/v1/message') {
			// Server is forwarding the encrypted provisioning envelope
			this.handleProvisioningEnvelopeRequest(request.body, request.id);
		} else {
			console.warn('ProvisioningSocket: Unknown request:', request.path);
			this.sendAck(request.id);
		}
	}

	private handleResponse(message: IWebSocketMessage): void {
		const response = message.response;
		if (!response) return;

		console.log(
			'ProvisioningSocket: Response - id:',
			response.id,
			'status:',
			response.status,
		);

		// Handle keep-alive responses or other server responses
		if (response.status !== 200) {
			console.warn(
				'ProvisioningSocket: Non-200 response:',
				response.status,
				response.message,
			);
		}
	}

	private handleDeviceUuidRequest(
		body: Uint8Array | undefined,
		requestId: number,
	): void {
		if (!body) {
			this.callbacks.onError(new Error('Device UUID request missing body'));
			this.sendAck(requestId);
			return;
		}

		try {
			const uuidMessage = decodeProvisioningUuid(body);
			console.log('ProvisioningSocket: Received device UUID:', uuidMessage.uuid);
			this.sendAck(requestId);
			this.callbacks.onDeviceUuidReceived(uuidMessage.uuid);
		} catch (error) {
			console.error('ProvisioningSocket: Error parsing UUID:', error);
			this.callbacks.onError(
				error instanceof Error ? error : new Error(String(error)),
			);
			this.sendAck(requestId);
		}
	}

	private handleProvisioningEnvelopeRequest(
		body: Uint8Array | undefined,
		requestId: number,
	): void {
		if (!body) {
			this.callbacks.onError(
				new Error('Provisioning envelope request missing body'),
			);
			this.sendAck(requestId);
			return;
		}

		try {
			const envelope = decodeProvisionEnvelope(body);
			console.log('ProvisioningSocket: Received provisioning envelope');
			this.sendAck(requestId);
			this.callbacks.onProvisionEnvelopeReceived(envelope);
		} catch (error) {
			console.error('ProvisioningSocket: Error parsing envelope:', error);
			this.callbacks.onError(
				error instanceof Error ? error : new Error(String(error)),
			);
			this.sendAck(requestId);
		}
	}

	/**
	 * Send acknowledgement for a server request.
	 */
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

	/**
	 * Send a keep-alive ping to prevent connection timeout.
	 */
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

	/**
	 * Encode and send a WebSocket message.
	 */
	private send(message: IWebSocketMessage): void {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
			console.warn('ProvisioningSocket: Cannot send - socket not open');
			return;
		}

		const encoded = encodeWebSocketMessage(message);
		this.ws.send(encoded);
	}

	private startKeepAlive(): void {
		// Send keep-alive every 30 seconds
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

	private handleError(event: Event): void {
		// Extract more error details if available
		const errorDetails = {
			type: event.type,
			target: this.ws ? {
				url: this.serverUrl,
				readyState: this.ws.readyState,
			} : null,
		};
		console.error('ProvisioningSocket: WebSocket error:', JSON.stringify(errorDetails, null, 2));
		console.error('ProvisioningSocket: Raw event:', event);
		this.callbacks.onError(new Error(`WebSocket connection error: ${JSON.stringify(errorDetails)}`));
	}

	private handleClose(event: CloseEvent): void {
		console.log('ProvisioningSocket: Connection closed - code:', event.code, 'reason:', event.reason, 'wasClean:', event.wasClean);
		this.stopKeepAlive();
		this.ws = null;
		this.callbacks.onClose();
	}
}

export { SIGNAL_SERVER, PROVISIONING_PATH };
