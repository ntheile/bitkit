import { createSelector } from '@reduxjs/toolkit';

import { RootState } from '..';
import {
	DiscoveredContact,
	SignalContactsState,
	SyncStatus,
} from '../slices/signalContacts';

const signalContactsState = (state: RootState): SignalContactsState =>
	state.signalContacts;

export const signalContactsSelector = (state: RootState): SignalContactsState =>
	state.signalContacts;

export const syncStatusSelector = createSelector(
	[signalContactsState],
	(signalContacts): SyncStatus => signalContacts.syncStatus,
);

export const syncProgressSelector = createSelector(
	[signalContactsState],
	(signalContacts): { current: number; total: number } =>
		signalContacts.syncProgress,
);

export const discoveredContactsSelector = createSelector(
	[signalContactsState],
	(signalContacts): { [phoneNumber: string]: DiscoveredContact } =>
		signalContacts.discoveredContacts,
);

export const discoveredContactsCountSelector = createSelector(
	[discoveredContactsSelector],
	(discoveredContacts): number => Object.keys(discoveredContacts).length,
);

export const cdsiTokenSelector = createSelector(
	[signalContactsState],
	(signalContacts): string | undefined => signalContacts.cdsiToken,
);

export const lastSyncTimestampSelector = createSelector(
	[signalContactsState],
	(signalContacts): number | undefined => signalContacts.lastSyncTimestamp,
);

export const syncErrorSelector = createSelector(
	[signalContactsState],
	(signalContacts): string | undefined => signalContacts.error,
);

export const isSyncingSelector = createSelector(
	[syncStatusSelector],
	(syncStatus): boolean => syncStatus === 'syncing',
);
