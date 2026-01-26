/**
 * Signal Contacts Sync Service
 *
 * Orchestrates the sync process between device contacts and Signal CDSI.
 * Handles batching, rate limiting, and persisting results.
 */

import store from '../../store';
import {
	addDiscoveredContacts,
	setLastSyncTimestamp,
	setSyncError,
	setSyncProgress,
	setSyncStatus,
} from '../../store/slices/signalContacts';
import { addSignalContact } from '../../store/slices/slashtags';
import { lookupPhoneNumbers, isCdsiAvailable, CdsiLookupResult } from '../signal/cdsi';
import { getAccountInfo } from '../../storage/signal-store';
import {
	buildPhoneToNameMap,
	extractPhoneNumbers,
	getDeviceContacts,
	hasContactsPermission,
	requestContactsPermission,
} from './deviceContacts';

// Batch size for CDSI lookups to respect rate limits
const BATCH_SIZE = 100;

// Delay between batches (ms) to avoid rate limiting
const BATCH_DELAY_MS = 1000;

export interface SyncResult {
	success: boolean;
	error?: string;
	totalContacts: number;
	signalUsersFound: number;
}

/**
 * Check if Signal is linked and ready for contact sync.
 */
export async function isSignalLinked(): Promise<boolean> {
	try {
		const accountInfo = await getAccountInfo();
		return !!(accountInfo?.aci);
	} catch (error) {
		return false;
	}
}

/**
 * Check if CDSI is available for contact discovery.
 */
export function isSyncAvailable(): boolean {
	return isCdsiAvailable();
}

/**
 * Main sync function that discovers Signal users from device contacts.
 *
 * Flow:
 * 1. Check permissions and Signal link status
 * 2. Read device contacts
 * 3. Extract and deduplicate phone numbers
 * 4. Batch lookup via CDSI
 * 5. Store results and update existing contacts with Signal identity
 */
export async function syncContactsWithSignal(): Promise<SyncResult> {
	const dispatch = store.dispatch;

	console.log('Sync: Starting contact sync...');
	dispatch(setSyncStatus('syncing'));
	dispatch(setSyncProgress({ current: 0, total: 0 }));

	try {
		// Step 1: Check prerequisites
		const hasPermission = await hasContactsPermission();
		if (!hasPermission) {
			const permissionStatus = await requestContactsPermission();
			if (permissionStatus !== 'authorized') {
				throw new Error('Contacts permission not granted');
			}
		}

		const signalLinked = await isSignalLinked();
		if (!signalLinked) {
			throw new Error('Signal account not linked. Please link your Signal account first.');
		}

		if (!isCdsiAvailable()) {
			throw new Error('CDSI lookup not available. Native libsignal module required.');
		}

		// Step 2: Read device contacts
		console.log('Sync: Reading device contacts...');
		const deviceContacts = await getDeviceContacts();
		if (deviceContacts.length === 0) {
			console.log('Sync: No contacts found on device');
			dispatch(setSyncStatus('success'));
			dispatch(setLastSyncTimestamp(Date.now()));
			return {
				success: true,
				totalContacts: 0,
				signalUsersFound: 0,
			};
		}

		// Step 3: Extract phone numbers and build name map
		const phoneNumbers = extractPhoneNumbers(deviceContacts);
		const phoneToNameMap = buildPhoneToNameMap(deviceContacts);
		console.log('Sync: Found', phoneNumbers.length, 'unique phone numbers');

		if (phoneNumbers.length === 0) {
			console.log('Sync: No valid phone numbers found');
			dispatch(setSyncStatus('success'));
			dispatch(setLastSyncTimestamp(Date.now()));
			return {
				success: true,
				totalContacts: deviceContacts.length,
				signalUsersFound: 0,
			};
		}

		// Step 4: Batch lookup via CDSI
		const batches = createBatches(phoneNumbers, BATCH_SIZE);
		const totalBatches = batches.length;
		console.log('Sync: Created', totalBatches, 'batches of', BATCH_SIZE);

		dispatch(setSyncProgress({ current: 0, total: totalBatches }));

		const allResults: CdsiLookupResult[] = [];

		for (let i = 0; i < batches.length; i++) {
			const batch = batches[i];
			console.log(`Sync: Processing batch ${i + 1}/${totalBatches} (${batch.length} numbers)`);

			try {
				const results = await lookupPhoneNumbers(batch);
				allResults.push(...results);
				dispatch(setSyncProgress({ current: i + 1, total: totalBatches }));

				// Delay between batches to avoid rate limiting
				if (i < batches.length - 1) {
					await sleep(BATCH_DELAY_MS);
				}
			} catch (error) {
				console.error(`Sync: Batch ${i + 1} failed:`, error);
				// Continue with next batch, don't fail entire sync
			}
		}

		// Step 5: Process results
		console.log('Sync: Processing', allResults.length, 'results');
		// Include contacts that have either ACI or PNI (both indicate Signal user)
		const signalUsers = allResults.filter((r) => r.aci || r.pni);
		console.log('Sync: Found', signalUsers.length, 'Signal users');

		// Store discovered contacts in signalContacts slice for tracking
		const discoveredContacts = signalUsers.map((result) => ({
			aci: result.aci!,
			pni: result.pni ?? undefined,
			phoneNumber: result.e164,
			displayName: phoneToNameMap.get(result.e164),
		}));

		dispatch(addDiscoveredContacts(discoveredContacts));

		// Add discovered Signal users to main contacts list
		for (const result of signalUsers) {
			const displayName = phoneToNameMap.get(result.e164) || result.e164;
			// Use ACI if available, otherwise use PNI as identifier
			const identifier = result.aci || result.pni;
			if (!identifier) {
				continue;
			}
			dispatch(addSignalContact({
				name: displayName,
				signal: {
					aci: result.aci ?? undefined,
					pni: result.pni ?? undefined,
					phoneNumber: result.e164,
				},
			}));
		}

		// Mark sync as complete
		dispatch(setSyncStatus('success'));
		dispatch(setLastSyncTimestamp(Date.now()));

		console.log('Sync: Complete -', signalUsers.length, 'Signal users found');

		return {
			success: true,
			totalContacts: phoneNumbers.length,
			signalUsersFound: signalUsers.length,
		};
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.error('Sync: Error:', errorMessage);
		dispatch(setSyncError(errorMessage));
		return {
			success: false,
			error: errorMessage,
			totalContacts: 0,
			signalUsersFound: 0,
		};
	}
}

/**
 * Split an array into batches of specified size.
 */
function createBatches<T>(array: T[], batchSize: number): T[][] {
	const batches: T[][] = [];
	for (let i = 0; i < array.length; i += batchSize) {
		batches.push(array.slice(i, i + batchSize));
	}
	return batches;
}

/**
 * Sleep for specified milliseconds.
 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
