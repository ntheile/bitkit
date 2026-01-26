import Clipboard from '@react-native-clipboard/clipboard';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { parse } from '@synonymdev/slashtags-url';
import React, { ReactElement, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import BottomSheet from '../components/BottomSheet';
import BottomSheetNavigationHeader from '../components/BottomSheetNavigationHeader';
import LabeledInput from '../components/LabeledInput';
import SafeAreaInset from '../components/SafeAreaInset';
import Button from '../components/buttons/Button';
import { Keyboard } from '../hooks/keyboard';
import { useAppDispatch } from '../hooks/redux';
import { useSlashtags } from '../hooks/slashtags';
import type { RootStackParamList } from '../navigation/types';
import { addSignalContact } from '../store/slices/slashtags';
import { useSheetRef } from './SheetRefsProvider';
import { ClipboardTextIcon, CornersOutIcon } from '../styles/icons';
import { BodyM } from '../styles/text';
import { handleSlashtagURL } from '../utils/slashtags';
import { lookupByUsername, isUsernameLookupAvailable } from '../utils/signal/username';

/**
 * Check if the input looks like a Signal username.
 * Signal usernames are in format "nickname.discriminator" (e.g., "alice.42")
 */
function isSignalUsername(input: string): boolean {
	const trimmed = input.trim();
	// Must contain exactly one dot, no special URL characters
	if (!trimmed.includes('.')) {
		return false;
	}
	// Should not look like a URL or slashtags URL
	if (trimmed.includes('://') || trimmed.includes('/')) {
		return false;
	}
	// Basic Signal username pattern: alphanumeric + dot + digits
	// Usernames can only contain a-z, 0-9, and underscore, with a 2-digit discriminator
	const usernamePattern = /^[a-zA-Z_][a-zA-Z0-9_]*\.\d{2,}$/;
	return usernamePattern.test(trimmed);
}

const AddContact = ({
	navigation,
}: {
	navigation: NativeStackNavigationProp<RootStackParamList, 'Contacts'>;
}): ReactElement => {
	const { t } = useTranslation('slashtags');
	const dispatch = useAppDispatch();
	const sheetRef = useSheetRef('addContact');
	const urlRef = useRef('');
	const [error, setError] = useState<string>();
	const [loading, setLoading] = useState(false);
	const { url: myProfileURL } = useSlashtags();

	const handleChangeUrl = (contactUrl: string): void => {
		urlRef.current = contactUrl;
		// Clear error when user types, but don't trigger re-render
		if (error) {
			setError(undefined);
		}
	};

	const handleAddContact = async (contactUrl?: string): Promise<void> => {
		contactUrl = contactUrl ?? urlRef.current;
		setError(undefined);
		if (!contactUrl.trim()) {
			return;
		}

		const trimmedInput = contactUrl.trim();

		// Check if it's a Signal username
		if (isSignalUsername(trimmedInput)) {
			if (!isUsernameLookupAvailable()) {
				setError('Signal username lookup not available');
				return;
			}

			setLoading(true);
			try {
				const result = await lookupByUsername(trimmedInput);
				if (result) {
					const signalIdentity = { aci: result.aci };

					// Save the contact to Redux
					dispatch(addSignalContact({
						name: trimmedInput,
						signal: signalIdentity,
					}));

					// Close sheet and navigate to chat
					sheetRef.current?.close();
					urlRef.current = '';
					navigation.navigate('Chat', {
						name: trimmedInput,
						signal: signalIdentity,
					});
				} else {
					setError('Signal user not found');
				}
			} catch (err) {
				console.error('Signal username lookup error:', err);
				setError(err instanceof Error ? err.message : 'Username lookup failed');
			} finally {
				setLoading(false);
			}
			return;
		}

		// Try to parse as Slashtags URL
		try {
			parse(contactUrl);
		} catch (_e) {
			setError(t('contact_error_key'));
			return;
		}

		try {
			if (parse(contactUrl).id === parse(myProfileURL).id) {
				setError(t('contact_error_yourself'));
				return;
			}
		} catch (_e) {}

		const onError = (): void => {
			setError(t('contact_error_key'));
		};

		const onSuccess = async (): Promise<void> => {
			navigation.navigate('ContactEdit', { url: contactUrl });
			urlRef.current = '';
		};

		handleSlashtagURL(contactUrl, onSuccess, onError);
	};

	const updateContactID = async (contactUrl: string): Promise<void> => {
		urlRef.current = contactUrl;
		await handleAddContact(contactUrl);
	};

	const handlePaste = async (): Promise<void> => {
		let contactUrl = await Clipboard.getString();
		contactUrl = contactUrl.trim();
		updateContactID(contactUrl);
	};

	const handleScanner = async (): Promise<void> => {
		await Keyboard.dismiss();
		navigation.navigate('Scanner', { onScan: updateContactID });
	};

	return (
		<BottomSheet id="addContact" size="small">
			<View style={styles.container}>
				<BottomSheetNavigationHeader
					title={t('contact_add_capital')}
					showBackButton={false}
				/>

				<View style={styles.content}>
					<BodyM style={styles.text} color="secondary" testID="AddContactNote">
						Enter a Signal username (e.g., alice.42) or Slashtag URL
					</BodyM>
					<LabeledInput
						placeholder="Signal username or Slashtag URL"
						label={t('contact_add')}
						color={error ? 'brand' : 'white'}
						bottomSheet={true}
						multiline={true}
						error={error}
						testID="ContactURLInput"
						onChange={handleChangeUrl}>
						<TouchableOpacity
							style={styles.action}
							activeOpacity={0.7}
							hitSlop={styles.hitSlop}
							onPress={handleScanner}>
							<CornersOutIcon width={24} height={24} color="brand" />
						</TouchableOpacity>
						<TouchableOpacity
							style={styles.action}
							activeOpacity={0.7}
							hitSlop={styles.hitSlop}
							onPress={handlePaste}>
							<ClipboardTextIcon width={24} height={24} color="brand" />
						</TouchableOpacity>
					</LabeledInput>

					<Button
						style={styles.button}
						size="large"
						disabled={Boolean(error) || loading}
						loading={loading}
						text={t('contact_add_button')}
						testID="AddContactButton"
						onPress={(): void => { handleAddContact(); }}
					/>
				</View>

				<SafeAreaInset type="bottom" minPadding={16} />
			</View>
		</BottomSheet>
	);
};

const styles = StyleSheet.create({
	container: {
		flex: 1,
	},
	content: {
		flex: 1,
		paddingHorizontal: 16,
	},
	text: {
		marginBottom: 32,
	},
	button: {
		marginTop: 'auto',
	},
	action: {
		width: 40,
	},
	hitSlop: {
		top: 10,
		bottom: 10,
		left: 10,
		right: 10,
	},
});

export default AddContact;
