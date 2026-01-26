/**
 * Signal Provisioning Protocol Buffer Types
 *
 * TypeScript definitions matching Signal's provisioning.proto
 * Used for encoding/decoding provisioning messages between devices.
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as protobuf from 'protobufjs';

// Define the protobuf schema programmatically to avoid .proto file compilation
const root = new protobuf.Root();

// ProvisionEnvelope - wrapper for encrypted provisioning data
root.define('signal').add(
	new protobuf.Type('ProvisionEnvelope')
		.add(new protobuf.Field('publicKey', 1, 'bytes'))
		.add(new protobuf.Field('body', 2, 'bytes')),
);

// ProvisionMessage - the actual provisioning data (decrypted from envelope)
// Field numbers decoded from actual Signal wire format
root.define('signal').add(
	new protobuf.Type('ProvisionMessage')
		.add(new protobuf.Field('aciIdentityKeyPublic', 1, 'bytes'))
		.add(new protobuf.Field('aciIdentityKeyPrivate', 2, 'bytes'))
		.add(new protobuf.Field('number', 3, 'string'))
		.add(new protobuf.Field('provisioningCode', 4, 'string'))
		.add(new protobuf.Field('profileKey', 6, 'bytes'))
		.add(new protobuf.Field('aci', 8, 'string'))
		.add(new protobuf.Field('readReceipts', 9, 'bool'))
		.add(new protobuf.Field('pni', 10, 'string'))
		.add(new protobuf.Field('pniIdentityKeyPublic', 11, 'bytes'))
		.add(new protobuf.Field('pniIdentityKeyPrivate', 12, 'bytes'))
		.add(new protobuf.Field('masterKey', 13, 'bytes'))
		.add(new protobuf.Field('accountEntropyPool', 15, 'string'))
		.add(new protobuf.Field('mediaRootBackupKey', 16, 'bytes'))
		.add(new protobuf.Field('aciBinary', 17, 'bytes'))
		.add(new protobuf.Field('pniBinary', 18, 'bytes')),
);

// WebSocket request/response messages for provisioning
root.define('signal').add(
	new protobuf.Type('WebSocketRequestMessage')
		.add(new protobuf.Field('verb', 1, 'string'))
		.add(new protobuf.Field('path', 2, 'string'))
		.add(new protobuf.Field('body', 3, 'bytes'))
		.add(new protobuf.Field('headers', 5, 'string', 'repeated'))
		.add(new protobuf.Field('id', 4, 'uint64')),
);

root.define('signal').add(
	new protobuf.Type('WebSocketResponseMessage')
		.add(new protobuf.Field('id', 1, 'uint64'))
		.add(new protobuf.Field('status', 2, 'uint32'))
		.add(new protobuf.Field('message', 3, 'string'))
		.add(new protobuf.Field('headers', 5, 'string', 'repeated'))
		.add(new protobuf.Field('body', 4, 'bytes')),
);

root.define('signal').add(
	new protobuf.Type('WebSocketMessage')
		.add(
			new protobuf.Enum('Type').add('UNKNOWN', 0).add('REQUEST', 1).add('RESPONSE', 2),
		)
		.add(new protobuf.Field('type', 1, 'Type'))
		.add(new protobuf.Field('request', 2, 'WebSocketRequestMessage'))
		.add(new protobuf.Field('response', 3, 'WebSocketResponseMessage')),
);

// ProvisioningUuid - response from server with device UUID
root.define('signal').add(
	new protobuf.Type('ProvisioningUuid').add(
		new protobuf.Field('uuid', 1, 'string'),
	),
);

// Get type references
const ProvisionEnvelope = root.lookupType('signal.ProvisionEnvelope');
const ProvisionMessage = root.lookupType('signal.ProvisionMessage');
const WebSocketMessage = root.lookupType('signal.WebSocketMessage');
const WebSocketRequestMessage = root.lookupType('signal.WebSocketRequestMessage');
const WebSocketResponseMessage = root.lookupType('signal.WebSocketResponseMessage');
const ProvisioningUuid = root.lookupType('signal.ProvisioningUuid');

// TypeScript interfaces
export interface IProvisionEnvelope {
	publicKey: Uint8Array;
	body: Uint8Array;
}

export interface IProvisionMessage {
	aciIdentityKeyPublic: Uint8Array;
	aciIdentityKeyPrivate: Uint8Array;
	number: string;
	provisioningCode: string;
	profileKey?: Uint8Array;
	aci: string;
	readReceipts?: boolean;
	pni?: string;
	pniIdentityKeyPublic?: Uint8Array;
	pniIdentityKeyPrivate?: Uint8Array;
	masterKey?: Uint8Array;
	accountEntropyPool?: string;
	mediaRootBackupKey?: Uint8Array;
	aciBinary?: Uint8Array;
	pniBinary?: Uint8Array;
}

export interface IWebSocketRequestMessage {
	verb: string;
	path: string;
	body?: Uint8Array;
	headers?: string[];
	id: number;
}

export interface IWebSocketResponseMessage {
	id: number;
	status: number;
	message?: string;
	headers?: string[];
	body?: Uint8Array;
}

export enum WebSocketMessageType {
	UNKNOWN = 0,
	REQUEST = 1,
	RESPONSE = 2,
}

export interface IWebSocketMessage {
	type: WebSocketMessageType;
	request?: IWebSocketRequestMessage;
	response?: IWebSocketResponseMessage;
}

export interface IProvisioningUuid {
	uuid: string;
}

// Encoding functions
export function encodeProvisionEnvelope(envelope: IProvisionEnvelope): Uint8Array {
	const message = ProvisionEnvelope.create(envelope);
	return ProvisionEnvelope.encode(message).finish();
}

export function decodeProvisionEnvelope(data: Uint8Array): IProvisionEnvelope {
	const message = ProvisionEnvelope.decode(data);
	return ProvisionEnvelope.toObject(message) as IProvisionEnvelope;
}

export function encodeProvisionMessage(msg: IProvisionMessage): Uint8Array {
	const message = ProvisionMessage.create(msg);
	return ProvisionMessage.encode(message).finish();
}

export function decodeProvisionMessage(data: Uint8Array): IProvisionMessage {
	try {
		console.log('decodeProvisionMessage: Input length:', data.length);
		
		// Manual field parsing to see ALL fields in the wire format
		let offset = 0;
		const fields: Record<number, any> = {};
		while (offset < data.length) {
			const tag = data[offset];
			const fieldNumber = tag >> 3;
			const wireType = tag & 0x7;
			console.log(`decodeProvisionMessage: Field ${fieldNumber}, wireType ${wireType} at offset ${offset}`);
			
			if (wireType === 2) { // Length-delimited
				offset++;
				let length = 0;
				let shift = 0;
				while (data[offset] & 0x80) {
					length |= (data[offset] & 0x7f) << shift;
					shift += 7;
					offset++;
				}
				length |= (data[offset] & 0x7f) << shift;
				offset++;
				
				const value = data.slice(offset, offset + length);
				// Try to decode as string
				try {
					const str = new TextDecoder().decode(value);
					if (/^[\x20-\x7E]+$/.test(str)) {
						fields[fieldNumber] = str;
						console.log(`decodeProvisionMessage: Field ${fieldNumber} = "${str.slice(0, 50)}${str.length > 50 ? '...' : ''}"`);
					} else {
						fields[fieldNumber] = `[bytes:${length}]`;
					}
				} catch {
					fields[fieldNumber] = `[bytes:${length}]`;
				}
				offset += length;
			} else if (wireType === 0) { // Varint
				offset++;
				let value = 0;
				let shift = 0;
				while (data[offset] & 0x80) {
					value |= (data[offset] & 0x7f) << shift;
					shift += 7;
					offset++;
				}
				value |= (data[offset] & 0x7f) << shift;
				offset++;
				fields[fieldNumber] = value;
				console.log(`decodeProvisionMessage: Field ${fieldNumber} = ${value}`);
			} else {
				console.log(`decodeProvisionMessage: Unknown wireType ${wireType}, stopping`);
				break;
			}
		}
		
		console.log('decodeProvisionMessage: ALL FIELDS:', JSON.stringify(fields));
		
		// Now use protobufjs to decode
		const message = ProvisionMessage.decode(data);
		const result = ProvisionMessage.toObject(message, {
			bytes: Uint8Array,
			defaults: false,
		}) as IProvisionMessage;
		
		console.log('decodeProvisionMessage: protobufjs provisioningCode:', result.provisioningCode);
		console.log('decodeProvisionMessage: protobufjs aci:', result.aci);
		console.log('decodeProvisionMessage: protobufjs number:', result.number);
		
		return result;
	} catch (error) {
		console.error('decodeProvisionMessage: Parse error:', error);
		throw error;
	}
}

export function encodeWebSocketMessage(msg: IWebSocketMessage): Uint8Array {
	const message = WebSocketMessage.create(msg);
	return WebSocketMessage.encode(message).finish();
}

export function decodeWebSocketMessage(data: Uint8Array): IWebSocketMessage {
	const message = WebSocketMessage.decode(data);
	return WebSocketMessage.toObject(message) as IWebSocketMessage;
}

export function encodeWebSocketRequest(req: IWebSocketRequestMessage): Uint8Array {
	const message = WebSocketRequestMessage.create(req);
	return WebSocketRequestMessage.encode(message).finish();
}

export function encodeWebSocketResponse(res: IWebSocketResponseMessage): Uint8Array {
	const message = WebSocketResponseMessage.create(res);
	return WebSocketResponseMessage.encode(message).finish();
}

export function decodeProvisioningUuid(data: Uint8Array): IProvisioningUuid {
	const message = ProvisioningUuid.decode(data);
	return ProvisioningUuid.toObject(message) as IProvisioningUuid;
}

export {
	ProvisionEnvelope,
	ProvisionMessage,
	WebSocketMessage,
	WebSocketRequestMessage,
	WebSocketResponseMessage,
	ProvisioningUuid,
	root as protobufRoot,
};
