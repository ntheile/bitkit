/**
 * Signal Invoice Sheet
 *
 * Bottom sheet for sending Lightning invoices to Signal contacts.
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import React, { ReactElement, useCallback, useMemo, useState } from 'react';
import { StyleSheet, TouchableOpacity, FlatList } from 'react-native';

import BottomSheet from '../components/BottomSheet';
import BottomSheetNavigationHeader from '../components/BottomSheetNavigationHeader';
import SafeAreaInset from '../components/SafeAreaInset';
import Button from '../components/buttons/Button';
import ContactImage from '../components/ContactImage';
import { useAppSelector } from '../hooks/redux';
import { contactsSelector } from '../store/reselect/slashtags';
import { View } from '../styles/components';
import { BodyM, BodyS, Caption13Up } from '../styles/text';
import { showToast } from '../utils/notifications';
import {
	sendInvoiceToContact,
	hasSignalIdentity,
	type SendMessageResult,
} from '../utils/signal/message-sender';
import { isSignalLinked } from '../storage/signal-store';
import type { IContactRecord } from '../store/types/slashtags';
import type { SheetsParamList } from '../store/types/ui';

interface SignalInvoiceSheetProps {
	data: SheetsParamList['signalInvoice'];
	onClose: () => void;
}

const SignalInvoiceSheet = ({
	data,
	onClose,
}: SignalInvoiceSheetProps): ReactElement => {
	const { invoice, amount, description } = data;
	const contacts = useAppSelector(contactsSelector);
	const [selectedContact, setSelectedContact] = useState<IContactRecord | null>(null);
	const [sending, setSending] = useState(false);

	// Filter contacts that have Signal identity
	const signalContacts = useMemo(() => {
		return Object.values(contacts).filter((contact) =>
			hasSignalIdentity(contact.signal),
		);
	}, [contacts]);

	const isLinked = useMemo(() => isSignalLinked(), []);

	const handleSelectContact = useCallback((contact: IContactRecord) => {
		setSelectedContact(contact);
	}, []);

	const handleSend = useCallback(async () => {
		if (!selectedContact?.signal) {
			showToast({
				type: 'warning',
				title: 'No Contact Selected',
				description: 'Please select a contact to send the invoice to',
			});
			return;
		}

		setSending(true);

		try {
			const result: SendMessageResult = await sendInvoiceToContact(
				selectedContact.signal,
				invoice,
				amount,
				description,
			);

			if (result.success) {
				showToast({
					type: 'success',
					title: 'Invoice Sent',
					description: `Invoice sent to ${selectedContact.name} via Signal`,
				});
				onClose();
			} else {
				showToast({
					type: 'warning',
					title: 'Send Failed',
					description: result.error || 'Unknown error',
				});
			}
		} catch (error) {
			showToast({
				type: 'warning',
				title: 'Error',
				description: error instanceof Error ? error.message : 'Failed to send invoice',
			});
		} finally {
			setSending(false);
		}
	}, [selectedContact, invoice, amount, description, onClose]);

	const renderContact = useCallback(
		({ item }: { item: IContactRecord }) => {
			const isSelected = selectedContact?.url === item.url;

			return (
				<TouchableOpacity
					style={[styles.contactItem, isSelected && styles.contactItemSelected]}
					onPress={() => handleSelectContact(item)}
					activeOpacity={0.7}>
					<ContactImage url={item.url} size={44} />
					<View style={styles.contactInfo}>
						<BodyM numberOfLines={1}>{item.name}</BodyM>
						{item.signal?.phoneNumber && (
							<BodyS color="secondary" numberOfLines={1}>
								{item.signal.phoneNumber}
							</BodyS>
						)}
					</View>
					{isSelected && <View style={styles.selectedIndicator} />}
				</TouchableOpacity>
			);
		},
		[selectedContact, handleSelectContact],
	);

	const renderEmptyState = (): ReactElement => (
		<View style={styles.emptyState}>
			<BodyM style={styles.emptyText} color="secondary">
				{!isLinked
					? 'Signal account not linked. Go to Settings → Advanced → Signal Integration to link your account.'
					: 'No contacts with Signal identity found. Add Signal info to your contacts to send invoices via Signal.'}
			</BodyM>
		</View>
	);

	const renderInvoicePreview = (): ReactElement => (
		<View style={styles.invoicePreview}>
			<Caption13Up style={styles.previewLabel}>Invoice</Caption13Up>
			<BodyS style={styles.invoiceText} numberOfLines={2}>
				{invoice.substring(0, 50)}...
			</BodyS>
			{amount !== undefined && (
				<BodyM style={styles.amountText}>{amount} sats</BodyM>
			)}
			{description && (
				<BodyS color="secondary" numberOfLines={1}>
					{description}
				</BodyS>
			)}
		</View>
	);

	return (
		<BottomSheet id="signalInvoice" size="large">
			<View style={styles.container}>
				<BottomSheetNavigationHeader
					title="Send via Signal"
					showBackButton={true}
					onBackPress={onClose}
				/>

				<View style={styles.content}>
					{renderInvoicePreview()}

					<Caption13Up style={styles.sectionLabel}>
						Select Signal Contact
					</Caption13Up>

					{signalContacts.length > 0 ? (
						<FlatList
							data={signalContacts}
							renderItem={renderContact}
							keyExtractor={(item) => item.url}
							style={styles.contactList}
							showsVerticalScrollIndicator={false}
						/>
					) : (
						renderEmptyState()
					)}
				</View>

				<View style={styles.buttonContainer}>
					<Button
						style={styles.button}
						text={sending ? 'Sending...' : 'Send Invoice'}
						size="large"
						disabled={!selectedContact || sending || !isLinked}
						loading={sending}
						onPress={handleSend}
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
	invoicePreview: {
		backgroundColor: 'rgba(255, 255, 255, 0.05)',
		borderRadius: 12,
		padding: 16,
		marginBottom: 24,
	},
	previewLabel: {
		marginBottom: 8,
	},
	invoiceText: {
		fontFamily: 'monospace',
		opacity: 0.7,
	},
	amountText: {
		marginTop: 8,
	},
	sectionLabel: {
		marginBottom: 12,
	},
	contactList: {
		flex: 1,
	},
	contactItem: {
		flexDirection: 'row',
		alignItems: 'center',
		paddingVertical: 12,
		paddingHorizontal: 12,
		borderRadius: 12,
		marginBottom: 8,
		backgroundColor: 'rgba(255, 255, 255, 0.03)',
	},
	contactItemSelected: {
		backgroundColor: 'rgba(247, 147, 26, 0.15)',
		borderWidth: 1,
		borderColor: '#F7931A',
	},
	contactInfo: {
		flex: 1,
		marginLeft: 12,
	},
	selectedIndicator: {
		width: 20,
		height: 20,
		borderRadius: 10,
		backgroundColor: '#F7931A',
	},
	emptyState: {
		flex: 1,
		justifyContent: 'center',
		alignItems: 'center',
		paddingHorizontal: 32,
	},
	emptyText: {
		textAlign: 'center',
		lineHeight: 22,
	},
	buttonContainer: {
		paddingHorizontal: 16,
		paddingVertical: 16,
	},
	button: {
		flex: 1,
	},
});

export default SignalInvoiceSheet;
