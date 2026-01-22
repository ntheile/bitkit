import {
	getLNURLParams,
	lnurlAddress as processLnurlAddress,
} from '@synonymdev/react-native-lnurl';
import { Result, err, ok } from '@synonymdev/result';
import { parse } from '@synonymdev/slashtags-url';
import {
	EAddressType,
	EAvailableNetworks,
	parseOnChainPaymentRequest,
	validateAddress,
} from 'beignet';
import bip21 from 'bip21';
import URLParse from 'url-parse';

import { rootNavigation } from '../../navigation/root/RootNavigationContainer';
import { sendNavigation, navigationRef } from '../../sheets/SendNavigation';
import {
	resetSendTransaction,
	setupOnChainTransaction,
	updateBeignetSendTransaction,
} from '../../store/actions/wallet';
import {
	dispatch,
	getSettingsStore,
	getSlashtagsStore,
} from '../../store/helpers';
import { updateSendTransaction } from '../../store/slices/ui';
import { EDenomination } from '../../store/types/wallet';
import { closeSheet, showSheet } from '../../store/utils/ui';
import { fiatToBitcoinUnit } from '../conversion';
import { getBitcoinDisplayValues } from '../displayValues';
import i18n from '../i18n';
import {
	decodeLightningInvoice,
	getInvoiceFromUri,
	getLightningBalance,
	isLightningUri,
} from '../lightning';
import { findLnUrl, handleLnurlAuth, isLnurlAddress } from '../lnurl';
import { EAvailableNetwork } from '../networks';
import { showToast } from '../notifications';
import { getSlashPayConfig, handleSlashtagURL } from '../slashtags';
import { getSelectedNetwork, getSelectedWallet } from '../wallet';
import { getStore } from '../../store/helpers';
import { balanceSelector } from '../../store/reselect/aggregations';
import { defaultExternalWalletSelector } from '../../store/reselect/externalWallets';
import {
	getOnchainTransactionData,
	getTransactionInputValue,
} from '../wallet/transactions';
import {
	EQRDataType,
	QRData,
	TBitcoinData,
	TLightningData,
	TPaymentUri,
	paymentTypes,
} from './types';

/**
 * Parses, validates and handles all scanned/pasted information provided by the user.
 * @param {string} data
 * @param {'mainScanner' | 'send'} [source]
 * @param {EAvailableNetwork} [selectedNetwork]
 * @param {EQRDataType} [skip]
 * @param {boolean} [showErrors]
 */
export const processUri = async ({
	uri,
	source = 'mainScanner',
	selectedNetwork = getSelectedNetwork(),
	skipLightning,
	showErrors = true,
	validateOnly = false,
}: {
	uri: string;
	source?: 'mainScanner' | 'send';
	selectedNetwork?: EAvailableNetwork;
	skipLightning?: boolean;
	showErrors?: boolean;
	validateOnly?: boolean;
}): Promise<Result<string>> => {
	console.log('[processUri] Starting with:', { uri: uri.substring(0, 50), source, validateOnly });
	
	// Parse
	const parseResult = await parseUri(uri, selectedNetwork);
	if (parseResult.isErr()) {
		console.error('[processUri] Parse failed:', parseResult.error.message);
		const errorMessage = parseResult.error.message;
		if (showErrors) {
			showToast({
				type: 'warning',
				title: i18n.t('other:scan_err_decoding'),
				description: errorMessage,
			});
		}
		return err(errorMessage);
	}

	console.log('[processUri] Parsed successfully:', parseResult.value.type);

	// Validate & Prcoess
	let data = parseResult.value;
	let paymentData: TPaymentUri | undefined;

	// Check if we're dealing with a Bitcoin payment request.
	if (
		data.type === EQRDataType.unified ||
		data.type === EQRDataType.onchain ||
		data.type === EQRDataType.lightning
	) {
		paymentData = data;
		console.log('[processUri] Is payment data, type:', data.type);
	}

	if (data.type === EQRDataType.slashtag) {
		const isSend = source === 'send';
		const { contacts } = getSlashtagsStore();
		const parsed = parse(data.url);
		const hasAddedContact = contacts[parsed.id];

		// If we're in the send flow or the contact has already been added, process for slashpay.
		if (isSend || hasAddedContact) {
			const slashPayResult = await processSlashPayUrl(data.url);
			if (slashPayResult.isErr()) {
				if (showErrors) {
					showToast({
						type: 'warning',
						title: i18n.t('slashtags:error_pay_title'),
						description: slashPayResult.error.message,
					});
				}
				return err(slashPayResult.error.message);
			}

			paymentData = slashPayResult.value;
		}
	}

	// Validate and process payment data.
	if (paymentData) {
		console.log('[processUri] Processing payment data...');
		const processResult = await processPaymentData({
			data: paymentData,
			skipLightning,
			showErrors,
		});
		if (processResult.isErr()) {
			console.error('[processUri] processPaymentData failed:', processResult.error.message);
			return err(processResult.error.message);
		}
		console.log('[processUri] Payment data processed successfully');
		data = processResult.value;
	}

	if (source === 'send' && !paymentTypes.includes(data.type)) {
		console.error('[processUri] Invalid payment data for send source');
		return err('Invalid payment data');
	}

	// Handle
	if (data && !validateOnly) {
		console.log('[processUri] Calling handleData...');
		await handleData({ data, uri, source });
		console.log('[processUri] handleData completed');
	}

	console.log('[processUri] Process complete');
	return ok('');
};

/**
 * Parses any URI the app can handle and returns the data in a unified format.
 * @param {string} data
 * @param {EAvailableNetwork} [selectedNetwork]
 */
export const parseUri = async (
	uri: string,
	selectedNetwork: EAvailableNetwork = getSelectedNetwork(),
): Promise<Result<QRData>> => {
	uri = uri.trim();

	// Remove prefix from Bitkit specific deep links
	if (uri.startsWith('bitkit://')) {
		uri = uri.replace('bitkit://', '');
	}

	// Orange Ticket
	if (uri.startsWith('ticket-')) {
		const [_, ...rest] = uri.split('-');
		const ticketId = rest.join('-');
		if (ticketId) {
			return ok({ type: EQRDataType.orangeTicket, ticketId });
		}
	}

	// Gift Code
	if (uri.startsWith('gift-')) {
		const [_, code, amount] = uri.split('-');
		if (code && amount) {
			return ok({
				type: EQRDataType.gift,
				code,
				amount: Number.parseInt(amount),
			});
		}
	}

	// Treasure hunt
	// Airdrop
	if (uri.includes('cutt.ly/VwQFzhJJ') || uri.includes('bitkit.to/drone')) {
		const chestId = '2gZxrqhc';
		return ok({ type: EQRDataType.treasureHunt, chestId });
	}
	// Universal links
	if (uri.includes('bitkit.to/treasure-hunt')) {
		const url = new URLParse(uri, true);
		const chestId = url.query.chest!;

		if (chestId) {
			return ok({ type: EQRDataType.treasureHunt, chestId });
		}
	}
	// Deeplinks (fallback)
	if (uri.includes('bitkit:chest')) {
		const chestId = uri.split('-')[1];

		if (chestId) {
			return ok({ type: EQRDataType.treasureHunt, chestId });
		}
	}

	// Slashtags
	if (uri.startsWith('slashauth:')) {
		return ok({ type: EQRDataType.slashAuth, url: uri });
	}
	if (uri.startsWith('slash:')) {
		return ok({ type: EQRDataType.slashtag, url: uri });
	}

	// Pubky Auth
	if (uri.startsWith('pubkyauth:')) {
		return ok({ type: EQRDataType.pubkyAuth, url: uri });
	}

	// LNURL
	const lnUrl = findLnUrl(uri);
	if (lnUrl) {
		// Attempt to handle any LNURL request.
		const res = await getLNURLParams(lnUrl);
		if (res.isOk()) {
			const params = res.value;

			if ('tag' in params) {
				if (params.tag === 'login') {
					return ok({
						type: EQRDataType.lnurlAuth,
						lnUrlParams: params,
					});
				}
				if (params.tag === 'withdrawRequest') {
					return ok({
						type: EQRDataType.lnurlWithdraw,
						lnUrlParams: params,
					});
				}
				if (params.tag === 'channelRequest') {
					return ok({
						type: EQRDataType.lnurlChannel,
						lnUrlParams: params,
					});
				}
				if (params.tag === 'payRequest') {
					return ok({
						type: EQRDataType.lnurlPay,
						lnUrlParams: params,
					});
				}
			}
		} else {
			return err(res.error.message);
		}
	}

	if (isLnurlAddress(uri)) {
		const res = await processLnurlAddress(uri);
		if (res.isOk()) {
			const params = res.value;
			return ok({
				type: EQRDataType.lnurlAddress,
				lnUrlParams: params,
				address: uri,
			});
		}
		return err(res.error.message);
	}

	let error = i18n.t('other:scan.error.generic');
	let bitcoinData: TBitcoinData | undefined;
	let lightningData: TLightningData | undefined;

	// Check for Lightning invoice
	let lightningInvoice = '';

	if (isLightningUri(uri)) {
		// Check if uri is a plain Lightning URI or payment request
		lightningInvoice = getInvoiceFromUri(uri);
	} else {
		// Check if BIP21 unified URI w/ lightning invoice
		try {
			// types are wrong for package 'bip21'
			const { options } = bip21.decode(uri) as {
				address: string;
				options: { [key: string]: string };
			};

			if (options.lightning) {
				lightningInvoice = options.lightning;
			}
		} catch (e) {
			console.log(e);
		}
	}

	if (lightningInvoice) {
		// Decode invoice to get amount and message
		const decodeResult = await decodeLightningInvoice(lightningInvoice);
		if (decodeResult.isOk()) {
			const invoice = decodeResult.value;
			lightningData = {
				type: EQRDataType.lightning,
				lightningInvoice,
				amount: invoice.amount_satoshis ?? 0,
				message: invoice.description,
				isExpired: invoice.is_expired,
			};
		} else {
			error = decodeResult.error.message;
		}
	}

	// Only check for on-chain data if we don't have a plain Lightning invoice
	// (we still check for BIP21 unified URIs which might have both)
	if (!isLightningUri(uri)) {
		// Check if plain bitcoin address or BIP21 unified URI
		// Validate address for selected network
		// TODO: return specific error for network mismatch in beignet
		const onChainParseResponse = parseOnChainPaymentRequest(
			uri,
			EAvailableNetworks[selectedNetwork],
		);
		if (onChainParseResponse.isOk()) {
			const { address, sats, message } = onChainParseResponse.value;
			bitcoinData = {
				type: EQRDataType.onchain,
				address,
				network: selectedNetwork,
				amount: sats,
				message,
			};
		} else {
			error = i18n.t('other:scan.error.generic');
			console.log(onChainParseResponse.error.message);
		}
	}

	if (bitcoinData && lightningData) {
		// If we have both bitcoin and lightning data, return unified
		return ok({
			...bitcoinData,
			...lightningData,
			type: EQRDataType.unified,
		});
	}

	if (bitcoinData) {
		return ok(bitcoinData);
	}

	if (lightningData) {
		return ok(lightningData);
	}

	// Check if node connection URI
	const dataSplit = uri.split(':');
	if (dataSplit.length === 2 && dataSplit[0].includes('@')) {
		return ok({ type: EQRDataType.nodeId, uri });
	}

	// Specific errors
	if (uri.includes('.onion')) {
		return err(i18n.t('lightning:error_add_tor'));
	}

	return err(error);
};

/**
 * Validate any payment data for affordability and transform it if necessary.
 * If unable to pay the provided lightning invoice it will defer to on-chain.
 * If unable to pay the requested on-chain amount it will return only the on-chain address and set sats to zero.
 * @param {QRData} data
 * @param {boolean} [showErrors]
 */
export const processPaymentData = async ({
	data,
	skipLightning,
	showErrors = true,
}: {
	data: TPaymentUri;
	skipLightning?: boolean;
	showErrors?: boolean;
}): Promise<Result<TPaymentUri>> => {
	console.log('[processPaymentData] Starting with type:', data.type, 'amount:', data.amount);
	
	// Check if external wallet is configured - skip ALL validation if so
	const state = getStore();
	const defaultExternalWallet = defaultExternalWalletSelector(state);
	const hasExternalWallet = defaultExternalWallet && state.externalWallets[defaultExternalWallet]?.connected;
	
	console.log('[processPaymentData] External wallet check:', {
		defaultExternalWallet,
		hasExternalWallet,
		connected: defaultExternalWallet ? state.externalWallets[defaultExternalWallet]?.connected : false,
	});
	
	// External wallet handles everything - no validation needed
	if (hasExternalWallet) {
		console.log('[processPaymentData] External wallet active - skipping all validation');
		return ok(data);
	}
	
	console.log('[processPaymentData] No external wallet - running standard validation');
	
	// Get balance including external wallet balance from Redux store
	const balance = balanceSelector(getStore());
	let { onchainBalance, spendingBalance } = balance;
	const isUnified = data.type === EQRDataType.unified;
	const isOnchain = data.type === EQRDataType.onchain;
	const isLightning = data.type === EQRDataType.lightning;
	const prefersOnchain =
		isUnified && data.preferredPaymentMethod === EQRDataType.onchain;

	let result = data;

	if (!isOnchain && !prefersOnchain && !skipLightning) {
		// Ensure we can afford to pay the lightning invoice
		const canAfford = spendingBalance !== 0 && spendingBalance >= data.amount;

		if (canAfford && !data.isExpired) {
			return ok(data);
		}

		if (showErrors) {
			if (data.isExpired && !isUnified) {
				showToast({
					type: 'warning',
					title: i18n.t('other:scan_err_decoding'),
					description: i18n.t('other:scan.error.expired'),
				});
			}

			if (!canAfford) {
				const delta = data.amount - spendingBalance;
				const { bitcoinFormatted } = getBitcoinDisplayValues({
					satoshis: delta,
					denomination: EDenomination.modern,
				});

				if (!isUnified) {
					showToast({
						type: 'warning',
						title: i18n.t('other:pay_insufficient_spending'),
						description: i18n.t(
							'other:pay_insufficient_spending_amount_description',
							{ amount: bitcoinFormatted },
						),
					});
				}
			}
		}

		if (isUnified) {
			// If the lightning invoice can't be used, transform to on-chain
			result = { ...data, type: EQRDataType.onchain };
		}
	}

	if (!isLightning) {
		// If we're skipping lightning, transform unified to onchain
		if (data.type === EQRDataType.unified && skipLightning) {
			result = { ...data, type: EQRDataType.onchain };
		}

		// In the event we have preset inputs from address viewer.
		const { inputs } = getOnchainTransactionData();
		const inputValue = getTransactionInputValue({ inputs });
		if (inputValue > onchainBalance) {
			onchainBalance = inputValue;
		}

		// Ensure we can afford to pay the onchain invoice
		const hasOnchain = onchainBalance !== 0;
		const canAfford = hasOnchain && onchainBalance > data.amount;

		if (canAfford) {
			return ok(result);
		}

		// If we can't afford it, show a warning
		if (showErrors) {
			if (hasOnchain) {
				const delta = data.amount - onchainBalance;
				const { bitcoinFormatted } = getBitcoinDisplayValues({
					satoshis: delta,
					denomination: EDenomination.modern,
				});

				showToast({
					type: 'warning',
					title: i18n.t('other:pay_insufficient_savings'),
					description: i18n.t(
						'other:pay_insufficient_savings_amount_description',
						{ amount: bitcoinFormatted },
					),
				});
			} else {
				showToast({
					type: 'warning',
					title: i18n.t('other:pay_insufficient_savings'),
					description: i18n.t('other:pay_insufficient_savings_description'),
				});
			}
		}

		if (hasOnchain) {
			// If we can't afford it, but we have on-chain balance, set amount to zero
			return ok({ ...data, type: EQRDataType.onchain, amount: 0 });
		}
	}

	return err(i18n.t('other:pay_insufficient_savings'));
};

// Get the Slashpay daata and return it in a format that can be used by the app.
export const processSlashPayUrl = async (
	url: string,
): Promise<Result<TPaymentUri>> => {
	try {
		const payConfig = await getSlashPayConfig(url);

		let address: string | undefined;
		let lightningData: TLightningData | undefined;

		const preferredPaymentMethod =
			payConfig[0]?.type === 'lightningInvoice'
				? EQRDataType.lightning
				: EQRDataType.onchain;

		const promises = payConfig.map(async ({ type, value }) => {
			switch (type) {
				case EAddressType.p2wpkh:
				case EAddressType.p2sh:
				case EAddressType.p2pkh: {
					const { isValid } = validateAddress({ address: value });
					if (isValid) {
						address = value;
					}
					break;
				}
				case 'lightningInvoice': {
					// Decode invoice to check if expired
					const decodeResult = await decodeLightningInvoice(value);
					if (decodeResult.isOk()) {
						const invoice = decodeResult.value;
						lightningData = {
							type: EQRDataType.lightning,
							lightningInvoice: value,
							amount: invoice.amount_satoshis ?? 0,
							message: invoice.description,
							isExpired: invoice.is_expired,
							slashTagsUrl: url,
						};
					}
					break;
				}
			}
		});

		await Promise.all(promises);

		if (address && lightningData) {
			return ok({
				...lightningData,
				address,
				preferredPaymentMethod,
				type: EQRDataType.unified,
			});
		}

		if (lightningData) {
			return ok(lightningData);
		}

		if (address) {
			return ok({
				type: EQRDataType.onchain,
				address,
				amount: 0,
				slashTagsUrl: url,
			});
		}

		return err(i18n.t('slashtags:error_pay_empty_msg'));
	} catch (e) {
		console.log('processSlashPayUrl error', e);
		return err(i18n.t('other:try_again'));
	}
};

/**
 * This method will handle all actions required for each valid URI passed.
 * @param {QRData} data
 * @param {string} uri
 */
const handleData = async ({
	data,
	uri,
	source,
}: {
	data: QRData;
	uri: string;
	source: 'mainScanner' | 'send';
}): Promise<Result<string>> => {
	console.log('[handleData] Starting with type:', data.type, 'source:', source);
	const selectedWallet = getSelectedWallet();
	const selectedNetwork = getSelectedNetwork();
	const { type } = data;

	switch (type) {
		case EQRDataType.slashtag: {
			const onSuccess = (): void => {
				closeSheet('addContact');
				rootNavigation.navigate('ContactEdit', { url: data.url });
			};

			handleSlashtagURL(data.url, onSuccess);
			return ok('');
		}
		case EQRDataType.slashAuth: {
			showToast({
				type: 'error',
				title: i18n.t('slashtags:auth_depricated_title'),
				description: i18n.t('slashtags:auth_depricated_msg'),
			});
			return ok('');
		}
		case EQRDataType.unified: {
			const { enableQuickpay, quickpayAmount } = getSettingsStore();
			const {
				address,
				amount,
				message,
				lightningInvoice,
				slashTagsUrl,
				preferredPaymentMethod,
			} = data;

			const quickpayAmountSats = fiatToBitcoinUnit({
				amount: quickpayAmount,
				currency: 'USD',
			});

			if (enableQuickpay && amount && amount < quickpayAmountSats) {
				const screen = 'Quickpay';
				const params = { invoice: lightningInvoice, amount };

				if (source === 'mainScanner') {
					// If BottomSheet is not open yet (MainScanner)
					showSheet('send', { screen, ...params });
				} else {
					// If BottomSheet is already open (SendScanner)
					sendNavigation.navigate(screen, params);
				}

				return ok('');
			}

			// Reset existing transaction state and prepare for a new one.
			await resetSendTransaction();
			await setupOnChainTransaction();

			// Determine initial payment method for 0 amount unified invoice
			const paymentMethod = preferredPaymentMethod ?? 'lightning';
			dispatch(updateSendTransaction({ paymentMethod, uri }));

			const screen = amount ? 'ReviewAndSend' : 'Amount';

			if (source === 'mainScanner') {
				// If BottomSheet is not open yet (MainScanner)
				showSheet('send', { screen });
			} else {
				// If BottomSheet is already open (SendScanner)
				sendNavigation.navigate(screen);
			}

			updateBeignetSendTransaction({
				label: message,
				outputs: [{ address, value: amount, index: 0 }],
				lightningInvoice,
				slashTagsUrl,
			});

			return ok('');
		}
		case EQRDataType.onchain: {
			const { address, amount, message, slashTagsUrl } = data;

			// Reset existing transaction state and prepare for a new one.
			await resetSendTransaction();
			await setupOnChainTransaction();

			dispatch(updateSendTransaction({ paymentMethod: 'onchain', uri }));

			updateBeignetSendTransaction({
				label: message,
				outputs: [{ address, value: amount, index: 0 }],
				slashTagsUrl,
			});

			if (source === 'mainScanner') {
				// If BottomSheet is not open yet (MainScanner)
				showSheet('send', { screen: 'Amount' });
			} else {
				// If BottomSheet is already open (SendScanner)
				sendNavigation.navigate('Amount');
			}

			return ok('');
		}
		case EQRDataType.lightning: {
			const { lightningInvoice, amount, slashTagsUrl } = data;
			const { enableQuickpay, quickpayAmount } = getSettingsStore();
			const quickpayAmountSats = fiatToBitcoinUnit({
				amount: quickpayAmount,
				currency: 'USD',
			});

			console.log('[scanner] Processing Lightning invoice:', {
				amount,
				lightningInvoice: `${lightningInvoice.substring(0, 30)}...`,
				source,
			});

			if (enableQuickpay && amount && amount < quickpayAmountSats) {
				console.log('[scanner] Using quickpay for Lightning invoice');
				const screen = 'Quickpay';
				const params = { invoice: lightningInvoice, amount };

				if (source === 'mainScanner') {
					// If BottomSheet is not open yet (MainScanner)
					showSheet('send', { screen, ...params });
				} else {
					// If BottomSheet is already open (SendScanner)
					sendNavigation.navigate(screen, params);
				}

				return ok('');
			}

			console.log('[scanner] Setting payment method to lightning');
			dispatch(updateSendTransaction({ paymentMethod: 'lightning', uri }));

			const invoiceAmount = amount ?? 0;
			const screen = invoiceAmount ? ('ReviewAndSend' as const) : ('Amount' as const);

			console.log('[scanner] Navigating to screen:', screen, 'with amount:', invoiceAmount);

			// Update Beignet transaction with invoice BEFORE navigation
			console.log('[scanner] Updating Beignet transaction with invoice');
			updateBeignetSendTransaction({
				outputs: [{ address: '', value: invoiceAmount, index: 0 }],
				lightningInvoice,
				slashTagsUrl,
			});

			if (source === 'mainScanner') {
				// If BottomSheet is not open yet (MainScanner)
				console.log('[scanner] Opening send sheet with screen:', screen);
				showSheet('send', { screen });
			} else {
				// If BottomSheet is already open
				// Due to NavigationIndependentTree in bottom-sheet v5, navigation within
				// the sheet doesn't work reliably. Close and reopen with correct initial screen.
				console.log('[scanner] Sheet already open, closing and reopening with:', screen);
				console.log('[scanner] Calling closeSheet...');
				
				// Close the sheet
				closeSheet('send');
				
				// Wait for sheet to close, then reopen
				// In v5, we need to wait for the close animation to complete
				setTimeout(() => {
					console.log('[scanner] Opening send sheet with screen:', screen);
					showSheet('send', { screen });
					console.log('[scanner] showSheet called');
				}, 400); // Increased delay for v5 animation
			}

			console.log('[scanner] Lightning invoice processing complete');
			return ok('');
		}
		case EQRDataType.lnurlAddress:
		case EQRDataType.lnurlPay: {
			const pParams = data.lnUrlParams;

			//Convert msats to sats.
			pParams.minSendable = Math.floor(pParams.minSendable / 1000);
			pParams.maxSendable = Math.floor(pParams.maxSendable / 1000);

			// TODO Determine if we have enough sending capacity before proceeding.
			// const lightningBalance = getLightningBalance({ includeReserve: false });

			dispatch(updateSendTransaction({ paymentMethod: 'lightning' }));

			// Check if there's a connected external default wallet
			const state = getStore();
			const defaultExternalWallet = defaultExternalWalletSelector(state);
			const hasConnectedExternalWallet = defaultExternalWallet && state.externalWallets[defaultExternalWallet]?.connected;

			// Only check internal LDK balance if no external wallet is available
			if (!hasConnectedExternalWallet) {
				const lightningBalance = getLightningBalance({ includeReserve: false });

				if (lightningBalance.localBalance < pParams.minSendable) {
					showToast({
						type: 'warning',
						title: i18n.t('other:lnurl_pay_error'),
						description: i18n.t('other:lnurl_pay_error_no_capacity'),
					});
					return err(
						'Not enough outbound/sending capacity to complete lnurl-pay request.',
					);
				}
			}

			if (pParams.minSendable === pParams.maxSendable) {
				const amount = pParams.minSendable;
				if (source === 'mainScanner') {
					// If BottomSheet is not open yet (MainScanner)
					showSheet('send', {
						screen: 'LNURLConfirm',
						pParams,
						amount,
						url: uri,
					});
				} else {
					// If BottomSheet is already open (SendScanner)
					sendNavigation.navigate('LNURLConfirm', {
						pParams,
						amount,
						url: uri,
					});
				}
				sendNavigation.navigate('LNURLConfirm', {
					pParams,
					amount,
					url: uri,
				});
			} else {
				if (source === 'mainScanner') {
					// If BottomSheet is not open yet (MainScanner)
					showSheet('send', {
						screen: 'LNURLAmount',
						pParams: pParams,
						url: uri,
					});
				} else {
					// If BottomSheet is already open (SendScanner)
					sendNavigation.navigate('LNURLAmount', { pParams, url: uri });
				}
			}

			return ok('');
		}
		case EQRDataType.lnurlWithdraw: {
			const params = data.lnUrlParams;

			//Convert msats to sats.
			params.minWithdrawable = Math.floor(params.minWithdrawable / 1000);
			params.maxWithdrawable = Math.floor(params.maxWithdrawable / 1000);

			dispatch(updateSendTransaction({ paymentMethod: 'lightning' }));

			if (params.minWithdrawable > params.maxWithdrawable) {
				showToast({
					type: 'warning',
					title: i18n.t('other:lnurl_withdr_error'),
					description: i18n.t('other:lnurl_withdr_error_minmax'),
				});
				return err(
					'Wrong lnurl-withdraw params: minWithdrawable > maxWithdrawable.',
				);
			}

			// Determine if we have enough receiving capacity before proceeding.
			const lightningBalance = getLightningBalance({ includeReserve: false });

			if (lightningBalance.remoteBalance < params.minWithdrawable) {
				showToast({
					type: 'warning',
					title: i18n.t('other:lnurl_withdr_error'),
					description: i18n.t('other:lnurl_withdr_error_no_capacity'),
				});
				return err(
					'Not enough inbound/receiving capacity to complete lnurl-withdraw request.',
				);
			}

			showSheet('lnurlWithdraw', params);
			return ok('');
		}
		case EQRDataType.lnurlChannel: {
			const params = data.lnUrlParams;
			rootNavigation.navigate('TransferRoot', {
				screen: 'LNURLChannel',
				params: { cParams: params },
			});
			return ok('');
		}
		case EQRDataType.lnurlAuth: {
			const params = data.lnUrlParams;
			await handleLnurlAuth({ params, selectedWallet, selectedNetwork });
			return ok('');
		}
		case EQRDataType.orangeTicket: {
			showSheet('orangeTicket', { ticketId: data.ticketId });
			return ok('');
		}
		case EQRDataType.nodeId: {
			rootNavigation.navigate('TransferRoot', {
				screen: 'ExternalConnection',
				params: { peer: data.uri },
			});
			closeSheet('send');
			return ok('');
		}
		case EQRDataType.treasureHunt: {
			showSheet('treasureHunt', { chestId: data.chestId });
			return ok('');
		}
		case EQRDataType.pubkyAuth: {
			showSheet('pubkyAuth', { url: data.url });
			return ok('');
		}
		case EQRDataType.gift: {
			showSheet('gift', { code: data.code, amount: data.amount });
			return ok('');
		}
	}
};
