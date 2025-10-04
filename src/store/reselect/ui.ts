import { createSelector } from '@reduxjs/toolkit';
import { RootState } from '..';
import { TBackupItem } from '../types/backup';
import { EBackupCategory } from '../types/backup';
import { THealthState, TProfileLink, TSendTransaction } from '../types/ui';
import { backupSelector } from './backup';
import { blocktankPaidOrdersFullSelector } from './blocktank';
import { openChannelsSelector, pendingChannelsSelector } from './lightning';

export const profileLinkSelector = (state: RootState): TProfileLink => {
	return state.ui.profileLink;
};

export const isAuthenticatedSelector = (state: RootState): boolean => {
	return state.ui.isAuthenticated;
};

export const isOnlineSelector = (state: RootState): boolean => {
	return state.ui.isOnline;
};

export const isLDKReadySelector = (state: RootState): boolean => {
	return state.ui.isLDKReady;
};

export const isLightningReadySelector = (state: RootState): boolean => {
	// Check if LDK is ready
	if (state.ui.isLDKReady) {
		return true;
	}
	
	// Check if external wallet is connected and ready
	const externalWallets = state.externalWallets;
	const defaultWallet = externalWallets.defaultWallet;
	
	if (defaultWallet && externalWallets[defaultWallet]?.connected) {
		return true;
	}
	
	return false;
};

export const isConnectedToElectrumSelector = (state: RootState): boolean => {
	return state.ui.isConnectedToElectrum;
};

export const isElectrumThrottledSelector = (state: RootState): boolean => {
	return state.ui.isElectrumThrottled;
};

export const appStateSelector = (state: RootState) => {
	return state.ui.appState;
};

export const availableUpdateSelector = (state: RootState) => {
	return state.ui.availableUpdate;
};

export const criticalUpdateSelector = (state: RootState): boolean => {
	return state.ui.availableUpdate?.critical ?? false;
};

export const timeZoneSelector = (state: RootState): string => {
	return state.ui.timeZone;
};

export const languageSelector = (state: RootState): string => {
	return state.ui.language;
};

export const sendTransactionSelector = (state: RootState): TSendTransaction => {
	return state.ui.sendTransaction;
};

export const internetStatusSelector = (state: RootState): THealthState => {
	return state.ui.isOnline ? 'ready' : 'error';
};

export const electrumStatusSelector = (state: RootState): THealthState => {
	const { isOnline, isConnectedToElectrum, isElectrumThrottled } = state.ui;
	if (isOnline && !isConnectedToElectrum && !isElectrumThrottled) {
		return 'pending';
	}
	return isConnectedToElectrum ? 'ready' : 'error';
};

export const nodeStatusSelector = (state: RootState): THealthState => {
	const { isOnline, isLDKReady } = state.ui;
	const externalWallets = state.externalWallets;
	
	// Check if we have a connected external wallet
	const hasConnectedExternalWallet = externalWallets.defaultWallet && 
		externalWallets[externalWallets.defaultWallet]?.connected;
	
	// If we have external wallet, use that status; otherwise use LDK status
	if (hasConnectedExternalWallet) {
		return isOnline ? 'ready' : 'error';
	}
	
	return isOnline && isLDKReady ? 'ready' : 'error';
};

export const channelsStatusSelector = (state: RootState): THealthState => {
	const { isOnline } = state.ui;
	const openChannels = openChannelsSelector(state);
	const pendingChannels = pendingChannelsSelector(state);
	const paidOrders = blocktankPaidOrdersFullSelector(state);
	const externalWallets = state.externalWallets;

	if (!isOnline) {
		return 'error';
	}

	// Check if we have a connected external wallet with balance
	const defaultWallet = externalWallets.defaultWallet;
	if (defaultWallet && externalWallets[defaultWallet]?.connected) {
		const walletConfig = externalWallets[defaultWallet];
		const nodeInfo = walletConfig?.lastNodeInfo as any;
		
		// If external wallet has receiving capacity, consider it ready
		if (nodeInfo?.receiveBalanceSats > 0 || nodeInfo?.sendBalanceSats > 0) {
			return 'ready';
		}
		
		// External wallet is connected but has no balance
		return 'pending';
	}

	// Fallback to LDK channel logic
	if (openChannels.length > 0) {
		return 'ready';
	}
	if (
		pendingChannels.length > 0 ||
		Object.keys(paidOrders.created).length > 0
	) {
		return 'pending';
	}
	return 'error';
};

export const backupStatusSelector = createSelector(
	[backupSelector],
	(backup): THealthState => {
		const now = new Date().getTime();
		const FAILED_BACKUP_CHECK_TIME = 300000; // 5 minutes in milliseconds

		const isSyncOk = (b: TBackupItem): boolean => {
			return (
				b.synced > b.required || now - b.required < FAILED_BACKUP_CHECK_TIME
			);
		};

		const isBackupSyncOk = Object.values(EBackupCategory).every((key) => {
			return isSyncOk(backup[key]);
		});

		return isBackupSyncOk ? 'ready' : 'error';
	},
);

/**
 * Returns a combined status of all app components.
 * Returns 'ready' if all components are ready,
 * 'pending' if any component is pending and none are in error,
 * 'error' if any component is in error state.
 * // NOTE: We ignore channels for the global app status
 */
export const appStatusSelector = createSelector(
	[
		internetStatusSelector,
		electrumStatusSelector,
		nodeStatusSelector,
		backupStatusSelector,
	],
	(internetState, electrumState, nodeState, backupState): THealthState => {
		const states = [internetState, electrumState, nodeState, backupState];

		if (states.some((state) => state === 'error')) {
			return 'error';
		}
		if (states.some((state) => state === 'pending')) {
			return 'pending';
		}
		return 'ready';
	},
);
