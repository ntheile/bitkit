import React, { memo, ReactElement, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
	Linking,
	Platform,
	Pressable,
	StyleProp,
	StyleSheet,
	View,
	ViewStyle,
} from 'react-native';

import { useAppSelector } from '../../../hooks/redux';
import { SettingsScreenProps } from '../../../navigation/types';
import { backupSelector } from '../../../store/reselect/backup';
import { defaultExternalWalletSelector } from '../../../store/reselect/externalWallets';
import {
	backupStatusSelector,
	channelsStatusSelector,
	electrumStatusSelector,
	internetStatusSelector,
	nodeStatusSelector,
} from '../../../store/reselect/ui';
import { EBackupCategory } from '../../../store/types/backup';
import { THealthState } from '../../../store/types/ui';
import colors, { IColors } from '../../../styles/colors';
import { ScrollView, View as ThemedView } from '../../../styles/components';
import {
	BitcoinSlantedIcon,
	BroadcastIcon,
	CloudCheckIcon,
	GlobeSimpleIcon,
	LightningHollowIcon,
} from '../../../styles/icons';
import { BodyMSB, CaptionB } from '../../../styles/text';
import { i18nTime } from '../../../utils/i18n';
import SettingsView from '../SettingsView';

type TStatusId =
	| 'internet'
	| 'electrum'
	| 'lightning_node'
	| 'lightning_connection'
	| 'backup';

interface IStatusItemProps {
	id: TStatusId;
	Icon: React.FunctionComponent<any>;
	state: THealthState;
	subtitle?: string;
	style?: StyleProp<ViewStyle>;
	onPress?: () => void;
}

const Status = ({
	id,
	Icon,
	state,
	subtitle,
	style,
	onPress,
	customTitle,
}: IStatusItemProps & { customTitle?: string }): ReactElement => {
	const { t } = useTranslation('settings');
	const {
		backgroundColor,
		foregroundColor,
	}: { foregroundColor: keyof IColors; backgroundColor: keyof IColors } =
		React.useMemo(() => {
			switch (state) {
				case 'ready':
					return { backgroundColor: 'green16', foregroundColor: 'green' };
				case 'pending':
					return { backgroundColor: 'yellow16', foregroundColor: 'yellow' };
				case 'error':
					return { backgroundColor: 'red16', foregroundColor: 'red' };
			}
		}, [state]);

	subtitle = subtitle || t(`status.${id}.${state}`);
	const title = customTitle || t(`status.${id}.title`);

	return (
		<Pressable
			style={[styles.status, style]}
			testID={`Status-${id}`}
			onPress={onPress}>
			<View style={styles.iconContainer}>
				<ThemedView style={styles.icon} color={backgroundColor}>
					<Icon color={foregroundColor} width={16} height={16} />
				</ThemedView>
			</View>
			<View style={styles.description}>
				<BodyMSB>{title}</BodyMSB>
				<CaptionB color="secondary">{subtitle}</CaptionB>
			</View>
		</Pressable>
	);
};

const AppStatus = ({
	navigation,
}: SettingsScreenProps<'AppStatus'>): ReactElement => {
	const { t } = useTranslation('settings');
	const { t: tTime } = useTranslation('intl', { i18n: i18nTime });

	const internetState = useAppSelector(internetStatusSelector);
	const electrumState = useAppSelector(electrumStatusSelector);
	const nodeState = useAppSelector(nodeStatusSelector);
	const channelsState = useAppSelector(channelsStatusSelector);
	const backupState = useAppSelector(backupStatusSelector);
	const backup = useAppSelector(backupSelector);
	const defaultExternalWallet = useAppSelector(defaultExternalWalletSelector);
	const externalWallets = useAppSelector((state) => state.externalWallets);

	// Check if we're using external wallets
	const usingExternalWallet = defaultExternalWallet && 
		externalWallets[defaultExternalWallet]?.connected;

	const backupSubtitle = useMemo(() => {
		if (backupState === 'error') {
			return t('status.backup.error');
		}
		const syncTimes = Object.values(EBackupCategory).map((key) => {
			return backup[key].synced;
		});
		const max = Math.max(...syncTimes);
		return tTime('dateTime', {
			v: new Date(max),
			formatParams: {
				v: {
					year: 'numeric',
					month: 'long',
					day: 'numeric',
					hour: 'numeric',
					minute: 'numeric',
				},
			},
		});
	}, [backup, backupState, t, tTime]);

	// Dynamic subtitles based on wallet type
	const getNodeSubtitle = () => {
		if (usingExternalWallet) {
			if (nodeState === 'ready') {
				return `${defaultExternalWallet?.toUpperCase()} Connected`;
			}
			if (nodeState === 'pending') {
				return `Connecting to ${defaultExternalWallet?.toUpperCase()}...`;
			}
			return `Could not connect to ${defaultExternalWallet?.toUpperCase()}`;
		}
		return undefined; // Use default translation
	};

	const getChannelsSubtitle = () => {
		if (usingExternalWallet) {
			if (channelsState === 'ready') {
				return 'Lightning Ready';
			}
			if (channelsState === 'pending') {
				return 'Limited Capacity';
			}
			return 'No Lightning Capacity';
		}
		return undefined; // Use default translation
	};

	const items: (IStatusItemProps & { customTitle?: string })[] = [
		{
			id: 'internet',
			Icon: GlobeSimpleIcon,
			state: internetState,
			onPress: () => {
				const goToSettings = (): void => {
					Platform.OS === 'ios'
						? Linking.openURL('App-Prefs:Settings')
						: Linking.sendIntent('android.settings.SETTINGS');
				};
				goToSettings();
			},
		},
		{
			id: 'electrum',
			Icon: BitcoinSlantedIcon,
			state: electrumState,
			onPress: () => navigation.navigate('ElectrumConfig'),
		},
		{
			id: 'lightning_node',
			Icon: BroadcastIcon,
			state: nodeState,
			customTitle: usingExternalWallet ? 'External Wallet' : undefined,
			subtitle: getNodeSubtitle(),
			onPress: () => navigation.navigate('LightningNodeInfo'),
		},
		{
			id: 'lightning_connection',
			Icon: LightningHollowIcon,
			state: channelsState,
			customTitle: usingExternalWallet ? 'Lightning Capacity' : undefined,
			subtitle: getChannelsSubtitle(),
			onPress: () => navigation.navigate('Channels'),
		},
		{
			id: 'backup',
			Icon: CloudCheckIcon,
			state: backupState,
			subtitle: backupSubtitle,
			onPress: () => navigation.navigate('BackupSettings'),
		},
	];

	return (
		<SettingsView title={t('status.title')} fullHeight={true}>
			<ScrollView style={styles.statusRoot}>
				{items.map((item, index) => {
					const { id, Icon, state, subtitle, customTitle } = item;
					const isLast = index === items.length - 1;

					return (
						<Status
							key={id}
							id={id}
							style={isLast && { borderBottomWidth: 0 }}
							Icon={Icon}
							state={state}
							subtitle={subtitle}
							customTitle={customTitle}
							onPress={item.onPress}
						/>
					);
				})}
			</ScrollView>
		</SettingsView>
	);
};

const styles = StyleSheet.create({
	statusRoot: {
		flex: 1,
	},
	status: {
		marginHorizontal: 16,
		borderBottomWidth: 1,
		borderBottomColor: colors.white10,
		height: 72,
		flexDirection: 'row',
		alignItems: 'center',
	},
	iconContainer: {
		marginRight: 16,
		alignItems: 'center',
	},
	icon: {
		alignItems: 'center',
		justifyContent: 'center',
		borderRadius: 16,
		width: 32,
		height: 32,
	},
	description: {
		flex: 1,
	},
});

export default memo(AppStatus);
