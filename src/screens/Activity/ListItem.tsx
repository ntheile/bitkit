import React, { JSX, memo, ReactElement, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { EPaymentType } from 'beignet';
import Money from '../../components/Money';
import ProfileImage from '../../components/ProfileImage';
import { useFeeText } from '../../hooks/fees';
import { useAppSelector } from '../../hooks/redux';
import { useProfile } from '../../hooks/slashtags';
import { slashTagsUrlSelector } from '../../store/reselect/metadata';
import { walletNodeInfoByTransactionSelector } from '../../store/reselect/externalWallets';
import { transferSelector } from '../../store/reselect/wallet';
import {
	EActivityType,
	IActivityItem,
	TLightningActivityItem,
	TOnchainActivityItem,
} from '../../store/types/activity';
import { ETransferStatus } from '../../store/types/wallet';
import { View as ThemedView, TouchableOpacity } from '../../styles/components';
import {
	ActivityIcon,
	HourglassSimpleIcon,
	ReceiveIcon,
	SendIcon,
	TimerIconAlt,
	TransferIcon,
	XIcon,
} from '../../styles/icons';
import { BodyMSB, CaptionB, Caption13Up } from '../../styles/text';
import { getActivityItemDate } from '../../utils/activity';
import { getDurationForBlocks, truncate } from '../../utils/helpers';

// Small badge component for activity tags
const Badge = ({ 
	text, 
	color = 'secondary' 
}: { 
	text: string; 
	color?: string;
}): ReactElement => {
	let bgColor = 'rgba(255, 255, 255, 0.08)';
	let borderColor = 'rgba(255, 255, 255, 0.16)';
	
	if (color === 'brand') {
		bgColor = 'rgba(255, 149, 0, 0.16)';
		borderColor = '#FF9500';
	} else if (color === 'purple') {
		bgColor = 'rgba(138, 43, 226, 0.16)';
		borderColor = '#8A2BE2';
	} else if (color === 'red') {
		bgColor = 'rgba(255, 59, 48, 0.16)';
		borderColor = '#FF3B30';
	} else if (color === 'green') {
		bgColor = 'rgba(52, 199, 89, 0.16)';
		borderColor = '#34C759';
	}
	
	return (
		<View style={[styles.badge, { backgroundColor: bgColor, borderColor }]}>
			<Caption13Up 
				color={color === 'secondary' ? 'secondary' : color} 
				style={styles.badgeText}
			>
				{text}
			</Caption13Up>
		</View>
	);
};

// Helper function to extract wallet info from external wallet transaction IDs
const getWalletInfo = (id: string): { isExternal: boolean; walletType?: string } => {
	if (id.startsWith('ext_')) {
		const parts = id.split('_');
		if (parts.length >= 2) {
			return { isExternal: true, walletType: parts[1].toUpperCase() };
		}
		return { isExternal: true };
	}
	return { isExternal: false };
};

export const ListItem = ({
	title,
	description,
	amount,
	icon,
	isSend,
	exists = true,
	id,
	activityType,
	status,
	confirmed,
	isBoosted,
	isTransfer,
	nodeInfo,
}: {
	title: string;
	description: string;
	icon: ReactNode;
	amount?: number;
	isSend?: boolean;
	exists?: boolean;
	id?: string;
	activityType?: EActivityType;
	status?: string;
	confirmed?: boolean;
	isBoosted?: boolean;
	isTransfer?: boolean;
	nodeInfo?: { nodeType: string; alias: string; network: string } | null;
}): ReactElement => {
	const walletInfo = id ? getWalletInfo(id) : { isExternal: false };
	
	return (
		<>
			{icon}
			<View style={styles.text}>
				<BodyMSB color={exists ? undefined : 'red'}>{title}</BodyMSB>
				<CaptionB color={exists ? 'secondary' : 'red'}>
					{truncate(description, 35)}
				</CaptionB>
				{/* Add tags container */}
				<View style={styles.tagsContainer}>
					{nodeInfo && (
						<Badge 
							text={`${nodeInfo.nodeType}${nodeInfo.alias ? ` • ${truncate(nodeInfo.alias, 15)}` : ''}`}
							color="brand" 
						/>
					)}
					{walletInfo.isExternal && walletInfo.walletType && !nodeInfo && (
						<Badge text={walletInfo.walletType} color="brand" />
					)}
					{activityType && (
						<Badge 
							text={activityType === EActivityType.lightning ? 'LIGHTNING' : 'ONCHAIN'} 
							color={activityType === EActivityType.lightning ? 'purple' : 'secondary'}
						/>
					)}
					{status === 'pending' && (
						<Badge text="PENDING" color="secondary" />
					)}
					{status === 'failed' && (
						<Badge text="FAILED" color="red" />
					)}
					{confirmed === true && activityType === EActivityType.onchain && (
						<Badge text="CONFIRMED" color="green" />
					)}
					{isBoosted && (
						<Badge text="BOOSTED" color="brand" />
					)}
					{isTransfer && (
						<Badge text="TRANSFER" color="purple" />
					)}
				</View>
			</View>

			{amount ? (
				<View style={styles.amount}>
					<Money
						color={exists ? undefined : 'red'}
						sats={amount}
						enableHide={true}
						size="bodyMSB"
						sign={isSend ? '-' : '+'}
						unitType="primary"
					/>
					<Money
						sats={amount}
						enableHide={true}
						size="captionB"
						color={exists ? 'secondary' : 'red'}
						unitType="secondary"
					/>
				</View>
			) : null}
		</>
	);
};

const OnchainListItem = ({
	item,
	icon,
	nodeInfo,
}: {
	item: TOnchainActivityItem;
	icon: JSX.Element;
	nodeInfo?: { nodeType: string; alias: string; network: string } | null;
}): ReactElement => {
	const { t } = useTranslation('wallet');
	const {
		transferTxId,
		txType,
		value,
		fee,
		feeRate,
		confirmed,
		confirmTimestamp,
		timestamp,
		isBoosted,
		exists = true,
	} = item;
	const { shortRange: feeRateDescription } = useFeeText(feeRate);
	const isSend = txType === EPaymentType.sent;

	const transfer = useAppSelector((state) => {
		return transferSelector(state, transferTxId);
	});

	let title = t(isSend ? 'activity_sent' : 'activity_received');
	const amount = isSend ? value + fee : value;

	let description: string;
	if (!exists) {
		description = t('activity_removed');
	} else if (feeRateDescription) {
		description = t('activity_confirms_in', { feeRateDescription });
	} else {
		description = t('activity_low_fee');
	}

	if (transfer) {
		title = t('activity_transfer');
		icon = (
			<ThemedView style={styles.icon} color="brand16" testID="TransferIcon">
				<TransferIcon color="brand" />
			</ThemedView>
		);

		const type = isSend ? 'spending' : 'savings';
		if (transfer.status === ETransferStatus.done) {
			description = t(`activity_transfer_${type}_done`);
		} else {
			const duration = getDurationForBlocks(transfer.confirmsIn);
			description = t(`activity_transfer_${type}_pending`, { duration });
		}
	}

	if (isBoosted && !confirmed) {
		description = t('activity_confirms_in_boosted', { feeRateDescription });
		icon = (
			<ThemedView style={styles.icon} color="yellow16" testID="BoostingIcon">
				<TimerIconAlt height={13} color="yellow" />
			</ThemedView>
		);
	}

	if (confirmed) {
		if (!transfer) {
			// NOTE: for users with earlier versions use the timestamp
			description = getActivityItemDate(confirmTimestamp ?? timestamp);
		}
	}

	return (
		<ListItem
			title={title}
			description={description}
			amount={amount}
			icon={icon}
			exists={exists}
			isSend={isSend}
			id={item.id}
			activityType={item.activityType}
			confirmed={confirmed}
			isBoosted={isBoosted}
			isTransfer={!!transfer}
			nodeInfo={nodeInfo}
		/>
	);
};

const LightningListItem = ({
	item,
	icon,
	nodeInfo,
}: {
	item: TLightningActivityItem;
	icon: JSX.Element;
	nodeInfo?: { nodeType: string; alias: string; network: string } | null;
}): ReactElement => {
	const { t } = useTranslation('wallet');
	const { txType, status, value, fee, message, timestamp } = item;

	let title = t(
		txType === EPaymentType.sent ? 'activity_sent' : 'activity_received',
	);

	if (status === 'pending') {
		title = t('activity_pending');
		icon = (
			<ThemedView style={styles.icon} color="purple16">
				<HourglassSimpleIcon color="purple" width={16} />
			</ThemedView>
		);
	}

	if (status === 'failed') {
		title = t('activity_failed');
		icon = (
			<ThemedView style={styles.icon} color="purple16">
				<XIcon color="purple" width={16} />
			</ThemedView>
		);
	}

	const description = message || getActivityItemDate(timestamp);
	const isSend = txType === EPaymentType.sent;
	const amount = isSend ? value + (fee ?? 0) : value;

	return (
		<ListItem
			title={title}
			description={description}
			icon={icon}
			amount={amount}
			isSend={isSend}
			id={item.id}
			activityType={item.activityType}
			status={status}
			confirmed={item.confirmed}
			nodeInfo={nodeInfo}
		/>
	);
};

export const EmptyItem = ({
	onPress,
}: {
	onPress: () => void;
}): ReactElement => {
	const { t } = useTranslation('wallet');
	const title = t('activity_no');
	const description = t('activity_no_explain');
	const icon = (
		<ThemedView color="yellow16" style={styles.icon}>
			<ActivityIcon height={16} color="yellow" />
		</ThemedView>
	);

	return (
		<View style={styles.empty}>
			<TouchableOpacity
				style={styles.pressable}
				activeOpacity={0.7}
				onPress={onPress}>
				<ListItem title={title} description={description} icon={icon} />
			</TouchableOpacity>
		</View>
	);
};

const Avatar = ({ url }: { url: string }): ReactElement => {
	const { profile } = useProfile(url);
	return (
		<ProfileImage
			style={styles.icon}
			url={url}
			image={profile.image}
			size={32}
		/>
	);
};

const ActivityListItem = ({
	item,
	onPress,
	testID,
}: {
	item: IActivityItem;
	onPress: () => void;
	testID?: string;
}): ReactElement => {
	const { id, activityType, txType } = item;
	const profileUrl = useAppSelector((state) => slashTagsUrlSelector(state, id));
	const nodeInfo = useAppSelector((state) => walletNodeInfoByTransactionSelector(state, id));
	const isSend = txType === EPaymentType.sent;
	const isInstant = activityType === EActivityType.lightning;

	const icon = profileUrl ? (
		<Avatar url={profileUrl} />
	) : (
		<ThemedView style={styles.icon} color={isInstant ? 'purple16' : 'brand16'}>
			{isSend ? (
				<SendIcon height={13} color={isInstant ? 'purple' : 'brand'} />
			) : (
				<ReceiveIcon height={13} color={isInstant ? 'purple' : 'brand'} />
			)}
		</ThemedView>
	);

	return (
		<View style={styles.root}>
			<TouchableOpacity
				style={styles.pressable}
				activeOpacity={0.7}
				testID={testID}
				onPress={onPress}>
				{activityType === EActivityType.onchain && (
					<OnchainListItem item={item} icon={icon} nodeInfo={nodeInfo} />
				)}
				{activityType === EActivityType.lightning && (
					<LightningListItem item={item} icon={icon} nodeInfo={nodeInfo} />
				)}
			</TouchableOpacity>
		</View>
	);
};

const styles = StyleSheet.create({
	empty: {
		borderBottomColor: 'rgba(255, 255, 255, 0.1)',
		borderBottomWidth: 1,
	},
	root: {
		borderBottomColor: 'rgba(255, 255, 255, 0.1)',
		borderBottomWidth: 1,
		marginBottom: 24,
	},
	pressable: {
		flexDirection: 'row',
		justifyContent: 'space-between',
		paddingBottom: 24,
		minHeight: 65,
	},
	icon: {
		borderRadius: 20,
		width: 32,
		height: 32,
		justifyContent: 'center',
		alignItems: 'center',
		alignSelf: 'center',
		marginRight: 16,
	},
	text: {
		justifyContent: 'space-between',
		marginRight: 'auto',
	},
	amount: {
		justifyContent: 'space-between',
		alignItems: 'flex-end',
		marginLeft: 'auto',
	},
	badge: {
		height: 18,
		borderWidth: 1,
		borderRadius: 4,
		paddingHorizontal: 6,
		justifyContent: 'center',
		alignItems: 'center',
		marginRight: 4,
		marginBottom: 2,
	},
	badgeText: {
		fontSize: 10,
		lineHeight: 12,
	},
	tagsContainer: {
		flexDirection: 'row',
		flexWrap: 'wrap',
		marginTop: 2,
	},
});

export default memo(ActivityListItem);
