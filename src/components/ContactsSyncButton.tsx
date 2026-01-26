import React, { ReactElement, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { useAppSelector } from '../hooks/redux';
import {
	discoveredContactsCountSelector,
	isSyncingSelector,
	lastSyncTimestampSelector,
	syncErrorSelector,
	syncProgressSelector,
} from '../store/reselect/signalContacts';
import { TouchableHighlight } from '../styles/components';
import { BodyMSB, Caption } from '../styles/text';
import { UsersIcon } from '../styles/icons';
import {
	isSignalLinked,
	isSyncAvailable,
	syncContactsWithSignal,
} from '../utils/contacts/syncService';

const ContactsSyncButton = (): ReactElement => {
	const { t } = useTranslation('slashtags');
	const isSyncing = useAppSelector(isSyncingSelector);
	const syncProgress = useAppSelector(syncProgressSelector);
	const lastSyncTimestamp = useAppSelector(lastSyncTimestampSelector);
	const discoveredCount = useAppSelector(discoveredContactsCountSelector);
	const syncError = useAppSelector(syncErrorSelector);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);

	const handleSync = useCallback(async () => {
		setErrorMessage(null);

		// Check prerequisites before syncing
		const signalLinked = await isSignalLinked();
		if (!signalLinked) {
			setErrorMessage('Link Signal account first');
			return;
		}

		if (!isSyncAvailable()) {
			setErrorMessage('CDSI not available');
			return;
		}

		const result = await syncContactsWithSignal();
		if (!result.success && result.error) {
			setErrorMessage(result.error);
		}
	}, []);

	const formatLastSync = useCallback(() => {
		if (!lastSyncTimestamp) {
			return null;
		}
		const date = new Date(lastSyncTimestamp);
		const now = new Date();
		const diffMs = now.getTime() - date.getTime();
		const diffMins = Math.floor(diffMs / 60000);

		if (diffMins < 1) {
			return 'Just now';
		}
		if (diffMins < 60) {
			return `${diffMins}m ago`;
		}
		const diffHours = Math.floor(diffMins / 60);
		if (diffHours < 24) {
			return `${diffHours}h ago`;
		}
		const diffDays = Math.floor(diffHours / 24);
		return `${diffDays}d ago`;
	}, [lastSyncTimestamp]);

	const displayError = errorMessage || syncError;

	return (
		<View style={styles.container}>
			<TouchableHighlight
				style={styles.button}
				color="white10"
				disabled={isSyncing}
				onPress={handleSync}
				testID="ContactsSyncButton">
				<View style={styles.buttonContent}>
					{isSyncing ? (
						<>
							<ActivityIndicator size="small" color="#fff" />
							<View style={styles.textContainer}>
								<BodyMSB style={styles.buttonText}>
									Syncing contacts...
								</BodyMSB>
								{syncProgress.total > 0 && (
									<Caption color="secondary">
										{syncProgress.current}/{syncProgress.total} batches
									</Caption>
								)}
							</View>
						</>
					) : (
						<>
							<UsersIcon width={20} height={20} color="brand" />
							<View style={styles.textContainer}>
								<BodyMSB style={styles.buttonText}>
									Find Signal Contacts
								</BodyMSB>
								{lastSyncTimestamp && discoveredCount > 0 && (
									<Caption color="secondary">
										{discoveredCount} found - {formatLastSync()}
									</Caption>
								)}
							</View>
						</>
					)}
				</View>
			</TouchableHighlight>

			{displayError && (
				<Caption color="brand" style={styles.errorText}>
					{displayError}
				</Caption>
			)}
		</View>
	);
};

const styles = StyleSheet.create({
	container: {
		marginBottom: 16,
	},
	button: {
		borderRadius: 8,
		paddingVertical: 12,
		paddingHorizontal: 16,
	},
	buttonContent: {
		flexDirection: 'row',
		alignItems: 'center',
	},
	textContainer: {
		marginLeft: 12,
		flex: 1,
	},
	buttonText: {
		color: '#fff',
	},
	errorText: {
		marginTop: 8,
		marginLeft: 4,
	},
});

export default ContactsSyncButton;
