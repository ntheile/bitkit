/**
 * Test script for Signal username lookup
 * 
 * Usage: Run from Metro bundler console or add to a test screen
 */

import {
	lookupByUsername,
	hashUsername,
	isUsernameLookupAvailable,
} from './username';

export async function testUsernameLookup(): Promise<void> {
	console.log('=== Username Lookup Test ===');
	
	// Check if the module is available
	const isAvailable = isUsernameLookupAvailable();
	console.log(`Username lookup available: ${isAvailable}`);
	
	if (!isAvailable) {
		console.error('Username lookup module not available!');
		return;
	}

	// Test 1: Hash a username
	console.log('\n--- Test 1: Hash a username ---');
	try {
		const testUsername = 'test.01';
		const hash = await hashUsername(testUsername);
		console.log(`Username "${testUsername}" hash: ${hash}`);
	} catch (error) {
		console.error('Hash test failed:', error);
	}

	// Test 2: Look up a known username (you'll need to replace with a real one)
	console.log('\n--- Test 2: Look up username ---');
	try {
		// Replace with an actual Signal username to test
		const testUsername = 'signalapp.01'; // Example - may not exist
		console.log(`Looking up username: ${testUsername}`);
		
		const result = await lookupByUsername(testUsername, 'production');
		
		if (result) {
			console.log(`Found! Username: ${result.username}, ACI: ${result.aci}`);
		} else {
			console.log('Username not found (this is expected for non-existent usernames)');
		}
	} catch (error) {
		console.error('Lookup test failed:', error);
	}

	// Test 3: Look up non-existent username
	console.log('\n--- Test 3: Look up non-existent username ---');
	try {
		const fakeUsername = 'thisisnotarealuser123456.99';
		console.log(`Looking up username: ${fakeUsername}`);
		
		const result = await lookupByUsername(fakeUsername, 'production');
		
		if (result) {
			console.log(`Unexpectedly found: ${result.aci}`);
		} else {
			console.log('Username not found (expected)');
		}
	} catch (error) {
		console.error('Lookup test failed:', error);
	}

	// Test 4: Invalid username format
	console.log('\n--- Test 4: Invalid username format ---');
	try {
		const invalidUsername = 'nodiscriminator';
		console.log(`Looking up invalid username: ${invalidUsername}`);
		
		await lookupByUsername(invalidUsername, 'production');
		console.error('Should have thrown an error!');
	} catch (error) {
		console.log(`Correctly caught error: ${error}`);
	}

	console.log('\n=== Tests Complete ===');
}

// Export for use in React components
export default testUsernameLookup;
