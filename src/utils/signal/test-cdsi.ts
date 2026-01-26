/**
 * Test script for Signal CDSI (Contact Discovery Service)
 * 
 * This tests the CDSI phone number lookup functionality.
 * 
 * Usage: Import and call testCdsiLookup() from a test screen
 */

import { getCdsiAuthCredentials, lookupPhoneNumbers, formatE164 } from './cdsi';
import { getAccountInfo, getAuthPassword } from '../../storage/signal-store';

/**
 * Test just the CDSI authentication step
 * This verifies we can get CDSI credentials from /v2/directory/auth
 */
export async function testCdsiAuth(): Promise<void> {
	console.log('=== CDSI Auth Test ===');
	console.log('Testing GET /v2/directory/auth endpoint...');

	try {
		// First check if we have account info
		const accountInfo = await getAccountInfo();
		const password = await getAuthPassword();

		if (!accountInfo || !password) {
			console.error('Not linked to Signal - no account info available');
			console.log('Please link to Signal first using device linking');
			return;
		}

		console.log('Account info available:');
		console.log('  ACI:', accountInfo.aci?.substring(0, 8) + '...');
		console.log('  Device ID:', accountInfo.deviceId);

		// Try to get CDSI credentials
		console.log('\nFetching CDSI auth credentials...');
		const auth = await getCdsiAuthCredentials();

		console.log('\n✅ CDSI Auth Successful!');
		console.log('  CDSI Username:', auth.username);
		console.log('  CDSI Password length:', auth.password?.length || 0);
		console.log('  (CDSI credentials are different from account credentials)');

	} catch (error) {
		console.error('\n❌ CDSI Auth Failed:', error);
	}
}

/**
 * Test the full CDSI phone number lookup
 */
export async function testCdsiLookup(testPhoneNumber?: string): Promise<void> {
	console.log('=== CDSI Phone Lookup Test ===');

	// Use a test phone number or default
	const phoneNumber = testPhoneNumber || '+15551234567';
	console.log(`Testing lookup for: ${phoneNumber}`);
	console.log(`Formatted E.164: ${formatE164(phoneNumber)}`);

	try {
		// First verify auth works
		console.log('\n--- Step 1: Verify CDSI auth ---');
		await testCdsiAuth();

		// Now try the actual lookup
		console.log('\n--- Step 2: Perform CDSI lookup ---');
		console.log('Note: This requires native libsignal CDSI support');

		const results = await lookupPhoneNumbers([phoneNumber]);

		console.log('\n✅ CDSI Lookup Successful!');
		console.log(`Found ${results.length} results:`);

		for (const result of results) {
			console.log(`  ${result.e164}:`);
			console.log(`    ACI: ${result.aci || '(not registered)'}`);
			console.log(`    PNI: ${result.pni || '(not registered)'}`);
		}

	} catch (error) {
		console.error('\n❌ CDSI Lookup Failed:', error);
		console.error('Error details:', JSON.stringify(error, null, 2));

		// Provide helpful error messages
		const errorStr = String(error);
		if (errorStr.includes('404')) {
			console.log('\n💡 404 Error Analysis:');
			console.log('   - Could be from /v2/directory/auth endpoint');
			console.log('   - Could be from CDSI enclave connection');
			console.log('   - Try running testCdsiAuth() separately to isolate');
		} else if (errorStr.includes('401')) {
			console.log('\n💡 401 Error - Authentication failed');
			console.log('   - Check if account is properly linked');
			console.log('   - Device may need to be re-linked');
		} else if (errorStr.includes('429')) {
			console.log('\n💡 429 Error - Rate limited');
			console.log('   - Wait a while before retrying');
		}
	}
}

/**
 * Quick test that only tests auth (no native module required)
 */
export async function testCdsiAuthOnly(): Promise<boolean> {
	try {
		const auth = await getCdsiAuthCredentials();
		return !!(auth.username && auth.password);
	} catch {
		return false;
	}
}

/**
 * Test fetching PreKeys using PNI instead of ACI
 */
export async function testPreKeyFetchWithPni(pni: string): Promise<void> {
	console.log('=== PreKey Fetch with PNI Test ===');
	console.log(`Testing PreKey fetch for PNI: ${pni}`);

	const SIGNAL_SERVER = 'https://chat.signal.org';

	try {
		const accountInfo = await getAccountInfo();
		const password = await getAuthPassword();

		if (!accountInfo || !password) {
			console.error('Not linked to Signal');
			return;
		}

		const credentials = `${accountInfo.aci}.${accountInfo.deviceId}:${password}`;
		const authHeader = `Basic ${Buffer.from(credentials).toString('base64')}`;

		// The PNI from CDSI looks like "PNI:uuid" - we need to use it as-is
		// Signal's API accepts service IDs in the format "PNI:uuid" or just "uuid" for ACI
		console.log('\nFetching PreKeys for PNI...');

		const response = await fetch(`${SIGNAL_SERVER}/v2/keys/${pni}/*`, {
			method: 'GET',
			headers: {
				'Authorization': authHeader,
				'Accept': 'application/json',
			},
		});

		console.log('Response status:', response.status);

		if (response.status === 200) {
			const data = await response.json();
			console.log('\n✅ PreKey fetch successful!');
			console.log('Identity Key:', data.identityKey ? 'present' : 'missing');
			console.log('Devices:', data.devices?.length || 0);

			if (data.devices) {
				for (const device of data.devices) {
					console.log(`  Device ${device.deviceId}:`);
					console.log(`    registrationId: ${device.registrationId}`);
					console.log(`    signedPreKey: ${device.signedPreKey ? 'present' : 'missing'}`);
					console.log(`    preKey: ${device.preKey ? 'present' : 'missing'}`);
					console.log(`    pqPreKey: ${device.pqPreKey ? 'present' : 'missing'}`);
				}
			}

			return data;
		} else {
			const errorText = await response.text();
			console.log('\n❌ PreKey fetch failed:', response.status, errorText);
		}
	} catch (error) {
		console.error('\n❌ PreKey fetch error:', error);
	}
}

// Export all test functions
export default {
	testCdsiAuth,
	testCdsiLookup,
	testCdsiAuthOnly,
	testPreKeyFetchWithPni,
};
