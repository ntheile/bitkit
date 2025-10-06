import {
	NavigationIndependentTree,
	createNavigationContainerRef,
	StackActions,
	CommonActions,
} from '@react-navigation/native';
import {
	NativeStackNavigationOptions,
	NativeStackNavigationProp,
	createNativeStackNavigator,
} from '@react-navigation/native-stack';
import { LNURLPayParams } from 'js-lnurl';
import React, { ReactElement, memo } from 'react';

import BottomSheet from '../components/BottomSheet';
import { __E2E__ } from '../constants/env';
import { useLightningBalance } from '../hooks/lightning';
import { useAppSelector } from '../hooks/redux';
import LNURLAmount from '../screens/Wallets/LNURLPay/Amount';
import LNURLConfirm from '../screens/Wallets/LNURLPay/Confirm';
import Address from '../screens/Wallets/Send/Address';
import Amount from '../screens/Wallets/Send/Amount';
import AutoRebalance from '../screens/Wallets/Send/AutoRebalance';
import CoinSelection from '../screens/Wallets/Send/CoinSelection';
import Contacts from '../screens/Wallets/Send/Contacts';
import ErrorScreen from '../screens/Wallets/Send/Error';
import FeeCustom from '../screens/Wallets/Send/FeeCustom';
import FeeRate from '../screens/Wallets/Send/FeeRate';
import Pending from '../screens/Wallets/Send/Pending';
import PinCheck from '../screens/Wallets/Send/PinCheck';
import Quickpay from '../screens/Wallets/Send/Quickpay';
import Recipient from '../screens/Wallets/Send/Recipient';
import ReviewAndSend from '../screens/Wallets/Send/ReviewAndSend';
import Scanner from '../screens/Wallets/Send/Scanner';
import Success from '../screens/Wallets/Send/Success';
import Tags from '../screens/Wallets/Send/Tags';
import {
	setupFeeForOnChainTransaction,
	setupOnChainTransaction,
} from '../store/actions/wallet';
import {
	selectedNetworkSelector,
	selectedWalletSelector,
	transactionSelector,
} from '../store/reselect/wallet';
import {
	defaultExternalWalletSelector,
	connectedExternalWalletsSelector,
} from '../store/reselect/externalWallets';
import { EActivityType } from '../store/types/activity';
import { SheetsParamList } from '../store/types/ui';
import { updateOnchainFeeEstimates } from '../store/utils/fees';
import { refreshLdk } from '../utils/lightning';
import BottomSheetNavigationContainer from './BottomSheetNavigationContainer';

export type SendNavigationProp = NativeStackNavigationProp<SendStackParamList>;

export type SendStackParamList = {
	PinCheck: { onSuccess: () => void };
	Recipient: undefined;
	Contacts: undefined;
	Address: { uri?: string } | undefined;
	Scanner: undefined;
	Amount: undefined;
	CoinSelection: undefined;
	FeeRate: undefined;
	FeeCustom: undefined;
	ReviewAndSend: undefined;
	Tags: undefined;
	AutoRebalance: undefined;
	Pending: { txId: string };
	Quickpay: { invoice: string; amount: number };
	Success: { type: EActivityType; amount: number; txId: string };
	Error: { errorMessage: string };
	LNURLAmount: { pParams: LNURLPayParams; url: string };
	LNURLConfirm: { amount: number; pParams: LNURLPayParams; url: string };
};

const Stack = createNativeStackNavigator<SendStackParamList>();
const screenOptions: NativeStackNavigationOptions = {
	headerShown: false,
	animation: __E2E__ ? 'none' : 'default',
};

/**
 * Helper function to navigate from outside components.
 */
export const navigationRef = createNavigationContainerRef<SendStackParamList>();
export const sendNavigation = {
	navigate<RouteName extends keyof SendStackParamList>(
		...args: RouteName extends unknown
			? undefined extends SendStackParamList[RouteName]
				?
						| [screen: RouteName]
						| [screen: RouteName, params: SendStackParamList[RouteName]]
				: [screen: RouteName, params: SendStackParamList[RouteName]]
			: never
	): void {
		const screenName = args[0];
		const params = args[1];
		
		console.log('[sendNavigation.navigate] Attempting to navigate to:', screenName);
		
		if (navigationRef.isReady()) {
			const state = navigationRef.getState();
			const currentRoute = navigationRef.getCurrentRoute()?.name;

			console.log('[sendNavigation.navigate] Current route:', currentRoute, '-> Next route:', screenName);
			console.log('[sendNavigation.navigate] Navigation state before:', JSON.stringify(state, null, 2));

			if (currentRoute === screenName) {
				console.log(`[sendNavigation.navigate] Already on screen ${currentRoute}. Skipping...`);
				return;
			}

			console.log('[sendNavigation.navigate] Using CommonActions.navigate to add screen to stack');
			
			// Use CommonActions.navigate which should work better with independent navigation trees
			try {
				const navigateAction = CommonActions.navigate({
					name: screenName as string,
					params: params,
				});
				navigationRef.dispatch(navigateAction);
				console.log('[sendNavigation.navigate] Navigate action dispatched successfully');
			} catch (error) {
				console.error('[sendNavigation.navigate] Navigate failed:', error);
			}
			
			// Log state after navigation
			setTimeout(() => {
				if (navigationRef.isReady()) {
					try {
						const newRoute = navigationRef.getCurrentRoute()?.name;
						const newState = navigationRef.getState();
						console.log('[sendNavigation.navigate] After navigation, current route:', newRoute);
						console.log('[sendNavigation.navigate] Navigation state after:', JSON.stringify(newState, null, 2));
						
						// If still not on the right screen, log a warning
						if (newRoute !== screenName) {
							console.warn(`[sendNavigation.navigate] WARNING: Navigation to ${screenName} failed. Still on ${newRoute}`);
						}
					} catch (e) {
						console.error('[sendNavigation.navigate] Error getting post-navigation state:', e);
					}
				} else {
					console.log('[sendNavigation.navigate] Navigation ref not ready after navigation');
				}
			}, 150);
		} else {
			console.log('[sendNavigation.navigate] Navigation not ready, retrying in 200ms...');
			// sendNavigation not ready, try again after a short wait
			setTimeout(() => sendNavigation.navigate(...args), 200);
		}
	},
};

// This is a helper function to get type-safe params for a given screen.
const getScreenParams = <T extends SheetsParamList['send']>(
	data: SheetsParamList['send'] | undefined,
	expectedScreen: NonNullable<T>['screen'],
): T | undefined => {
	if (data?.screen === expectedScreen) {
		return data as T;
	}
	return undefined;
};

const SendNavigation = (): ReactElement => {
	const lightningBalance = useLightningBalance(false);
	const selectedWallet = useAppSelector(selectedWalletSelector);
	const selectedNetwork = useAppSelector(selectedNetworkSelector);
	const transaction = useAppSelector(transactionSelector);
	const defaultExternalWallet = useAppSelector(defaultExternalWalletSelector);
	const connectedWallets = useAppSelector(connectedExternalWalletsSelector);
	const hasExternalWallet = !!defaultExternalWallet && connectedWallets.includes(defaultExternalWallet);

	const onOpen = async (): Promise<void> => {
		// Skip on-chain transaction setup if using external wallet
		if (!transaction?.lightningInvoice && !hasExternalWallet) {
			await updateOnchainFeeEstimates({ forceUpdate: true });
			if (!transaction?.inputs.length) {
				await setupOnChainTransaction();
			}
			setupFeeForOnChainTransaction();
		}

		if (lightningBalance.localBalance > 0) {
			refreshLdk({ selectedWallet, selectedNetwork }).then();
		}
	};

	return (
		<BottomSheet id="send" size="large" testID="SendSheet" onOpen={onOpen}>
			{({ data }: { data: SheetsParamList['send'] }) => {
				const initialRouteName = data?.screen ?? 'Recipient';

				const quickpayParams = getScreenParams<{
					screen: 'Quickpay';
					invoice: string;
					amount: number;
				}>(data, 'Quickpay');

				const lnurlAmountParams = getScreenParams<{
					screen: 'LNURLAmount';
					pParams: LNURLPayParams;
					url: string;
				}>(data, 'LNURLAmount');

				const lnurlConfirmParams = getScreenParams<{
					screen: 'LNURLConfirm';
					pParams: LNURLPayParams;
					url: string;
					amount?: number;
				}>(data, 'LNURLConfirm');

				return (
					<NavigationIndependentTree>
						<BottomSheetNavigationContainer ref={navigationRef}>
							<Stack.Navigator
								initialRouteName={initialRouteName}
								screenOptions={screenOptions}>
								<Stack.Screen name="Recipient" component={Recipient} />
								<Stack.Screen name="Contacts" component={Contacts} />
								<Stack.Screen name="Address" component={Address} />
								<Stack.Screen name="Scanner" component={Scanner} />
								<Stack.Screen name="Amount" component={Amount} />
								<Stack.Screen name="CoinSelection" component={CoinSelection} />
								<Stack.Screen name="FeeRate" component={FeeRate} />
								<Stack.Screen name="FeeCustom" component={FeeCustom} />
								<Stack.Screen name="ReviewAndSend" component={ReviewAndSend} />
								<Stack.Screen name="Tags" component={Tags} />
								<Stack.Screen name="AutoRebalance" component={AutoRebalance} />
								<Stack.Screen name="PinCheck" component={PinCheck} />
								<Stack.Screen name="Pending" component={Pending} />
								<Stack.Screen
									name="Quickpay"
									component={Quickpay}
									initialParams={quickpayParams}
								/>
								<Stack.Screen name="Success" component={Success} />
								<Stack.Screen name="Error" component={ErrorScreen} />
								<Stack.Screen
									name="LNURLAmount"
									component={LNURLAmount}
									initialParams={lnurlAmountParams}
								/>
								<Stack.Screen
									name="LNURLConfirm"
									component={LNURLConfirm}
									initialParams={lnurlConfirmParams}
								/>
							</Stack.Navigator>
						</BottomSheetNavigationContainer>
					</NavigationIndependentTree>
				);
			}}
		</BottomSheet>
	);
};

export default memo(SendNavigation);
