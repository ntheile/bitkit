/**
 * Signal Link Screen
 *
 * Allows users to link their Signal account to Bitkit as a secondary device.
 * Displays a QR code for the primary Signal device to scan.
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import React, { memo, ReactElement, useCallback, useEffect, useState } from 'react';
import { StyleSheet, ActivityIndicator, TextInput, Alert } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import NavigationHeader from '../../../components/NavigationHeader';
import SafeAreaInset from '../../../components/SafeAreaInset';
import Button from '../../../components/buttons/Button';
import type { SettingsScreenProps } from '../../../navigation/types';
import { ScrollView, View } from '../../../styles/components';
import { BodyM, BodyS, Caption13Up, Title } from '../../../styles/text';
import { showToast } from '../../../utils/notifications';
import {
	DeviceLinkManager,
	DeviceLinkingStatus,
	type DeviceLinkingState,
} from '../../../utils/signal/device-link';
import {
	storeIdentityKey,
	storeProfileKey,
	storeMasterKey,
	storeAccountInfo,
	isSignalLinked,
	getAccountInfo,
	clearSignalData,
	getAuthPassword,
	type SignalAccountInfo,
} from '../../../storage/signal-store';
import { sendMessage, formatPhoneNumber, clearAllCachedSessions, clearAllSessions, getRateLimitRemaining, listAllSessions, resetRateLimit, clearAllStoredSessions, clearPreKeyCache } from '../../../utils/signal/messaging';
import type { SignalContact } from '../../../utils/signal/contacts';
import { testCdsiAuth, checkAccountExists, isCdsiAvailable } from '../../../utils/signal/cdsi';

const SignalLink = (
	_props: SettingsScreenProps<'SignalLink'>,
): ReactElement => {
	const [linkManager, setLinkManager] = useState<DeviceLinkManager | null>(null);
	const [linkingState, setLinkingState] = useState<DeviceLinkingState>({
		status: DeviceLinkingStatus.IDLE,
	});
	const [isLinked, setIsLinked] = useState(false);
	const [accountInfo, setAccountInfo] = useState<SignalAccountInfo | null>(null);
	
	// Messaging state
	const [showMessaging, setShowMessaging] = useState(false);
	const [recipientInput, setRecipientInput] = useState('');
	const [messageInput, setMessageInput] = useState('');
	const [isSending, setIsSending] = useState(false);
	const [contacts, setContacts] = useState<SignalContact[]>([]);
	
	// CDSI test state
	const [showCdsiTest, setShowCdsiTest] = useState(false);
	const [cdsiTestResult, setCdsiTestResult] = useState<string | null>(null);
	const [cdsiTestLoading, setCdsiTestLoading] = useState(false);
	const [aciCheckInput, setAciCheckInput] = useState('');

	// Check if already linked on mount
	useEffect(() => {
		const linked = isSignalLinked();
		setIsLinked(linked);
		if (linked) {
			setAccountInfo(getAccountInfo());
		}
	}, []);

	const handleStateChange = useCallback((state: DeviceLinkingState) => {
		console.log('SignalLink: State changed to', state.status);
		setLinkingState(state);

		if (state.status === DeviceLinkingStatus.COMPLETE && state.provisioningData) {
			// Save the provisioning data
			saveProvisioningData(state.provisioningData);
		} else if (state.status === DeviceLinkingStatus.ERROR && state.error) {
			showToast({
				type: 'warning',
				title: 'Linking Failed',
				description: state.error.message,
			});
		}
	}, []);

	const saveProvisioningData = async (data: any): Promise<void> => {
		try {
			// Store identity keys
			if (data.aciIdentityKeyPublic && data.aciIdentityKeyPrivate) {
				await storeIdentityKey(
					'aci',
					data.aciIdentityKeyPublic,
					data.aciIdentityKeyPrivate,
				);
			}

			if (data.pniIdentityKeyPublic && data.pniIdentityKeyPrivate) {
				await storeIdentityKey(
					'pni',
					data.pniIdentityKeyPublic,
					data.pniIdentityKeyPrivate,
				);
			}

			// Store profile key
			if (data.profileKey) {
				await storeProfileKey(data.profileKey);
			}

			// Store master key
			if (data.masterKey) {
				await storeMasterKey(data.masterKey);
			}

			// Store account info - but preserve password and deviceId if already set by device registration
			const existingInfo = getAccountInfo();
			const info: SignalAccountInfo = {
				phoneNumber: data.number || '',
				aci: data.aci || '',
				pni: data.pni || '',
				// Keep the deviceId from registration if available, otherwise default to 2
				deviceId: existingInfo?.deviceId || 2,
				// Keep the registrationId from registration if available
				registrationId: existingInfo?.registrationId || Math.floor(Math.random() * 16380) + 1,
				linkedAt: existingInfo?.linkedAt || Date.now(),
				readReceipts: data.readReceipts,
				// Preserve password from device registration
				password: existingInfo?.password,
			};
			storeAccountInfo(info);

			setIsLinked(true);
			setAccountInfo(info);

			showToast({
				type: 'success',
				title: 'Signal Linked',
				description: `Successfully linked to ${data.number}`,
			});
		} catch (error) {
			console.error('SignalLink: Error saving provisioning data:', error);
			showToast({
				type: 'warning',
				title: 'Error',
				description: 'Failed to save Signal credentials',
			});
		}
	};

	const startLinking = useCallback(() => {
		const manager = new DeviceLinkManager({
			onStateChange: handleStateChange,
		});
		setLinkManager(manager);
		manager.startLinking();
	}, [handleStateChange]);

	const cancelLinking = useCallback(() => {
		if (linkManager) {
			linkManager.cancelLinking();
			setLinkManager(null);
		}
		setLinkingState({ status: DeviceLinkingStatus.IDLE });
	}, [linkManager]);

	const unlinkSignal = useCallback(async () => {
		await clearSignalData();
		setIsLinked(false);
		setAccountInfo(null);
		showToast({
			type: 'success',
			title: 'Signal Unlinked',
			description: 'Your Signal account has been unlinked from Bitkit',
		});
	}, []);

	const testSignalConnection = useCallback(async () => {
		try {
			// Get stored credentials
			const info = getAccountInfo();
			if (!info) {
				showToast({
					type: 'warning',
					title: 'Test Failed',
					description: 'No account info found',
				});
				return;
			}

			// Log the stored data for debugging
			console.log('Signal Test: Account Info:', JSON.stringify(info, null, 2));

			// Check for auth password
			const password = await getAuthPassword();
			const hasAuth = !!password;
			console.log('Signal Test: Has auth password:', hasAuth);

			if (hasAuth) {
				// Try to verify with server
				const credentials = `${info.aci}.${info.deviceId}:${password}`;
				const authHeader = `Basic ${Buffer.from(credentials).toString('base64')}`;
				
				try {
					const response = await fetch('https://chat.signal.org/v1/accounts/whoami', {
						method: 'GET',
						headers: { 'Authorization': authHeader },
					});
					
					console.log('Signal Test: Server response:', response.status);
					
					if (response.ok) {
						const data = await response.json();
						console.log('Signal Test: whoami response:', data);
						showToast({
							type: 'success',
							title: 'Signal Auth ✓',
							description: `Verified with server!\nDevice: ${info.deviceId}`,
						});
						return;
					} else {
						console.log('Signal Test: Server returned', response.status);
					}
				} catch (e) {
					console.log('Signal Test: Server verify failed:', e);
				}
			}

			// Show what we have stored (auth not working)
			showToast({
				type: 'warning',
				title: 'Signal Linked (No Auth)',
				description: `Phone: ${info.phoneNumber}\nACI: ${info.aci.slice(0, 8)}...\nNeeds re-link for full auth`,
			});
		} catch (error) {
			console.error('Signal Test Error:', error);
			showToast({
				type: 'warning',
				title: 'Test Error',
				description: error instanceof Error ? error.message : 'Unknown error',
			});
		}
	}, []);

	const handleSendMessage = useCallback(async () => {
		if (!recipientInput.trim() || !messageInput.trim()) {
			showToast({
				type: 'warning',
				title: 'Missing Info',
				description: 'Enter both recipient ACI and message',
			});
			return;
		}

		// Check rate limit before attempting
		const rateLimitSeconds = getRateLimitRemaining();
		if (rateLimitSeconds > 0) {
			showToast({
				type: 'warning',
				title: 'Rate Limited',
				description: `Signal rate limit. Wait ${rateLimitSeconds}s before trying again.`,
			});
			return;
		}

		setIsSending(true);

		try {
			const input = recipientInput.trim();

			// Validate that input is a UUID (ACI)
			const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
			if (!uuidRegex.test(input)) {
				showToast({
					type: 'warning',
					title: 'Invalid ACI',
					description: 'Please enter a valid UUID (e.g., xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)',
				});
				setIsSending(false);
				return;
			}

			const contact: SignalContact = {
				aci: input,
				phoneNumber: '',
				name: `Contact ${input.slice(0, 8)}...`,
			};
			console.log('Signal: Sending to ACI:', input);

			const result = await sendMessage(contact, messageInput);

			if (result.success) {
				showToast({
					type: 'success',
					title: 'Message Sent',
					description: `Sent to ${contact.aci.slice(0, 8)}...`,
				});
				setMessageInput('');
				
				// Add to contacts list
				if (!contacts.find(c => c.aci === contact!.aci)) {
					setContacts([...contacts, contact]);
				}
			} else {
				showToast({
					type: 'warning',
					title: 'Send Failed',
					description: result.error || 'Could not send message',
				});
			}
		} catch (error) {
			console.error('Signal: Send error:', error);
			showToast({
				type: 'warning',
				title: 'Error',
				description: error instanceof Error ? error.message : 'Unknown error',
			});
		} finally {
			setIsSending(false);
		}
	}, [recipientInput, messageInput, contacts]);

	const sendToSelf = useCallback(() => {
		if (accountInfo?.aci) {
			setRecipientInput(accountInfo.aci);
			showToast({
				type: 'info',
				title: 'ACI Set',
				description: 'Your own ACI has been set as recipient (for testing)',
			});
		}
	}, [accountInfo]);

	const quickSendToSelf = useCallback(async () => {
		if (!accountInfo?.aci) {
			showToast({
				type: 'warning',
				title: 'Not Linked',
				description: 'Link Signal first to send messages',
			});
			return;
		}

		// Check rate limit before attempting
		const rateLimitSeconds = getRateLimitRemaining();
		if (rateLimitSeconds > 0) {
			showToast({
				type: 'warning',
				title: 'Rate Limited',
				description: `Signal rate limit. Wait ${rateLimitSeconds}s before trying again.`,
			});
			return;
		}

		const testMessage = `Test from Bitkit at ${new Date().toLocaleTimeString()}`;
		setIsSending(true);
		setRecipientInput(accountInfo.aci);
		setMessageInput(testMessage);

		try {
			const contact: SignalContact = {
				aci: accountInfo.aci,
				phoneNumber: accountInfo.phoneNumber || '',
				name: 'Me',
			};

			const result = await sendMessage(contact, testMessage);

			if (result.success) {
				showToast({
					type: 'success',
					title: 'Sent to Self! ✓',
					description: 'Check your other Signal devices',
				});
			} else {
				showToast({
					type: 'warning',
					title: 'Send Failed',
					description: result.error || 'Could not send message',
				});
			}
		} catch (error) {
			console.error('Signal: Quick send error:', error);
			showToast({
				type: 'warning',
				title: 'Error',
				description: error instanceof Error ? error.message : 'Unknown error',
			});
		} finally {
			setIsSending(false);
		}
	}, [accountInfo]);

	// CDSI Test Handlers
	const handleTestCdsiAuth = useCallback(async () => {
		setCdsiTestLoading(true);
		setCdsiTestResult(null);
		try {
			const result = await testCdsiAuth();
			setCdsiTestResult(result.success 
				? `✅ ${result.message}` 
				: `❌ ${result.message}`);
			showToast({
				type: result.success ? 'success' : 'warning',
				title: result.success ? 'CDSI Auth Success' : 'CDSI Auth Failed',
				description: result.message,
			});
		} catch (error) {
			const errMsg = error instanceof Error ? error.message : 'Unknown error';
			setCdsiTestResult(`❌ Error: ${errMsg}`);
			showToast({
				type: 'warning',
				title: 'CDSI Test Error',
				description: errMsg,
			});
		} finally {
			setCdsiTestLoading(false);
		}
	}, []);

	const handleCheckAccountExists = useCallback(async () => {
		if (!aciCheckInput.trim()) {
			showToast({
				type: 'warning',
				title: 'Missing ACI',
				description: 'Enter an ACI to check',
			});
			return;
		}
		
		setCdsiTestLoading(true);
		try {
			const exists = await checkAccountExists(aciCheckInput.trim());
			setCdsiTestResult(exists 
				? `✅ Account EXISTS: ${aciCheckInput.slice(0, 8)}...` 
				: `❌ Account NOT FOUND: ${aciCheckInput.slice(0, 8)}...`);
			showToast({
				type: exists ? 'success' : 'info',
				title: exists ? 'Account Found' : 'Account Not Found',
				description: exists ? 'The ACI exists on Signal servers' : 'No account with this ACI',
			});
		} catch (error) {
			const errMsg = error instanceof Error ? error.message : 'Unknown error';
			setCdsiTestResult(`❌ Check failed: ${errMsg}`);
		} finally {
			setCdsiTestLoading(false);
		}
	}, [aciCheckInput]);

	const renderCdsiTestUI = (): ReactElement => (
		<View style={styles.messagingContainer}>
			<Title style={styles.sectionTitle}>📞 Contact Discovery (CDSI)</Title>
			
			<BodyS style={styles.note}>
				CDSI is Signal's privacy-preserving phone number lookup service.{'\n'}
				It uses Intel SGX enclaves to securely find Signal users.
			</BodyS>
			
			{/* CDSI Status */}
			<View style={styles.statusBox}>
				<BodyM style={styles.statusLabel}>CDSI Native Support:</BodyM>
				<BodyM style={isCdsiAvailable() ? styles.statusGreen : styles.statusYellow}>
					{isCdsiAvailable() ? '✅ Available' : '⚠️ Auth Only (Native bindings needed for full lookup)'}
				</BodyM>
			</View>

			{/* Test Auth Button */}
			<Button
				style={styles.button}
				text={cdsiTestLoading ? 'Testing...' : '🔐 Test CDSI Auth'}
				size="large"
				disabled={cdsiTestLoading}
				onPress={handleTestCdsiAuth}
			/>
			
			<BodyS style={styles.hint}>
				Tests getting CDSI auth credentials from /v2/directory/auth
			</BodyS>

			{/* Check Account Exists */}
			<View style={styles.divider} />
			
			<BodyS style={styles.inputLabel}>Check if ACI Exists</BodyS>
			<TextInput
				style={styles.input}
				placeholder="Enter ACI (UUID) to check"
				placeholderTextColor="#666"
				value={aciCheckInput}
				onChangeText={setAciCheckInput}
				autoCapitalize="none"
				autoCorrect={false}
			/>
			
			<View style={styles.buttonRow}>
				<Button
					style={styles.flexButton}
					text={cdsiTestLoading ? 'Checking...' : '🔍 Check Account'}
					size="large"
					disabled={cdsiTestLoading || !aciCheckInput.trim()}
					onPress={handleCheckAccountExists}
				/>
				{accountInfo?.aci && (
					<Button
						style={styles.smallButton}
						text="Use My ACI"
						size="small"
						variant="secondary"
						onPress={() => setAciCheckInput(accountInfo.aci)}
					/>
				)}
			</View>
			
			<BodyS style={styles.hint}>
				Uses HEAD /v1/accounts/account/{'{identifier}'} (unauthenticated, rate-limited)
			</BodyS>

			{/* Test Result */}
			{cdsiTestResult && (
				<View style={styles.resultBox}>
					<BodyM style={styles.resultText}>{cdsiTestResult}</BodyM>
				</View>
			)}
			
			{/* Info about full CDSI */}
			<View style={styles.infoBox}>
				<BodyS style={styles.infoTitle}>ℹ️ Full Phone Number Lookup</BodyS>
				<BodyS style={styles.infoText}>
					Full CDSI phone → ACI lookup requires native libsignal bindings 
					(ConnectionManager, CdsiLookup) which aren't yet available in 
					react-native-libsignal-client.{'\n\n'}
					See docs/CDSI_LIBSIGNAL_SPEC.md for implementation details.
				</BodyS>
			</View>
		</View>
	);

	const renderMessagingUI = (): ReactElement => (
		<View style={styles.messagingContainer}>
			<Title style={styles.sectionTitle}>Send Message</Title>
			
			{/* Debug Section */}
			<View style={styles.debugSection}>
				<Button
					style={styles.debugButton}
					text="🔍 List Sessions"
					size="small"
					onPress={() => {
						const sessions = listAllSessions();
						Alert.alert(
							'Stored Sessions',
							sessions.length > 0 
								? sessions.join('\n')
								: 'No sessions found. Need to fetch PreKeys first.',
						);
					}}
				/>
				<Button
					style={styles.debugButton}
					text="🔄 Reset Rate Limit"
					size="small"
					onPress={() => {
						resetRateLimit();
						showToast({ type: 'success', title: 'Rate Limit Reset', description: 'You can try sending again' });
					}}
				/>
				<Button
					style={[styles.debugButton, { backgroundColor: '#8b0000' }]}
					text="🗑️ Clear Sessions"
					size="small"
					onPress={() => {
						clearAllStoredSessions();
						clearPreKeyCache();
						resetRateLimit();
						showToast({ type: 'success', title: 'All Cleared', description: 'Sessions, cache, and rate limit cleared' });
					}}
				/>
			</View>
			
			{/* Quick Send to Self - prominent one-click option */}
			<View style={styles.quickSendSection}>
				<Button
					style={styles.quickSendButton}
					text={isSending ? 'Sending...' : '📤 Quick Send to Self'}
					size="large"
					disabled={isSending}
					onPress={quickSendToSelf}
				/>
				<BodyS style={styles.quickSendHint}>
					One-click test: Sends a message to your other Signal devices
				</BodyS>
			</View>

			<View style={styles.divider} />
			
			<BodyS style={styles.note}>
				📱 Or enter a recipient's Signal ACI (UUID). To find someone's ACI:{'\n'}
				• On Desktop: Settings → Advanced → Copy ACI{'\n'}
				• Or ask them for their ACI
			</BodyS>
			
			<BodyS style={styles.inputLabel}>Recipient ACI (UUID)</BodyS>
			<TextInput
				style={styles.input}
				placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
				placeholderTextColor="#666"
				value={recipientInput}
				onChangeText={setRecipientInput}
				autoCapitalize="none"
				autoCorrect={false}
			/>
			
			<Button
				style={styles.smallButton}
				text="Use My ACI"
				size="small"
				variant="secondary"
				onPress={sendToSelf}
			/>

			<BodyS style={styles.inputLabel}>Message</BodyS>
			<TextInput
				style={[styles.input, styles.messageInput]}
				placeholder="Type your message..."
				placeholderTextColor="#666"
				value={messageInput}
				onChangeText={setMessageInput}
				multiline
				numberOfLines={3}
			/>

			<View style={styles.buttonRow}>
				<Button
					style={styles.flexButton}
					text={isSending ? 'Sending...' : 'Send Message'}
					size="large"
					disabled={isSending || !recipientInput.trim() || !messageInput.trim()}
					onPress={handleSendMessage}
				/>
				<Button
					style={styles.refreshButton}
					text="↻"
					size="large"
					variant="secondary"
					onPress={() => {
						if (recipientInput.trim()) {
							// Check if input is ACI
							const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
							if (uuidRegex.test(recipientInput.trim())) {
								clearAllSessions(recipientInput.trim());
								showToast({
									type: 'success',
									title: 'Sessions Cleared',
									description: 'Will fetch fresh keys on next send',
								});
							} else {
								showToast({
									type: 'info',
									title: 'Enter ACI First',
									description: 'Need ACI to clear sessions',
								});
							}
						} else {
							clearAllCachedSessions();
							showToast({
								type: 'success',
								title: 'All Sessions Cleared',
								description: 'Will fetch fresh keys on next send',
							});
						}
					}}
				/>
			</View>
			
			<BodyS style={styles.hint}>
				Tip: If you see "stale devices" errors, tap ↻ to refresh sessions.
			</BodyS>

			{accountInfo && (
				<View style={styles.contactsSection}>
					<BodyS style={styles.inputLabel}>Your Info (for reference)</BodyS>
					<View style={styles.contactItem}>
						<BodyM style={styles.contactName}>You ({accountInfo.phoneNumber})</BodyM>
						<BodyS style={styles.contactAci} selectable>ACI: {accountInfo.aci}</BodyS>
					</View>
				</View>
			)}

			{contacts.length > 0 && (
				<View style={styles.contactsSection}>
					<BodyS style={styles.inputLabel}>Recent Contacts</BodyS>
					{contacts.map((contact, index) => (
						<View key={index} style={styles.contactItem}>
							<BodyM 
								style={styles.contactName}
								onPress={() => setRecipientInput(contact.aci || contact.phoneNumber)}
							>
								{contact.name || contact.phoneNumber}
							</BodyM>
							<BodyS style={styles.contactAci}>
								{contact.aci ? contact.aci : 'No ACI'}
							</BodyS>
						</View>
					))}
				</View>
			)}
		</View>
	);

	const renderLinkedState = (): ReactElement => (
		<View style={styles.content}>
			<View style={styles.statusContainer}>
				<Title style={styles.title}>✓ Signal Linked</Title>
				{accountInfo && (
					<>
						<BodyM style={styles.infoText}>Phone: {accountInfo.phoneNumber}</BodyM>
						<BodyS style={styles.infoTextSmall}>ACI: {accountInfo.aci}</BodyS>
						<BodyS style={styles.infoTextSmall}>
							Linked: {new Date(accountInfo.linkedAt).toLocaleDateString()}
						</BodyS>
					</>
				)}
			</View>

			{showMessaging ? renderMessagingUI() : null}
			{showCdsiTest ? renderCdsiTestUI() : null}

			<View style={styles.buttonContainer}>
				<Button
					style={styles.button}
					text={showMessaging ? 'Hide Messaging' : 'Send a Message'}
					size="large"
					onPress={() => {
						setShowMessaging(!showMessaging);
						if (!showMessaging) setShowCdsiTest(false);
					}}
				/>
				<Button
					style={styles.button}
					text={showCdsiTest ? 'Hide CDSI Test' : '📞 Test CDSI'}
					size="large"
					variant="secondary"
					onPress={() => {
						setShowCdsiTest(!showCdsiTest);
						if (!showCdsiTest) setShowMessaging(false);
					}}
				/>
				<Button
					style={styles.button}
					text="Test Connection"
					size="large"
					variant="secondary"
					onPress={testSignalConnection}
				/>
				<Button
					style={styles.button}
					text="Unlink Signal"
					size="large"
					variant="secondary"
					onPress={unlinkSignal}
				/>
			</View>
		</View>
	);

	const renderIdleState = (): ReactElement => (
		<View style={styles.content}>
			<View style={styles.infoContainer}>
				<Title style={styles.title}>Link Signal Account</Title>
				<BodyM style={styles.description}>
					Link your Signal account to Bitkit to send Lightning invoices directly
					to your Signal contacts via encrypted messages.
				</BodyM>
				<BodyS style={styles.note}>
					This will add Bitkit as a secondary device on your Signal account.
					You'll need your primary Signal device to scan a QR code.
				</BodyS>
			</View>

			<View style={styles.buttonContainer}>
				<Button
					style={styles.button}
					text="Start Linking"
					size="large"
					onPress={startLinking}
				/>
			</View>
		</View>
	);

	const renderConnectingState = (): ReactElement => (
		<View style={styles.content}>
			<View style={styles.statusContainer}>
				<ActivityIndicator size="large" color="#F7931A" />
				<BodyM style={styles.statusText}>Connecting to Signal servers...</BodyM>
			</View>
		</View>
	);

	const renderQRCodeState = (): ReactElement => (
		<View style={styles.content}>
			<View style={styles.qrContainer}>
				<Caption13Up style={styles.qrLabel}>
					Scan with Signal on your primary device
				</Caption13Up>

				{linkingState.qrCodeUrl && (
					<View style={styles.qrWrapper}>
						<QRCode
							value={linkingState.qrCodeUrl}
							size={220}
							backgroundColor="white"
							color="black"
						/>
					</View>
				)}

				<BodyS style={styles.qrInstructions}>
					1. Open Signal on your primary device{'\n'}
					2. Go to Settings → Linked Devices{'\n'}
					3. Tap "Link a new device"{'\n'}
					4. Scan this QR code
				</BodyS>
			</View>

			<View style={styles.buttonContainer}>
				<Button
					style={styles.button}
					text="Cancel"
					size="large"
					variant="secondary"
					onPress={cancelLinking}
				/>
			</View>
		</View>
	);

	const renderProcessingState = (): ReactElement => (
		<View style={styles.content}>
			<View style={styles.statusContainer}>
				<ActivityIndicator size="large" color="#F7931A" />
				<BodyM style={styles.statusText}>
					{linkingState.status === DeviceLinkingStatus.PROCESSING_ENVELOPE
						? 'Processing provisioning data...'
						: 'Registering device...'}
				</BodyM>
			</View>
		</View>
	);

	const renderContent = (): ReactElement => {
		if (isLinked) {
			return renderLinkedState();
		}

		switch (linkingState.status) {
			case DeviceLinkingStatus.IDLE:
			case DeviceLinkingStatus.ERROR:
				return renderIdleState();

			case DeviceLinkingStatus.CONNECTING:
			case DeviceLinkingStatus.WAITING_FOR_UUID:
				return renderConnectingState();

			case DeviceLinkingStatus.WAITING_FOR_SCAN:
				return renderQRCodeState();

			case DeviceLinkingStatus.PROCESSING_ENVELOPE:
			case DeviceLinkingStatus.REGISTERING:
				return renderProcessingState();

			case DeviceLinkingStatus.COMPLETE:
				return renderLinkedState();

			default:
				return renderIdleState();
		}
	};

	return (
		<View style={styles.root}>
			<SafeAreaInset type="top" />
			<NavigationHeader title="Signal Integration" />
			<ScrollView contentContainerStyle={styles.scrollContent}>
				{renderContent()}
			</ScrollView>
			<SafeAreaInset type="bottom" minPadding={16} />
		</View>
	);
};

const styles = StyleSheet.create({
	root: {
		flex: 1,
	},
	scrollContent: {
		flexGrow: 1,
		paddingHorizontal: 16,
	},
	content: {
		flex: 1,
		justifyContent: 'space-between',
	},
	infoContainer: {
		paddingTop: 24,
	},
	title: {
		marginBottom: 16,
		textAlign: 'center',
	},
	description: {
		textAlign: 'center',
		marginBottom: 16,
		opacity: 0.8,
	},
	note: {
		textAlign: 'center',
		opacity: 0.6,
	},
	qrContainer: {
		alignItems: 'center',
		paddingTop: 24,
	},
	qrLabel: {
		marginBottom: 16,
		textAlign: 'center',
	},
	qrWrapper: {
		padding: 16,
		backgroundColor: 'white',
		borderRadius: 16,
		marginBottom: 24,
	},
	qrInstructions: {
		textAlign: 'center',
		lineHeight: 22,
		opacity: 0.7,
	},
	statusContainer: {
		flex: 1,
		justifyContent: 'center',
		alignItems: 'center',
		paddingTop: 48,
	},
	statusText: {
		marginTop: 16,
		textAlign: 'center',
		opacity: 0.8,
	},
	infoText: {
		marginTop: 16,
		textAlign: 'center',
	},
	infoTextSmall: {
		marginTop: 8,
		textAlign: 'center',
		opacity: 0.6,
	},
	buttonContainer: {
		paddingVertical: 24,
		gap: 12,
	},
	button: {
		flex: 1,
	},
	smallButton: {
		marginBottom: 16,
	},
	// Messaging UI styles
	messagingContainer: {
		marginTop: 24,
		paddingTop: 24,
		borderTopWidth: 1,
		borderTopColor: '#333',
	},
	sectionTitle: {
		fontSize: 18,
		marginBottom: 16,
	},
	debugSection: {
		flexDirection: 'row',
		flexWrap: 'wrap',
		justifyContent: 'space-between',
		marginBottom: 16,
		gap: 8,
	},
	debugButton: {
		minWidth: '30%',
		backgroundColor: '#444',
	},
	quickSendSection: {
		marginBottom: 16,
		alignItems: 'center',
	},
	quickSendButton: {
		width: '100%',
		backgroundColor: '#2d7d46',
	},
	quickSendHint: {
		marginTop: 8,
		opacity: 0.6,
		fontSize: 12,
		textAlign: 'center',
	},
	divider: {
		height: 1,
		backgroundColor: '#333',
		marginVertical: 20,
	},
	inputLabel: {
		marginBottom: 8,
		opacity: 0.7,
	},
	input: {
		backgroundColor: '#1a1a1a',
		borderRadius: 8,
		paddingHorizontal: 16,
		paddingVertical: 12,
		fontSize: 16,
		color: '#fff',
		marginBottom: 16,
		borderWidth: 1,
		borderColor: '#333',
	},
	messageInput: {
		minHeight: 80,
		textAlignVertical: 'top',
	},
	contactsSection: {
		marginTop: 24,
	},
	contactItem: {
		backgroundColor: '#1a1a1a',
		borderRadius: 8,
		padding: 12,
		marginBottom: 8,
	},
	contactName: {
		fontWeight: '500',
	},
	contactAci: {
		marginTop: 4,
		opacity: 0.6,
		fontSize: 12,
	},
	buttonRow: {
		flexDirection: 'row',
		gap: 12,
	},
	flexButton: {
		flex: 1,
	},
	refreshButton: {
		width: 50,
		paddingHorizontal: 0,
	},
	hint: {
		marginTop: 8,
		marginBottom: 16,
		opacity: 0.5,
		fontSize: 12,
		textAlign: 'center',
	},
	// CDSI Test styles
	statusBox: {
		backgroundColor: '#1a1a1a',
		borderRadius: 8,
		padding: 12,
		marginBottom: 16,
		borderWidth: 1,
		borderColor: '#333',
	},
	statusLabel: {
		opacity: 0.7,
		marginBottom: 4,
	},
	statusGreen: {
		color: '#4ade80',
	},
	statusYellow: {
		color: '#fbbf24',
	},
	resultBox: {
		backgroundColor: '#1a1a1a',
		borderRadius: 8,
		padding: 16,
		marginTop: 16,
		borderWidth: 1,
		borderColor: '#444',
	},
	resultText: {
		fontFamily: 'monospace',
		fontSize: 14,
	},
	infoBox: {
		backgroundColor: '#1a2a3a',
		borderRadius: 8,
		padding: 16,
		marginTop: 24,
		borderWidth: 1,
		borderColor: '#2a4a6a',
	},
	infoTitle: {
		fontWeight: '600',
		marginBottom: 8,
		color: '#60a5fa',
	},
});

export default memo(SignalLink);
