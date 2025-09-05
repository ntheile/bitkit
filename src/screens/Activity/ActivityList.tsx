import { useNavigation } from '@react-navigation/native';
import React, {
	RefObject,
	ReactElement,
	memo,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
	NativeScrollEvent,
	NativeSyntheticEvent,
	RefreshControl,
	StyleProp,
	StyleSheet,
	View,
	ViewStyle,
} from 'react-native';
import { FlatList, GestureType } from 'react-native-gesture-handler';

import Button from '../../components/buttons/Button';
import useColors from '../../hooks/colors';
import { useAppSelector } from '../../hooks/redux';
import { RootNavigationProp } from '../../navigation/types';
import store from '../../store';
import { activityItemsSelector } from '../../store/reselect/activity';
import { externalWalletsState } from '../../store/reselect/externalWallets';
import { tagsSelector } from '../../store/reselect/metadata';
import { IActivityItem } from '../../store/types/activity';
import { syncExternalWalletTransactions } from '../../store/utils/externalWallets';
import { BodyM, Caption13Up } from '../../styles/text';
import {
	TActivityFilter,
	filterActivityItems,
	groupActivityItems,
} from '../../utils/activity';
import { refreshWallet } from '../../utils/wallet';
import ListItem from './ListItem';

// import {
//   LndNode,
//   LndConfig,
// } from 'lni_react_native';

const ListFooter = ({ showButton }: { showButton?: boolean }): ReactElement => {
	const { t } = useTranslation('wallet');
	const navigation = useNavigation<RootNavigationProp>();

	const onPress = (): void => {
		navigation.navigate('Wallet', { screen: 'ActivityFiltered' });
	};

	if (showButton) {
		return (
			<>
				<Button
					style={styles.button}
					text={t('activity_show_all')}
					size="large"
					variant="tertiary"
					testID="ActivityShowAll"
					onPress={onPress}
				/>
				<View style={styles.bottomSpacer} />
			</>
		);
	}

	return <View style={styles.bottomSpacer} />;
};

const ActivityList = ({
	style,
	panGestureRef,
	contentContainerStyle,
	progressViewOffset,
	filter = {},
	showFooterButton,
	onScroll,
}: {
	style?: StyleProp<ViewStyle>;
	panGestureRef?: RefObject<GestureType>;
	contentContainerStyle?: StyleProp<ViewStyle>;
	progressViewOffset?: number;
	filter?: TActivityFilter;
	showFooterButton?: boolean;
	onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
}): ReactElement => {
	const colors = useColors();
	const { t } = useTranslation('wallet');
	const navigation = useNavigation<RootNavigationProp>();
	const items = useAppSelector(activityItemsSelector);
	const tags = useAppSelector(tagsSelector);
	const externalWallets = useAppSelector(externalWalletsState);
	const [refreshing, setRefreshing] = useState(false);

	// Sync external wallet transactions on component mount and when external wallets change
	useEffect(() => {
		const hasConnectedWallets = Object.values(externalWallets).some(
			(wallet) => wallet?.connected
		);
		
		if (hasConnectedWallets) {
			// Debounce the sync to avoid calling it too frequently
			const timeoutId = setTimeout(() => {
				syncExternalWalletTransactions(() => store.getState());
			}, 500);
			
			return () => clearTimeout(timeoutId);
		}
	}, [externalWallets]);

	const groupedItems = useMemo(() => {
		// Apply search filter
		const filterItems = filterActivityItems(items, tags, filter);
		// Group items by categories: today, yesterday, this month, this year, earlier
		// and attach to them formattedDate
		return groupActivityItems(filterItems);
	}, [filter, items, tags]);

	const renderItem = useCallback(
		({
			item,
			index,
		}: {
			item: string | IActivityItem;
			index: number;
		}): ReactElement => {
			if (typeof item === 'string') {
				return (
					<Caption13Up key={item} style={styles.category} color="secondary">
						{item}
					</Caption13Up>
				);
			}

			return (
				<ListItem
					key={item.id}
					item={item}
					testID={`Activity-${index}`}
					onPress={(): void => {
						navigation.navigate('ActivityDetail', { id: item.id });
					}}
				/>
			);
		},
		[navigation],
	);

	const onRefresh = async (): Promise<void> => {
		setRefreshing(true);
		
		// Refresh main wallet
		await refreshWallet();
		
		// Sync external wallet transactions if any are connected
		const hasConnectedWallets = Object.values(externalWallets).some(
			(wallet) => wallet?.connected
		);
		
		if (hasConnectedWallets) {
			try {
				await syncExternalWalletTransactions(() => store.getState());
			} catch (error) {
				console.warn('Failed to sync external wallet transactions:', error);
			}
		}
		
		setRefreshing(false);
	};

	const simultaneousHandlers = panGestureRef ? [panGestureRef] : [];

	return (
		<FlatList
			style={[styles.content, style]}
			contentContainerStyle={contentContainerStyle}
			data={groupedItems}
			simultaneousHandlers={simultaneousHandlers}
			showsVerticalScrollIndicator={false}
			renderItem={renderItem}
			keyExtractor={(item): string => {
				return typeof item === 'string' ? item : item.id;
			}}
			refreshControl={
				<RefreshControl
					refreshing={refreshing}
					progressViewOffset={progressViewOffset}
					tintColor={colors.refreshControl}
					onRefresh={onRefresh}
				/>
			}
			ListEmptyComponent={
				<BodyM style={styles.empty} color="secondary">
					{t('activity_no')}
				</BodyM>
			}
			ListFooterComponent={<ListFooter showButton={showFooterButton} />}
			onScroll={onScroll}
		/>
	);
};

const styles = StyleSheet.create({
	content: {
		paddingTop: 20,
	},
	category: {
		marginBottom: 16,
	},
	empty: {
		marginBottom: 32,
	},
	button: {
		marginTop: -24,
		marginBottom: 16,
	},
	bottomSpacer: {
		height: 120,
	},
});

export default memo(ActivityList);
