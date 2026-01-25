/**
 * Mock for react-native-libsignal-client
 *
 * Provides test doubles for Signal protocol primitives.
 */

// Mock key generation
const mockKeyBytes = new Uint8Array(32).fill(0x42);
const mockPublicKeyBytes = new Uint8Array(33).fill(0x43);

class MockPrivateKey {
	serialized: Uint8Array;

	constructor(data?: Uint8Array) {
		this.serialized = data || mockKeyBytes;
	}

	static generate(): MockPrivateKey {
		return new MockPrivateKey();
	}

	static _fromSerialized(data: Uint8Array): MockPrivateKey {
		return new MockPrivateKey(data);
	}

	static deserialize(data: Uint8Array): MockPrivateKey {
		return new MockPrivateKey(data);
	}

	serialize(): Uint8Array {
		return this.serialized;
	}

	getPublicKey(): MockPublicKey {
		return new MockPublicKey();
	}

	agree(_publicKey: MockPublicKey): Uint8Array {
		// Return mock shared secret
		return new Uint8Array(32).fill(0x44);
	}
}

class MockPublicKey {
	serialized: Uint8Array;

	constructor(data?: Uint8Array) {
		this.serialized = data || mockPublicKeyBytes;
	}

	static _fromSerialized(data: Uint8Array): MockPublicKey {
		return new MockPublicKey(data);
	}

	static deserialize(data: Uint8Array): MockPublicKey {
		return new MockPublicKey(data);
	}

	serialize(): Uint8Array {
		return this.serialized;
	}
}

class MockIdentityKeyPair {
	private _publicKey: MockPublicKey;
	private _privateKey: MockPrivateKey;

	constructor(publicKey: MockPublicKey, privateKey: MockPrivateKey) {
		this._publicKey = publicKey;
		this._privateKey = privateKey;
	}

	static new(publicKey: MockPublicKey, privateKey: MockPrivateKey): MockIdentityKeyPair {
		return new MockIdentityKeyPair(publicKey, privateKey);
	}

	static generate(): MockIdentityKeyPair {
		return new MockIdentityKeyPair(new MockPublicKey(), MockPrivateKey.generate());
	}

	getPublicKey(): MockPublicKey {
		return this._publicKey;
	}

	getPrivateKey(): MockPrivateKey {
		return this._privateKey;
	}
}

class MockProtocolAddress {
	private _name: string;
	private _deviceId: number;

	constructor(name: string, deviceId: number) {
		this._name = name;
		this._deviceId = deviceId;
	}

	static new(name: string, deviceId: number): MockProtocolAddress {
		return new MockProtocolAddress(name, deviceId);
	}

	name(): string {
		return this._name;
	}

	deviceId(): number {
		return this._deviceId;
	}
}

class MockSessionBuilder {
	processPreKeyBundle(): Promise<void> {
		return Promise.resolve();
	}
}

// Mock encryption functions
const mockAes256Cbc = {
	new: jest.fn(() => ({
		encrypt: jest.fn((_key: Uint8Array, _iv: Uint8Array, plaintext: Uint8Array): Uint8Array => {
			// Return mock ciphertext (same length as plaintext for simplicity)
			return new Uint8Array(plaintext.length).fill(0x45);
		}),
		decrypt: jest.fn((_key: Uint8Array, _iv: Uint8Array, ciphertext: Uint8Array): Uint8Array => {
			// Return mock plaintext
			return new Uint8Array(ciphertext.length).fill(0x46);
		}),
	})),
};

const mockSignHmacSha256 = jest.fn(
	(_key: Uint8Array, _data: Uint8Array): Uint8Array => {
		// Return mock HMAC (32 bytes)
		return new Uint8Array(32).fill(0x47);
	},
);

const hkdf = jest.fn(
	(
		_length: number,
		_inputKeyMaterial: Uint8Array,
		_info: Uint8Array,
		_salt: Uint8Array,
	): Uint8Array => {
		// Return mock derived keys
		return new Uint8Array(_length).fill(0x48);
	},
);

const signalEncrypt = jest.fn(async (): Promise<Uint8Array> => {
	return new Uint8Array(100).fill(0x49);
});

const signalDecrypt = jest.fn(async (): Promise<Uint8Array> => {
	return new Uint8Array(50).fill(0x4a);
});

const sealedSenderEncryptMessage = jest.fn(async (): Promise<Uint8Array> => {
	return new Uint8Array(150).fill(0x4b);
});

const sealedSenderDecryptMessage = jest.fn(async (): Promise<Uint8Array> => {
	return new Uint8Array(50).fill(0x4c);
});

// CDSI (Contact Discovery Service) mocks
const CdsiEnvironment = {
	Staging: 'staging',
	Production: 'production',
};

const cdsiLookup = jest.fn(async (options: {
	username: string;
	password: string;
	environment: string;
	phoneNumbers: string[];
	appName: string;
	prevPhoneNumbers?: string[];
	serviceIdsAndProfileKeys?: Array<{ aci: string; profileKey: string }>;
	token?: string;
}) => {
	// Return mock CDSI response
	const entries = options.phoneNumbers.map((e164) => ({
		e164,
		// Return mock ACI/PNI for numbers ending in even digit
		aci: parseInt(e164.slice(-1)) % 2 === 0
			? `aci-${e164.replace('+', '')}`
			: null,
		pni: parseInt(e164.slice(-1)) % 2 === 0
			? `pni-${e164.replace('+', '')}`
			: null,
	}));

	return {
		entries,
		token: 'mock-cdsi-token-base64',
		debugPermitsUsed: options.phoneNumbers.length,
	};
});

const isCdsiAvailable = jest.fn(() => true);

module.exports = {
	PrivateKey: MockPrivateKey,
	PublicKey: MockPublicKey,
	IdentityKeyPair: MockIdentityKeyPair,
	ProtocolAddress: MockProtocolAddress,
	SessionBuilder: MockSessionBuilder,
	Aes256Cbc: mockAes256Cbc,
	signHmacSha256: mockSignHmacSha256,
	hkdf,
	signalEncrypt,
	signalDecrypt,
	sealedSenderEncryptMessage,
	sealedSenderDecryptMessage,
	// CDSI exports
	CdsiEnvironment,
	cdsiLookup,
	isCdsiAvailable,
};
