/**
 * Signal Integration Tests
 *
 * Tests for Signal protocol integration including:
 * - Provisioning URL parsing and generation
 * - Device linking flow
 * - Message encryption basics
 */

import {
	buildProvisioningUrl,
	parseProvisioningUrl,
} from '../src/utils/signal/device-link';

// Mock the libsignal-client module
jest.mock('react-native-libsignal-client');

// Mock react-native-keychain
jest.mock('react-native-keychain');

// Mock MMKV
jest.mock('react-native-mmkv', () => {
	return {
		MMKV: jest.fn().mockImplementation(() => ({
			set: jest.fn(),
			getString: jest.fn(),
			getNumber: jest.fn(),
			contains: jest.fn(() => false),
			delete: jest.fn(),
			getAllKeys: jest.fn(() => []),
			clearAll: jest.fn(),
		})),
	};
});

describe('Signal Integration', () => {
	describe('Provisioning URL', () => {
		it('should build a valid provisioning URL', () => {
			const { PublicKey } = require('react-native-libsignal-client');
			const mockPublicKey = new PublicKey();

			const url = buildProvisioningUrl('test-uuid-123', mockPublicKey);

			expect(url).toContain('sgnl://linkdevice');
			expect(url).toContain('uuid=test-uuid-123');
			expect(url).toContain('pub_key=');
			expect(url).toContain('capabilities=backup5');
		});

		it('should parse a valid provisioning URL', () => {
			const testUrl =
				'sgnl://linkdevice?uuid=abc123&pub_key=AQID&capabilities=backup5';

			const parsed = parseProvisioningUrl(testUrl);

			expect(parsed).not.toBeNull();
			expect(parsed?.deviceUuid).toBe('abc123');
			expect(parsed?.publicKey).toBeInstanceOf(Uint8Array);
			expect(parsed?.capabilities).toContain('backup5');
		});

		it('should return null for invalid protocol', () => {
			const testUrl = 'https://linkdevice?uuid=abc123&pub_key=AQID';

			const parsed = parseProvisioningUrl(testUrl);

			expect(parsed).toBeNull();
		});

		it('should return null for missing uuid', () => {
			const testUrl = 'sgnl://linkdevice?pub_key=AQID';

			const parsed = parseProvisioningUrl(testUrl);

			expect(parsed).toBeNull();
		});

		it('should return null for missing pub_key', () => {
			const testUrl = 'sgnl://linkdevice?uuid=abc123';

			const parsed = parseProvisioningUrl(testUrl);

			expect(parsed).toBeNull();
		});
	});

	describe('Message Sender', () => {
		it('should identify contacts with Signal identity', () => {
			const { hasSignalIdentity } =
				require('../src/utils/signal/message-sender');

			const contactWithSignal = {
				name: 'Alice',
				signal: { aci: 'uuid-123', phoneNumber: '+1234567890' },
			};

			const contactWithoutSignal: { name: string; signal?: { aci?: string } } = {
				name: 'Bob',
			};

			expect(hasSignalIdentity(contactWithSignal.signal)).toBe(true);
			expect(hasSignalIdentity(contactWithoutSignal.signal)).toBe(false);
			expect(hasSignalIdentity(undefined)).toBe(false);
		});

		it('should filter contacts with Signal identity', () => {
			const { filterSignalContacts } =
				require('../src/utils/signal/message-sender');

			const contacts = [
				{ name: 'Alice', signal: { aci: 'uuid-1' } },
				{ name: 'Bob' },
				{ name: 'Charlie', signal: { phoneNumber: '+1234567890' } },
				{ name: 'Dave', signal: {} },
			];

			const signalContacts = filterSignalContacts(contacts);

			expect(signalContacts).toHaveLength(2);
			expect(signalContacts[0].name).toBe('Alice');
			expect(signalContacts[1].name).toBe('Charlie');
		});
	});

	describe('Protobuf Messages', () => {
		it('should encode and decode provision envelope', () => {
			const {
				encodeProvisionEnvelope,
				decodeProvisionEnvelope,
			} = require('../src/utils/signal/protos/provisioning');

			const envelope = {
				publicKey: new Uint8Array([1, 2, 3]),
				body: new Uint8Array([4, 5, 6]),
			};

			const encoded = encodeProvisionEnvelope(envelope);
			expect(encoded).toBeInstanceOf(Uint8Array);

			const decoded = decodeProvisionEnvelope(encoded);
			// Compare as arrays to avoid Buffer/Uint8Array type differences
			expect(Array.from(decoded.publicKey)).toEqual(Array.from(envelope.publicKey));
			expect(Array.from(decoded.body)).toEqual(Array.from(envelope.body));
		});

		it('should encode and decode provision message', () => {
			const {
				encodeProvisionMessage,
				decodeProvisionMessage,
			} = require('../src/utils/signal/protos/provisioning');

			const message = {
				aciIdentityKeyPublic: new Uint8Array([1, 2, 3]),
				aciIdentityKeyPrivate: new Uint8Array([4, 5, 6]),
				number: '+1234567890',
				provisioningCode: 'code123',
				aci: 'aci-uuid',
			};

			const encoded = encodeProvisionMessage(message);
			expect(encoded).toBeInstanceOf(Uint8Array);

			const decoded = decodeProvisionMessage(encoded);
			expect(decoded.number).toBe(message.number);
			expect(decoded.provisioningCode).toBe(message.provisioningCode);
			expect(decoded.aci).toBe(message.aci);
		});
	});

	describe('Signal Store', () => {
		beforeEach(() => {
			jest.clearAllMocks();
		});

		it('should check if Signal is linked', () => {
			const { isSignalLinked } = require('../src/storage/signal-store');

			// By default, not linked (contains returns false)
			expect(isSignalLinked()).toBe(false);
		});

		it('should return null for missing account info', () => {
			const { getAccountInfo } = require('../src/storage/signal-store');

			expect(getAccountInfo()).toBeNull();
		});
	});
});

describe('Scanner Types', () => {
	it('should include signalLink in QR data types', () => {
		const { EQRDataType } = require('../src/utils/scanner/types');

		expect(EQRDataType.signalLink).toBe('signalLink');
	});
});

describe('Contact Types', () => {
	it('should support Signal identity in contact record', () => {
		// Type check - this will fail compilation if types are wrong
		const contact: import('../src/store/types/slashtags').IContactRecord = {
			url: 'slash://test',
			name: 'Test Contact',
			signal: {
				aci: 'uuid-123',
				pni: 'pni-456',
				phoneNumber: '+1234567890',
			},
		};

		expect(contact.signal?.aci).toBe('uuid-123');
		expect(contact.signal?.pni).toBe('pni-456');
		expect(contact.signal?.phoneNumber).toBe('+1234567890');
	});
});

describe('CDSI (Contact Discovery Service)', () => {
	describe('E.164 Phone Number Formatting', () => {
		it('should format US phone number without country code', () => {
			const { formatE164 } = require('../src/utils/signal/cdsi');

			expect(formatE164('4155551234')).toBe('+14155551234');
		});

		it('should format US phone number with country code', () => {
			const { formatE164 } = require('../src/utils/signal/cdsi');

			expect(formatE164('14155551234')).toBe('+14155551234');
		});

		it('should preserve leading + in E.164 format', () => {
			const { formatE164 } = require('../src/utils/signal/cdsi');

			expect(formatE164('+14155551234')).toBe('+14155551234');
		});

		it('should strip non-digit characters', () => {
			const { formatE164 } = require('../src/utils/signal/cdsi');

			expect(formatE164('(415) 555-1234')).toBe('+14155551234');
			expect(formatE164('+1 (415) 555-1234')).toBe('+14155551234');
		});

		it('should handle international numbers', () => {
			const { formatE164 } = require('../src/utils/signal/cdsi');

			expect(formatE164('+442071234567')).toBe('+442071234567');
			expect(formatE164('+81312345678')).toBe('+81312345678');
		});
	});

	describe('libsignal CDSI Integration', () => {
		beforeEach(() => {
			jest.clearAllMocks();
		});

		it('should have CdsiEnvironment enum', () => {
			const { CdsiEnvironment } = require('react-native-libsignal-client');

			expect(CdsiEnvironment.Production).toBe('production');
			expect(CdsiEnvironment.Staging).toBe('staging');
		});

		it('should report CDSI as available when native module exists', () => {
			const { isCdsiAvailable } = require('react-native-libsignal-client');

			expect(isCdsiAvailable()).toBe(true);
		});

		it('should perform CDSI lookup with phone numbers', async () => {
			const { cdsiLookup, CdsiEnvironment } = require('react-native-libsignal-client');

			const result = await cdsiLookup({
				username: 'test-username',
				password: 'test-password',
				environment: CdsiEnvironment.Production,
				phoneNumbers: ['+14155551234', '+14155551235'],
				appName: 'Bitkit/1.0',
			});

			expect(result).toBeDefined();
			expect(result.entries).toHaveLength(2);
			expect(result.token).toBe('mock-cdsi-token-base64');
			expect(result.debugPermitsUsed).toBe(2);
		});

		it('should return ACI/PNI for registered users', async () => {
			const { cdsiLookup, CdsiEnvironment } = require('react-native-libsignal-client');

			const result = await cdsiLookup({
				username: 'test-username',
				password: 'test-password',
				environment: CdsiEnvironment.Production,
				phoneNumbers: ['+14155551234'], // Ends in 4 (even), should have ACI
				appName: 'Bitkit/1.0',
			});

			const entry = result.entries[0];
			expect(entry.e164).toBe('+14155551234');
			expect(entry.aci).toBe('aci-14155551234');
			expect(entry.pni).toBe('pni-14155551234');
		});

		it('should return null ACI/PNI for unregistered users', async () => {
			const { cdsiLookup, CdsiEnvironment } = require('react-native-libsignal-client');

			const result = await cdsiLookup({
				username: 'test-username',
				password: 'test-password',
				environment: CdsiEnvironment.Production,
				phoneNumbers: ['+14155551235'], // Ends in 5 (odd), mock returns null
				appName: 'Bitkit/1.0',
			});

			const entry = result.entries[0];
			expect(entry.e164).toBe('+14155551235');
			expect(entry.aci).toBeNull();
			expect(entry.pni).toBeNull();
		});

		it('should support incremental lookups with token', async () => {
			const { cdsiLookup, CdsiEnvironment } = require('react-native-libsignal-client');

			// First lookup
			const firstResult = await cdsiLookup({
				username: 'test-username',
				password: 'test-password',
				environment: CdsiEnvironment.Production,
				phoneNumbers: ['+14155551234'],
				appName: 'Bitkit/1.0',
			});

			// Incremental lookup using token from first lookup
			const incrementalResult = await cdsiLookup({
				username: 'test-username',
				password: 'test-password',
				environment: CdsiEnvironment.Production,
				phoneNumbers: ['+14155551236'],
				prevPhoneNumbers: ['+14155551234'],
				token: firstResult.token,
				appName: 'Bitkit/1.0',
			});

			expect(incrementalResult).toBeDefined();
			expect(incrementalResult.entries).toHaveLength(1);
		});

		it('should support service IDs with profile keys for existing contacts', async () => {
			const { cdsiLookup, CdsiEnvironment } = require('react-native-libsignal-client');

			const result = await cdsiLookup({
				username: 'test-username',
				password: 'test-password',
				environment: CdsiEnvironment.Production,
				phoneNumbers: ['+14155551234'],
				serviceIdsAndProfileKeys: [
					{
						aci: 'existing-contact-aci',
						profileKey: 'base64-profile-key-32-bytes',
					},
				],
				appName: 'Bitkit/1.0',
			});

			expect(result).toBeDefined();
			expect(cdsiLookup).toHaveBeenCalledWith(
				expect.objectContaining({
					serviceIdsAndProfileKeys: [
						expect.objectContaining({ aci: 'existing-contact-aci' }),
					],
				})
			);
		});
	});

	describe('CDSI Auth Credentials', () => {
		it('should throw error when not linked', async () => {
			const { getCdsiAuthCredentials } = require('../src/utils/signal/cdsi');

			await expect(getCdsiAuthCredentials()).rejects.toThrow(
				'Not linked to Signal'
			);
		});
	});

	describe('CDSI Availability Check', () => {
		it('should check if CDSI is available via app util', () => {
			const { isCdsiAvailable } = require('../src/utils/signal/cdsi');

			// isCdsiAvailable delegates to libsignal's isCdsiAvailable
			expect(isCdsiAvailable()).toBe(true); // Mock returns true
		});
	});

	describe('App lookupPhoneNumbers function', () => {
		it('should throw when not linked to Signal', async () => {
			const { lookupPhoneNumbers } = require('../src/utils/signal/cdsi');

			await expect(lookupPhoneNumbers(['+14155551234'])).rejects.toThrow(
				'Not linked to Signal'
			);
		});
	});

	describe('Re-exported types', () => {
		it('should export CdsiLookupResult interface shape', () => {
			const { formatE164 } = require('../src/utils/signal/cdsi');

			// Test that formatting works (used for lookup input)
			const formatted = formatE164('+14155551234');
			expect(formatted).toBe('+14155551234');

			// The result shape should match CdsiLookupResult
			const mockResult: import('../src/utils/signal/cdsi').CdsiLookupResult = {
				e164: '+14155551234',
				aci: 'test-aci',
				pni: 'test-pni',
			};

			expect(mockResult.e164).toBe('+14155551234');
			expect(mockResult.aci).toBe('test-aci');
			expect(mockResult.pni).toBe('test-pni');
		});
	});
});
