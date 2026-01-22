import { createSelector } from '@reduxjs/toolkit';
import { RootState } from '..';
import { TExternalWalletType } from '../slices/externalWallets';

export const externalWalletsState = (state: RootState) => state.externalWallets;

export const externalWalletSelector = createSelector(
	[externalWalletsState, (_: RootState, type: TExternalWalletType) => type],
	(state, type) => state[type],
);

export const defaultExternalWalletSelector = createSelector(
	[externalWalletsState],
	(state) => state.defaultWallet,
);

export const connectedExternalWalletsSelector = createSelector(
	[externalWalletsState],
	(state) => {
		const connectedWallets: TExternalWalletType[] = [];
		const walletTypes: TExternalWalletType[] = ['lnd', 'cln', 'phoenixd', 'strike', 'blink', 'speed', 'nwc'];
		
		walletTypes.forEach((type) => {
			const wallet = state[type];
			if (wallet?.connected) {
				connectedWallets.push(type);
			}
		});
		
		return connectedWallets;
	},
);

export const defaultExternalWalletBalanceSelector = createSelector(
	[externalWalletsState, defaultExternalWalletSelector],
	(state, defaultWallet) => {
		if (!defaultWallet) {
			return 0;
		}
		
		const wallet = state[defaultWallet];
		if (!wallet?.connected || !wallet.lastNodeInfo) {
			return 0;
		}
		
		// Extract sendBalanceSats from the serialized node info
		const nodeInfo = wallet.lastNodeInfo as any;
		return nodeInfo.sendBalanceSats || 0;
	},
);

export const externalWalletNodeInfoSelector = createSelector(
	[externalWalletsState, (_: RootState, walletType: string) => walletType],
	(state, walletType) => {
		const wallet = state[walletType as TExternalWalletType];
		if (!wallet?.connected || !wallet.lastNodeInfo) {
			return null;
		}
		
		const nodeInfo = wallet.lastNodeInfo as any;
		return {
			nodeType: nodeInfo.nodeType || walletType.toUpperCase(),
			alias: nodeInfo.alias,
			network: nodeInfo.network,
			blockHeight: nodeInfo.blockHeight,
			pubkey: nodeInfo.pubkey,
		};
	},
);

export const walletNodeInfoByTransactionSelector = createSelector(
	[externalWalletsState, (_: RootState, txId: string) => txId],
	(state, txId) => {
		// Extract wallet type from transaction ID prefix (e.g., "lnd-abc123" -> "lnd")
		if (!txId || !txId.includes('-')) {
			return null;
		}
		
		const walletType = txId.split('-')[0].toLowerCase() as TExternalWalletType;
		const wallet = state[walletType];
		
		if (!wallet?.connected || !wallet.lastNodeInfo) {
			return null;
		}
		
		const nodeInfo = wallet.lastNodeInfo as any;
		return {
			nodeType: nodeInfo.nodeType || walletType.toUpperCase(),
			alias: nodeInfo.alias,
			network: nodeInfo.network,
		};
	},
);
