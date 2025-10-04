import {
	TChannelManagerChannelClosed,
	TInvoice,
	ldk,
} from '@synonymdev/react-native-ldk';
import { getLNURLParams, lnurlChannel } from '@synonymdev/react-native-lnurl';
import { Result, err, ok } from '@synonymdev/result';
import { EPaymentType } from 'beignet';
import { LNURLChannelParams } from 'js-lnurl';

import { reduceValue, vibrate } from '../../utils/helpers';
import { getStore } from '../helpers';
import { showSheet, closeSheet } from './ui';
import { showToast } from '../../utils/notifications';
import i18n from '../../utils/i18n';
import { createExternalWalletInvoice, createNodeInstance } from './externalWallets';
import { InteractionManager, AppState } from 'react-native';
import {
	addPeers,
	createPaymentRequest,
	getChannelMonitors,
	getClaimedLightningPayments,
	getCustomLightningPeers,
	getLdkChannels,
	getNodeVersion,
	getPendingInvoice,
	getSentLightningPayments,
	parseUri,
} from '../../utils/lightning';
import { EAvailableNetwork } from '../../utils/networks';
import { getSelectedNetwork, getSelectedWallet } from '../../utils/wallet';
import { getBlockHeader } from '../../utils/wallet/electrum';
import {
	dispatch,
	getBlocktankStore,
	getLightningStore,
	getMetaDataStore,
} from '../helpers';
import { updateActivityItems } from '../slices/activity';
import {
	removeLightningPeer,
	removePendingPayment,
	saveLightningPeer,
	updateChannel,
	updateChannels,
	updateLightningNodeId,
	updateLightningNodeVersion,
} from '../slices/lightning';
import { moveMetaIncTxTag } from '../slices/metadata';
import { addTransfer, updateTransfer } from '../slices/wallet';
import { EActivityType, TLightningActivityItem } from '../types/activity';
import {
	EChannelClosureReason,
	EChannelStatus,
	TCreateLightningInvoice,
	TLightningNodeVersion,
} from '../types/lightning';
import { ETransferStatus, ETransferType, TWalletName } from '../types/wallet';
import { Transaction } from "lni_react_native"

/**
 * Attempts to update the node id for the selected wallet and network.
 */
export const updateLightningNodeIdThunk = async (): Promise<Result<string>> => {
	const selectedNetwork = getSelectedNetwork();
	const selectedWallet = getSelectedWallet();

	try {
		const result = await ldk.nodeId();
		if (result.isOk()) {
			dispatch(
				updateLightningNodeId({
					nodeId: result.value,
					selectedWallet,
					selectedNetwork,
				}),
			);
		}
		return ok('Updated nodeId.');
	} catch (e) {
		return err(e);
	}
};

/**
 * Attempts to grab, update and save the lightning node version to storage.
 * @returns {Promise<Result<TLightningNodeVersion>>}
 */
export const updateLightningNodeVersionThunk = async (): Promise<
	Result<TLightningNodeVersion>
> => {
	try {
		const version = await getNodeVersion();
		if (version.isErr()) {
			return err(version.error.message);
		}
		const currentVersion = getLightningStore()?.version;
		if (version.value.ldk !== currentVersion.ldk) {
			dispatch(updateLightningNodeVersion(version.value));
		}
		return ok(version.value);
	} catch (e) {
		console.log(e);
		return err(e);
	}
};

/**
 * Attempts to update the lightning channels for the current wallet and network.
 * This method will save all channels (both pending, open & closed) to redux.
 */
export const updateChannelsThunk = async (): Promise<Result<string>> => {
	const blockHeight = getBlockHeader().height;
	const selectedWallet = getSelectedWallet();
	const selectedNetwork = getSelectedNetwork();

	const channelsResult = await getLdkChannels();
	if (channelsResult.isErr()) {
		return err(channelsResult.error.message);
	}
	const channelMonitorsResult = await getChannelMonitors();
	if (channelMonitorsResult.isErr()) {
		return err(channelMonitorsResult.error.message);
	}
	const channels = channelsResult.value;
	const channelMonitors = channelMonitorsResult.value;

	// Update the transfer status for pending channels.
	channels.forEach((channel) => {
		if (channel.funding_txid) {
			const { funding_txid, confirmations, confirmations_required } = channel;
			let txId = funding_txid;
			const confirmsIn = Math.max(confirmations_required! - confirmations, 0);

			// If the channel is opened by Blocktank, get the payment txId from the order.
			const orders = getBlocktankStore().orders;
			const order = orders.find((o) => o.channel?.fundingTx.id === txId);
			const paymentTxId = order?.payment.onchain.transactions[0]?.txId;
			if (paymentTxId) {
				txId = paymentTxId;
			}

			dispatch(updateTransfer({ txId, confirmsIn }));
		}
	});

	// Update transfers for closed channels
	channelMonitors.forEach(({ funding_txo_txid, claimable_balances }) => {
		const txId = funding_txo_txid;
		const amountRes = reduceValue(claimable_balances, 'amount_satoshis');
		const amount = amountRes.isOk() ? amountRes.value : 0;

		let confirmationHeight = 0;
		if (claimable_balances.length > 0) {
			// Default to 6 confirmations if no confirmation height (closing transaction has not yet appeared in a block)
			confirmationHeight =
				claimable_balances[0].confirmation_height ?? blockHeight + 6;
		}
		const confirmsIn = Math.max(confirmationHeight - blockHeight, 0);

		dispatch(updateTransfer({ txId, confirmsIn, amount }));
	});

	dispatch(
		updateChannels({
			channels,
			channelMonitors,
			selectedWallet,
			selectedNetwork,
		}),
	);

	return ok('Updated Lightning Channels');
};

export const closeChannelThunk = async (
	res: TChannelManagerChannelClosed,
): Promise<void> => {
	const selectedWallet = getSelectedWallet();
	const selectedNetwork = getSelectedNetwork();

	const channelMonitorsResult = await getChannelMonitors();
	if (channelMonitorsResult.isErr()) {
		console.error(channelMonitorsResult.error.message);
		return;
	}
	const channelMonitors = channelMonitorsResult.value;
	const channelMonitor = channelMonitors.find(({ channel_id }) => {
		return channel_id === res.channel_id;
	});

	if (channelMonitor) {
		// update the channel with the closure reason
		dispatch(
			updateChannel({
				channelData: {
					channel_id: res.channel_id,
					status: EChannelStatus.closed,
					claimable_balances: channelMonitor.claimable_balances,
					closureReason: res.reason as EChannelClosureReason,
					is_channel_ready: false,
					is_usable: false,
				},
				selectedWallet,
				selectedNetwork,
			}),
		);

		// Add a transfer for the closed channel
		const claimableBalances = channelMonitor.claimable_balances;
		const amountRes = reduceValue(claimableBalances, 'amount_satoshis');
		const amount = amountRes.isOk() ? amountRes.value : 0;

		const blockHeight = getBlockHeader().height;
		const type =
			res.reason === EChannelClosureReason.LocallyInitiatedCooperativeClosure
				? ETransferType.coopClose
				: ETransferType.forceClose;

		let confirmationHeight = 0;
		if (claimableBalances.length > 0) {
			// Default to 6 confirmations if no confirmation height (closing transaction has not yet appeared in a block)
			confirmationHeight =
				claimableBalances[0].confirmation_height ?? blockHeight + 6;
		}

		const txId = channelMonitor.funding_txo_txid;
		let status = ETransferStatus.pending;
		let confirmsIn = Math.max(confirmationHeight - blockHeight, 0);

		// for coop closes, ignore the anti reorg delay (6 blocks) from LDK
		// consider funds as immediately available
		if (type === ETransferType.coopClose) {
			status = ETransferStatus.done;
			confirmsIn = 0;
		}

		dispatch(addTransfer({ type, status, txId, amount, confirmsIn }));
	}
};

/**
 * Claims a lightning channel from a lnurl-channel string
 * @param {string} lnurl
 * @returns {Promise<Result<string>>}
 */
export const claimChannelFromLnurlString = async (
	lnurl: string,
): Promise<Result<string>> => {
	const res = await getLNURLParams(lnurl);
	if (res.isErr()) {
		return err(res.error);
	}

	const params = res.value as LNURLChannelParams;
	if (params.tag !== 'channelRequest') {
		return err('Not a channel request lnurl');
	}

	return claimChannel(params);
};

/**
 * Claims a lightning channel from a decoded lnurl-channel request
 * @param {LNURLChannelParams} params
 * @returns {Promise<Result<string>>}
 */
export const claimChannel = async (
	params: LNURLChannelParams,
): Promise<Result<string>> => {
	// TODO: Connect to peer from URI.
	const lnurlRes = await lnurlChannel({
		params,
		isPrivate: true,
		cancel: false,
		localNodeId: '',
	});

	if (lnurlRes.isErr()) {
		return err(lnurlRes.error);
	}

	return ok(lnurlRes.value);
};

/**
 * Starts polling for invoice payment status using external wallet's onInvoiceEvents
 * This runs in a background task to avoid blocking the UI thread
 * @param {string} paymentHash
 */
const startInvoicePolling = (paymentHash: string): void => {
	console.log(`[POLLING] Starting payment detection for hash: ${paymentHash}`);
	console.log('[POLLING] Using external wallet onInvoiceEvents with background task');
	
	try {
		const store = getStore();
		const externalWallets = store.externalWallets;
		const defaultWallet = externalWallets.defaultWallet;
		
		if (!defaultWallet) {
			console.warn('[POLLING] No default external wallet configured for invoice polling');
			return;
		}

		const walletConfig = externalWallets[defaultWallet];
		if (!walletConfig || !walletConfig.connected) {
			console.warn(`[POLLING] Default wallet ${defaultWallet} is not connected`);
			return;
		}

		// Create node instance for the external wallet
		const node = createNodeInstance(defaultWallet, walletConfig);
		
		if (!node || !node.onInvoiceEvents) {
			console.warn(`[POLLING] onInvoiceEvents not available for ${defaultWallet}`);
			return;
		}

		console.log(`[POLLING] Starting background task for polling hash: ${paymentHash} with wallet: ${defaultWallet}`);

		// Start a background task to prevent UI blocking
		let backgroundTaskId: number | NodeJS.Timeout | undefined;
		
		const startBackgroundPolling = () => {
			// Register background task for iOS or use fallback
			if (AppState.currentState === 'active') {
				try {
					// Try to start a background task (iOS specific)
					backgroundTaskId = require('react-native').BackgroundTask?.start?.({
						taskName: 'InvoicePolling',
						taskKey: paymentHash,
					}) || setTimeout(() => {}, 0); // Fallback timeout ID
					
					console.log(`[POLLING] Background task started with ID: ${backgroundTaskId}`);
				} catch (_e) {
					console.log('[POLLING] Background task API not available, using fallback approach');
					backgroundTaskId = setTimeout(() => {}, 0);
				}
			}
			
			// Use setImmediate to ensure UI renders first
			setImmediate(() => {
				console.log('[POLLING] Initializing polling in background thread...');
				
				// Use InteractionManager to wait for UI interactions to complete
				InteractionManager.runAfterInteractions(() => {
					console.log(`[POLLING] UI ready, starting background onInvoiceEvents for hash: ${paymentHash}`);
					
					// Additional delay to ensure everything is rendered
					setTimeout(() => {
						console.log('[POLLING] Executing onInvoiceEvents in background task...');

						const invoiceEventParams = {
							paymentHash,
							pollingDelaySec: BigInt(2), // poll every 2 seconds
							maxPollingSec: BigInt(60), // poll for up to 1 minute
						}
						const callbacks = {
							success(transaction: Transaction | undefined): void {
								console.log(`[POLLING] SUCCESS! Payment received for hash: ${paymentHash}`);
								
								// End background task immediately on success
								if (backgroundTaskId) {
									try {
										require('react-native').BackgroundTask?.finish?.(backgroundTaskId);
										console.log(`[POLLING] Background task ${backgroundTaskId} finished on success`);
									} catch (_e) {
										clearTimeout(backgroundTaskId as NodeJS.Timeout); // Fallback for timeout IDs
										console.log('[POLLING] Background task cleanup completed');
									}
								}
								
								// Handle success UI in non-blocking way
								setImmediate(() => {
									if (transaction) {
										console.log('[POLLING] Transaction details:', {
											hash: transaction.paymentHash,
											amountMsats: transaction.amountMsats.toString(),
											amountSats: Math.floor(Number(transaction.amountMsats) / 1000),
											description: transaction.description,
											settledAt: transaction.settledAt.toString(),
										});
									}
									
									// Queue UI updates to run after current execution
									setTimeout(() => {
										// Show success celebration
										vibrate({ type: 'default' });
										
										// Close the receive sheet
										closeSheet('receive');
										
										// Show success sheet
										if (transaction) {
											const amountSats = Number(transaction.amountMsats) / 1000;
											showSheet('receivedTx', {
												id: transaction.paymentHash || paymentHash,
												activityType: EActivityType.lightning,
												value: Math.floor(amountSats),
											});
										}
										
										// Show success toast
										showToast({
											type: 'lightning',
											title: i18n.t('wallet:toast_payment_received_title'),
											description: i18n.t('wallet:toast_payment_received_description'),
										});
										
										console.log(`[POLLING] Success UI displayed for payment: ${paymentHash}`);
									}, 50);
									
									// Sync activity list in background
									setTimeout(() => {
										syncLightningTxsWithActivityList().catch(error => {
											console.error('[POLLING] Activity sync error after success:', error);
										});
									}, 200);
								});
							},
							pending(_transaction: Transaction | undefined): void {
								console.log(`[POLLING] Payment still pending for hash: ${paymentHash}`);
							},
							failure(_transaction: Transaction | undefined): void {
								console.log(`[POLLING] Payment failed for hash: ${paymentHash}`);
								
								// End background task on failure
								if (backgroundTaskId) {
									try {
										require('react-native').BackgroundTask?.finish?.(backgroundTaskId);
										console.log(`[POLLING] Background task ${backgroundTaskId} finished on failure`);
									} catch (_e) {
										clearTimeout(backgroundTaskId as NodeJS.Timeout);
										console.log('[POLLING] Background task cleanup on failure completed');
									}
								}
							},
						}
						
						// Start the polling - key: run without awaiting to avoid blocking
						node?.onInvoiceEventsAsync 
							? node.onInvoiceEventsAsync(
								invoiceEventParams,
								callbacks
							) : node.onInvoiceEvents(
								invoiceEventParams,
								callbacks
							)
						
						console.log(`[POLLING] Background onInvoiceEvents setup complete for hash: ${paymentHash}`);
					}, 800); // Longer delay to ensure UI is completely ready
				});
			});
		};
		
		// Start background polling after UI is ready
		setTimeout(startBackgroundPolling, 1000);
		
		console.log('[POLLING] Background polling initialization complete');
		
	} catch (error) {
		console.error('[POLLING] Error setting up background polling:', error);
	}
};

/**
 * Creates and stores a lightning invoice, for the specified amount, and refreshes/re-adds peers.
 * First attempts to use external wallets if available, then falls back to LDK.
 * @param {number} amountSats
 * @param {string} [description]
 * @param {number} [expiryDeltaSeconds]
 * @param {EAvailableNetwork} [selectedNetwork]
 * @param {TWalletName} [selectedWallet]
 */
export const createLightningInvoice = async ({
	amountSats,
	description,
	expiryDeltaSeconds,
	selectedWallet = getSelectedWallet(),
	selectedNetwork = getSelectedNetwork(),
}: TCreateLightningInvoice): Promise<Result<TInvoice>> => {
	try {
		// First, check if there's a default external wallet configured
		const store = getStore();
		const externalWallets = store.externalWallets;
		
		if (externalWallets.defaultWallet) {
			console.log('Attempting invoice creation with external wallet:', externalWallets.defaultWallet);
			console.log('External wallet config:', externalWallets[externalWallets.defaultWallet]);
			
			// Import the external wallet invoice creation function
			const externalInvoice = await createExternalWalletInvoice(
				() => getStore(),
				amountSats || 0,
				description,
				expiryDeltaSeconds
			);
			
			console.log('External invoice creation result:', externalInvoice);
			
			if (externalInvoice?.paymentRequest) {
				console.log('Invoice created successfully with external wallet. Payment request:', `${externalInvoice.paymentRequest}...`);
				console.log('Payment hash:', externalInvoice.paymentHash);
				console.log(`[TIMING] About to start polling at: ${Date.now()}`);
				
				// Start polling for invoice payment (non-blocking)
				startInvoicePolling(externalInvoice.paymentHash);
				
				console.log(`[TIMING] Polling started, about to return invoice at: ${Date.now()}`);
				
				// Return in the expected TInvoice format
				const result = {
					to_str: externalInvoice.paymentRequest,
					payment_hash: externalInvoice.paymentHash,
					description: description || '',
					amount_satoshis: amountSats,
					is_expired: false,
					expiry_time: Date.now() + ((expiryDeltaSeconds || 3600) * 1000),
				} as TInvoice;
				
				console.log('Returning TInvoice result:', {
					to_str: `${result.to_str.substring(0, 50)}...`,
					payment_hash: result.payment_hash,
					amount_satoshis: result.amount_satoshis
				});
				console.log(`[TIMING] Returning invoice result at: ${Date.now()}`);
				
				return ok(result);
			}
			
			console.log('External wallet invoice creation failed or returned null, falling back to LDK');
		}

		// Fallback to original LDK invoice creation logic only if no external wallet is configured
		if (!externalWallets.defaultWallet) {
			const invoice = await createPaymentRequest({
				amountSats,
				description,
				expiryDeltaSeconds,
			});
			if (invoice.isErr()) {
				return err(invoice.error.message);
			}

			addPeers({ selectedNetwork, selectedWallet }).then();

			return ok(invoice.value);
		}

		// If we have external wallet configured but creation failed, don't fallback to LDK
		return err('External wallet invoice creation failed and no LDK fallback available');
	} catch (e) {
		console.log('Error in createLightningInvoice:', e);
		
		// Get store again in case it changed
		const store = getStore();
		const externalWallets = store.externalWallets;
		
		// Only fallback to LDK if no external wallet is configured
		if (!externalWallets.defaultWallet) {
			const invoice = await createPaymentRequest({
				amountSats,
				description,
				expiryDeltaSeconds,
			});
			if (invoice.isErr()) {
				return err(invoice.error.message);
			}

			addPeers({ selectedNetwork, selectedWallet }).then();

			return ok(invoice.value);
		}

		// If external wallet is configured but failed, return the error
		return err(e instanceof Error ? e.message : 'External wallet invoice creation failed');
	}
};

/**
 * Attempts to save a custom lightning peer to storage.
 * @param {TWalletName} [selectedWallet]
 * @param {EAvailableNetwork} [selectedNetwork]
 * @param {string} peer
 */
export const savePeer = ({
	selectedWallet = getSelectedWallet(),
	selectedNetwork = getSelectedNetwork(),
	peer,
}: {
	selectedWallet?: TWalletName;
	selectedNetwork?: EAvailableNetwork;
	peer: string;
}): Result<string> => {
	if (!peer) {
		return err('The peer data appears to be invalid.');
	}
	// Check that the URI is valid.
	const parsedPeerData = parseUri(peer);
	if (parsedPeerData.isErr()) {
		return err(parsedPeerData.error.message);
	}
	// Ensure we haven't already added this peer.
	const existingPeers = getCustomLightningPeers({
		selectedWallet,
		selectedNetwork,
	});
	if (existingPeers.includes(peer)) {
		return ok('Peer Already Added');
	}
	const payload = {
		peer,
		selectedWallet,
		selectedNetwork,
	};
	dispatch(saveLightningPeer(payload));
	return ok('Lightning Peer Saved');
};

/**
 * Attempts to remove a custom lightning peer from storage.
 * @param {TWalletName} [selectedWallet]
 * @param {EAvailableNetwork} [selectedNetwork]
 * @param {string} peer
 * @returns {Result<string>}
 */
export const removePeer = ({
	selectedWallet = getSelectedWallet(),
	selectedNetwork = getSelectedNetwork(),
	peer,
}: {
	selectedWallet?: TWalletName;
	selectedNetwork?: EAvailableNetwork;
	peer: string;
}): Result<string> => {
	if (!peer) {
		return err('The peer data appears to be invalid.');
	}
	const payload = {
		peer,
		selectedWallet,
		selectedNetwork,
	};
	dispatch(removeLightningPeer(payload));
	return ok('Successfully Removed Lightning Peer');
};

export const syncLightningTxsWithActivityList = async (): Promise<
	Result<string>
> => {
	const items: TLightningActivityItem[] = [];

	const claimed = await getClaimedLightningPayments();
	for (const payment of claimed) {
		// Required to add in bolt11 and description
		const invoice = await getPendingInvoice(payment.payment_hash);

		items.push({
			id: payment.payment_hash,
			activityType: EActivityType.lightning,
			txType: EPaymentType.received,
			status: 'successful',
			message: invoice?.description ?? '',
			address: invoice?.to_str ?? '',
			confirmed: payment.state === 'successful',
			value: payment.amount_sat,
			timestamp: payment.unix_timestamp * 1000,
			preimage: payment.payment_preimage,
		});
	}

	// Remove pending payments from store that are no longer pending
	const sent = await getSentLightningPayments();
	const pendingPayments = sent.filter((p) => p.state === 'pending');
	const pendingWatched = getLightningStore().pendingPayments;
	const pendingToRemove = pendingWatched.filter((p) => {
		return !pendingPayments.find((pp) => pp.payment_hash === p.payment_hash);
	});

	if (pendingToRemove.length > 0) {
		pendingToRemove.forEach(({ payment_hash }) => {
			dispatch(removePendingPayment(payment_hash));
		});
	}

	for (const payment of sent) {
		if (!payment.amount_sat) {
			continue;
		}

		items.push({
			id: payment.payment_hash,
			activityType: EActivityType.lightning,
			txType: EPaymentType.sent,
			status: payment.state,
			message: payment.description ?? '',
			address: payment.bolt11_invoice ?? '',
			confirmed: payment.state === 'successful',
			value: payment.amount_sat,
			fee: payment.fee_paid_sat ?? 0,
			timestamp: payment.unix_timestamp * 1000,
			preimage: payment.payment_preimage,
		});
	}

	dispatch(updateActivityItems(items));

	return ok('Stored lightning transactions synced with activity list.');
};

/**
 * Moves pending tags to metadata store linked to received payment
 * @param {TInvoice} invoice
 * @returns {Result<string>}
 */
export const moveMetaIncPaymentTags = (invoice: TInvoice): Result<string> => {
	const { pendingInvoices } = getMetaDataStore();
	const matched = pendingInvoices.find((item) => {
		return item.payReq === invoice.to_str;
	});

	if (matched) {
		const newPending = pendingInvoices.filter((item) => item !== matched);

		dispatch(
			moveMetaIncTxTag({
				pendingInvoices: newPending,
				tags: { [invoice.payment_hash]: matched.tags },
			}),
		);
	}

	return ok('Metadata tags resynced with transactions.');
};
