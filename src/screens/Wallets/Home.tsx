import React, { memo, ReactElement, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { RefreshControl, ScrollView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import BalanceHeader from '../../components/BalanceHeader';
import Balances from '../../components/Balances';
import DetectSwipe from '../../components/DetectSwipe';
import SafeAreaInset from '../../components/SafeAreaInset';
import Suggestions from '../../components/Suggestions';
import Widgets from '../../components/Widgets';
import Button from '../../components/buttons/Button';
import useColors from '../../hooks/colors';
import { useAppDispatch, useAppSelector } from '../../hooks/redux';
import { useBalance } from '../../hooks/wallet';
import ActivityListShort from '../../screens/Activity/ActivityListShort';
import AppUpdate from '../../sheets/AppUpdate';
import BackupPrompt from '../../sheets/BackupPrompt';
import HighBalanceWarning from '../../sheets/HighBalanceWarning';
import QuickPayPrompt from '../../sheets/QuickPayPrompt';
import {
	enableSwipeToHideBalanceSelector,
	hideBalanceSelector,
	hideOnboardingMessageSelector,
	showWidgetsSelector,
	enableDevOptionsSelector,
} from '../../store/reselect/settings';
import {
	ignoresHideBalanceToastSelector,
	scanAllAddressesTimestampSelector,
} from '../../store/reselect/user';
import {
	defaultExternalWalletSelector,
	connectedExternalWalletsSelector,
} from '../../store/reselect/externalWallets';
import { resetActivityState } from '../../store/slices/activity';
import { updateSettings } from '../../store/slices/settings';
import { ignoreHideBalanceToast, updateUser } from '../../store/slices/user';
import { setDefaultExternalWallet, TExternalWalletType } from '../../store/slices/externalWallets';
import { View as ThemedView, TouchableOpacity } from '../../styles/components';
import { showToast } from '../../utils/notifications';
import { refreshWallet } from '../../utils/wallet';
import { fetchDefaultExternalWalletInfo } from '../../store/utils/externalWallets';
import { getStore } from '../../store/helpers';
import { DownArrow } from '../../styles/icons';
import { BodyMSB, CaptionB } from '../../styles/text';
import Header from './Header';
import MainOnboarding from './MainOnboarding';

// External Wallet Dropdown Component
const ExternalWalletDropdown = (): ReactElement | null => {
	const dispatch = useAppDispatch();
	const defaultWallet = useAppSelector(defaultExternalWalletSelector);
	const connectedWallets = useAppSelector(connectedExternalWalletsSelector);
	const [isOpen, setIsOpen] = useState(false);
	
	// Automatically set first connected wallet as default if none is selected
	React.useEffect(() => {
		if (!defaultWallet && connectedWallets.length > 0) {
			dispatch(setDefaultExternalWallet(connectedWallets[0]));
		}
	}, [defaultWallet, connectedWallets, dispatch]);
	
	// Fetch getInfo when component loads or default wallet changes
	React.useEffect(() => {
		if (defaultWallet) {
			// Fetch node info from the default wallet
			fetchDefaultExternalWalletInfo(getStore);
		}
	}, [defaultWallet]);
	
	// Don't show dropdown if no wallets are connected
	if (connectedWallets.length === 0) {
		return null;
	}
	
	const walletLabels: Record<TExternalWalletType, string> = {
		lnd: 'LND',
		cln: 'Core Lightning',
		phoenixd: 'Phoenix',
		strike: 'Strike',
		blink: 'Blink',
		speed: 'Speed',
		nwc: 'NWC',
	};
	
	const handleWalletSelect = (walletType: TExternalWalletType) => {
		dispatch(setDefaultExternalWallet(walletType));
		setIsOpen(false);
		showToast({
			type: 'success',
			title: 'Default Wallet Updated',
			description: `${walletLabels[walletType]} is now your default external wallet`,
		});
	};
	
	const currentLabel = defaultWallet ? walletLabels[defaultWallet] : 'Select Wallet';
	
	return (
		<View style={styles.dropdownContainer}>
			<CaptionB color="secondary" style={styles.dropdownLabel}>
				Default External Wallet
			</CaptionB>
			<TouchableOpacity
				style={styles.dropdown}
				onPress={() => setIsOpen(!isOpen)}
				activeOpacity={0.7}
			>
				<BodyMSB>{currentLabel}</BodyMSB>
				<DownArrow color="secondary" width={12} height={12} />
			</TouchableOpacity>
			
			{isOpen && (
				<View style={styles.dropdownMenu}>
					{connectedWallets.map((walletType) => (
						<TouchableOpacity
							key={walletType}
							style={[
								styles.dropdownItem,
								defaultWallet === walletType && styles.dropdownItemSelected
							]}
							onPress={() => handleWalletSelect(walletType)}
							activeOpacity={0.7}
						>
							<BodyMSB color={defaultWallet === walletType ? 'brand' : undefined}>
								{walletLabels[walletType]}
							</BodyMSB>
						</TouchableOpacity>
					))}
				</View>
			)}
		</View>
	);
};

const HEADER_HEIGHT = 46;

const Home = (): ReactElement => {
	const [refreshing, setRefreshing] = useState(false);
	const colors = useColors();
	const dispatch = useAppDispatch();
	const { totalBalance } = useBalance();
	const enableSwipeToHideBalance = useAppSelector(
		enableSwipeToHideBalanceSelector,
	);
	const hideBalance = useAppSelector(hideBalanceSelector);
	const ignoresHideBalanceToast = useAppSelector(
		ignoresHideBalanceToastSelector,
	);
	const scanAllAddressesTimestamp = useAppSelector(
		scanAllAddressesTimestampSelector,
	);
	const hideOnboardingSetting = useAppSelector(hideOnboardingMessageSelector);
	const showWidgets = useAppSelector(showWidgetsSelector);
	const enableDevOptions = useAppSelector(enableDevOptionsSelector);
	const insets = useSafeAreaInsets();
	const { t } = useTranslation('wallet');

	const toggleHideBalance = (): void => {
		const enabled = !hideBalance;
		dispatch(updateSettings({ hideBalance: enabled }));
		if (!ignoresHideBalanceToast && enabled) {
			showToast({
				type: 'info',
				title: t('balance_hidden_title'),
				description: t('balance_hidden_message'),
				visibilityTime: 5000,
			});
			dispatch(ignoreHideBalanceToast());
		}
	};

	const onRefresh = async (): Promise<void> => {
		// only scan all addresses once per hour
		const scanAllAddresses =
			Date.now() - scanAllAddressesTimestamp > 1000 * 60 * 60;
		dispatch(updateUser({ scanAllAddressesTimestamp: Date.now() }));
		setRefreshing(true);
		
		// Refresh wallet data
		await refreshWallet({ scanAllAddresses });
		
		// Refresh external wallet info if we have one configured
		try {
			const { fetchDefaultExternalWalletInfo } = await import('../../store/utils/externalWallets');
			await fetchDefaultExternalWalletInfo(() => getStore());
		} catch (error) {
			console.error('Error refreshing external wallet info:', error);
		}
		
		setRefreshing(false);
	};

	const resetActivity = (): void => {
		dispatch(resetActivityState());
		showToast({
			type: 'success',
			title: 'Activity Reset',
			description: 'Activity history has been cleared',
		});
	};

	// Fetch default external wallet info on initial load
	React.useEffect(() => {
		fetchDefaultExternalWalletInfo(getStore);
	}, []);

	const hideOnboarding = hideOnboardingSetting || totalBalance > 0;

	return (
		<>
			<ThemedView style={styles.root}>
				<SafeAreaInset type="top" />
				{/* Need this wrapper for Android e2e tests */}
				<View style={[styles.header, { top: insets.top }]}>
					<Header />
				</View>

				<ScrollView
					contentContainerStyle={[
						styles.content,
						hideOnboarding && styles.scrollView,
					]}
					disableScrollViewPanResponder={true}
					showsVerticalScrollIndicator={false}
					testID="HomeScrollView"
					refreshControl={
						<RefreshControl
							refreshing={refreshing}
							tintColor={colors.refreshControl}
							progressViewOffset={HEADER_HEIGHT}
							onRefresh={onRefresh}
						/>
					}>
					<DetectSwipe
						enabled={enableSwipeToHideBalance}
						onSwipeLeft={toggleHideBalance}
						onSwipeRight={toggleHideBalance}>
						<View>
							<BalanceHeader />
						</View>
					</DetectSwipe>

					{/* External Wallet Dropdown */}
					<ExternalWalletDropdown />

					{hideOnboarding ? (
						<>
							<Balances />
							<Suggestions />
							<View style={styles.contentPadding}>
								{showWidgets && <Widgets />}
								<ActivityListShort />
								{enableDevOptions && (
									<View style={styles.devOptions}>
										<Button
											style={styles.resetButton}
											text="Reset Activity"
											size="large"
											variant="secondary"
											onPress={resetActivity}
										/>
									</View>
								)}
							</View>
						</>
					) : (
						<MainOnboarding style={styles.contentPadding} />
					)}
				</ScrollView>
			</ThemedView>

			{/* Timed/conditional bottom-sheets */}
			<BackupPrompt />
			<HighBalanceWarning />
			<AppUpdate />
			<QuickPayPrompt />
		</>
	);
};

const styles = StyleSheet.create({
	root: {
		flex: 1,
	},
	header: {
		position: 'absolute',
		left: 0,
		right: 0,
		zIndex: 1,
	},
	content: {
		flexGrow: 1,
		paddingTop: HEADER_HEIGHT,
	},
	scrollView: {
		paddingBottom: 130,
	},
	contentPadding: {
		paddingHorizontal: 16,
	},
	devOptions: {
		marginTop: 16,
		marginBottom: 16,
	},
	resetButton: {
		marginTop: 8,
	},
	dropdownContainer: {
		marginHorizontal: 16,
		marginTop: 16,
		marginBottom: 8,
	},
	dropdownLabel: {
		marginBottom: 8,
	},
	dropdown: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		paddingHorizontal: 16,
		paddingVertical: 12,
		backgroundColor: 'rgba(255, 255, 255, 0.08)',
		borderRadius: 8,
		borderWidth: 1,
		borderColor: 'rgba(255, 255, 255, 0.16)',
	},
	dropdownMenu: {
		position: 'absolute',
		top: 50,
		left: 0,
		right: 0,
		backgroundColor: '#1F1F1F',
		borderRadius: 8,
		borderWidth: 1,
		borderColor: 'rgba(255, 255, 255, 0.16)',
		shadowColor: '#000',
		shadowOffset: { width: 0, height: 4 },
		shadowOpacity: 0.3,
		shadowRadius: 8,
		elevation: 8,
		zIndex: 1000,
	},
	dropdownItem: {
		paddingHorizontal: 16,
		paddingVertical: 12,
		borderBottomWidth: 1,
		borderBottomColor: 'rgba(255, 255, 255, 0.1)',
	},
	dropdownItemSelected: {
		backgroundColor: 'rgba(255, 149, 0, 0.1)',
	},
});

export default memo(Home);
