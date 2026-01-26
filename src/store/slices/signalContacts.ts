import { PayloadAction, createSlice } from '@reduxjs/toolkit';

export type SyncStatus = 'idle' | 'syncing' | 'success' | 'error';

export interface DiscoveredContact {
	aci: string;
	pni?: string;
	displayName?: string;
	phoneNumber: string;
}

export interface SignalContactsState {
	syncStatus: SyncStatus;
	syncProgress: {
		current: number;
		total: number;
	};
	discoveredContacts: { [phoneNumber: string]: DiscoveredContact };
	cdsiToken?: string;
	lastSyncTimestamp?: number;
	error?: string;
}

export const initialSignalContactsState: SignalContactsState = {
	syncStatus: 'idle',
	syncProgress: {
		current: 0,
		total: 0,
	},
	discoveredContacts: {},
	cdsiToken: undefined,
	lastSyncTimestamp: undefined,
	error: undefined,
};

export const signalContactsSlice = createSlice({
	name: 'signalContacts',
	initialState: initialSignalContactsState,
	reducers: {
		setSyncStatus: (state, action: PayloadAction<SyncStatus>) => {
			state.syncStatus = action.payload;
			if (action.payload === 'idle') {
				state.error = undefined;
			}
		},
		setSyncProgress: (
			state,
			action: PayloadAction<{ current: number; total: number }>,
		) => {
			state.syncProgress = action.payload;
		},
		setSyncError: (state, action: PayloadAction<string>) => {
			state.syncStatus = 'error';
			state.error = action.payload;
		},
		addDiscoveredContact: (
			state,
			action: PayloadAction<DiscoveredContact>,
		) => {
			state.discoveredContacts[action.payload.phoneNumber] = action.payload;
		},
		addDiscoveredContacts: (
			state,
			action: PayloadAction<DiscoveredContact[]>,
		) => {
			for (const contact of action.payload) {
				state.discoveredContacts[contact.phoneNumber] = contact;
			}
		},
		setCdsiToken: (state, action: PayloadAction<string | undefined>) => {
			state.cdsiToken = action.payload;
		},
		setLastSyncTimestamp: (state, action: PayloadAction<number>) => {
			state.lastSyncTimestamp = action.payload;
		},
		clearDiscoveredContacts: (state) => {
			state.discoveredContacts = {};
		},
		resetSignalContactsState: () => initialSignalContactsState,
	},
});

const { actions, reducer } = signalContactsSlice;

export const {
	setSyncStatus,
	setSyncProgress,
	setSyncError,
	addDiscoveredContact,
	addDiscoveredContacts,
	setCdsiToken,
	setLastSyncTimestamp,
	clearDiscoveredContacts,
	resetSignalContactsState,
} = actions;

export default reducer;
