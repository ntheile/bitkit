import React, { ReactElement, useCallback, useState } from 'react';
import {
	FlatList,
	KeyboardAvoidingView,
	Platform,
	StyleSheet,
	TextInput,
	TouchableOpacity,
	View,
} from 'react-native';

import NavigationHeader from '../../components/NavigationHeader';
import SafeAreaInset from '../../components/SafeAreaInset';
import { useAppDispatch, useAppSelector } from '../../hooks/redux';
import { RootStackScreenProps } from '../../navigation/types';
import {
	addMessage,
	updateMessageStatus,
	SignalMessage,
} from '../../store/slices/signalMessages';
import { View as ThemedView } from '../../styles/components';
import { BodyM, BodyS, Caption } from '../../styles/text';
import { SendIcon } from '../../styles/icons';
import {
	setCaptchaCallback,
	setCaptchaVisible,
	setChallengeToken,
	setPendingChatContext,
} from '../../utils/signal/captchaCallback';
import { sendMessage, SendResult, submitCaptchaSolution } from '../../utils/signal/messaging';
import { SignalContact } from '../../utils/signal/contacts';
import { showToast } from '../../utils/notifications';

const Chat = ({
	navigation,
	route,
}: RootStackScreenProps<'Chat'>): ReactElement => {
	const { name, signal } = route.params;
	const dispatch = useAppDispatch();
	const contactId = signal.aci || signal.pni || '';
	const messages = useAppSelector(
		(state) => state.signalMessages.conversations[contactId] || [],
	);
	const [inputText, setInputText] = useState('');
	const [sending, setSending] = useState(false);

	const handleSend = useCallback(async () => {
		if (!inputText.trim() || sending) {
			return;
		}

		const messageText = inputText.trim();
		setInputText('');
		setSending(true);

		// Add message to Redux with 'sending' status
		const newMessage: SignalMessage = {
			id: Date.now().toString(),
			text: messageText,
			timestamp: Date.now(),
			sent: true,
			status: 'sending',
		};
		dispatch(addMessage({ contactId, message: newMessage }));

		// Create SignalContact from SignalIdentity
		const recipient: SignalContact = {
			aci: signal.aci || '',
			pni: signal.pni,
			phoneNumber: signal.phoneNumber || '',
			name: name,
		};

		try {
			const result: SendResult = await sendMessage(recipient, messageText);

			// Handle captcha challenge
			if (result.captchaRequired) {
				console.log('Chat: Captcha required, showing challenge');

				// Restore the input text so user can retry
				setInputText(messageText);
				// Remove the pending message by marking it failed (we'll retry with new message)
				dispatch(updateMessageStatus({ contactId, messageId: newMessage.id, status: 'failed' }));

				// Store the challenge token and chat context for when captcha is solved
				setChallengeToken(result.captchaRequired.challengeToken);
				setPendingChatContext({ name, signal });

				// Store the callback for when captcha is solved
				setCaptchaCallback(async (captchaToken: string, challengeToken: string) => {
					console.log('Chat: Captcha solved, submitting challenge');

					// First submit the captcha solution to /v1/challenge
					const challengeResult = await submitCaptchaSolution(challengeToken, captchaToken);
					if (!challengeResult.success) {
						showToast({
							type: 'warning',
							title: 'Captcha failed',
							description: challengeResult.error || 'Could not verify captcha',
						});
						return;
					}

					console.log('Chat: Challenge accepted, retrying message');

					// Add the retry message
					const retryMessage: SignalMessage = {
						id: Date.now().toString(),
						text: messageText,
						timestamp: Date.now(),
						sent: true,
						status: 'sending',
					};
					dispatch(addMessage({ contactId, message: retryMessage }));

					try {
						// Retry - the challenge submission should have cleared the block
						const retryResult = await sendMessage(recipient, messageText);
						dispatch(
							updateMessageStatus({
								contactId,
								messageId: retryMessage.id,
								status: retryResult.success ? 'sent' : 'failed',
							}),
						);

						if (!retryResult.success) {
							showToast({
								type: 'warning',
								title: 'Message failed',
								description: retryResult.error || 'Could not send message',
							});
						}
					} catch (retryError) {
						dispatch(
							updateMessageStatus({
								contactId,
								messageId: retryMessage.id,
								status: 'failed',
							}),
						);
						showToast({
							type: 'warning',
							title: 'Message failed',
							description: retryError instanceof Error ? retryError.message : 'Unknown error',
						});
					}
				});

				// Show captcha (opens browser)
				setCaptchaVisible(true);
				setSending(false);
				return;
			}

			// Update message status in Redux
			dispatch(
				updateMessageStatus({
					contactId,
					messageId: newMessage.id,
					status: result.success ? 'sent' : 'failed',
				}),
			);

			if (!result.success) {
				showToast({
					type: 'warning',
					title: 'Message failed',
					description: result.error || 'Could not send message',
				});
			}
		} catch (error) {
			dispatch(
				updateMessageStatus({
					contactId,
					messageId: newMessage.id,
					status: 'failed',
				}),
			);
			showToast({
				type: 'warning',
				title: 'Message failed',
				description: error instanceof Error ? error.message : 'Unknown error',
			});
		} finally {
			setSending(false);
		}
	}, [inputText, sending, signal, name, dispatch, contactId]);

	const renderMessage = useCallback(
		({ item }: { item: SignalMessage }) => (
			<View
				style={[
					styles.messageBubble,
					item.sent ? styles.sentBubble : styles.receivedBubble,
				]}>
				<BodyM style={styles.messageText}>{item.text}</BodyM>
				<View style={styles.messageFooter}>
					<Caption color="secondary">
						{new Date(item.timestamp).toLocaleTimeString([], {
							hour: '2-digit',
							minute: '2-digit',
						})}
					</Caption>
					{item.sent && (
						<Caption
							color={item.status === 'failed' ? 'brand' : 'secondary'}
							style={styles.statusText}>
							{item.status === 'sending'
								? 'Sending...'
								: item.status === 'sent'
									? 'Sent'
									: 'Failed'}
						</Caption>
					)}
				</View>
			</View>
		),
		[],
	);

	return (
		<ThemedView style={styles.root}>
			<SafeAreaInset type="top" />
			<NavigationHeader title={name} />

			<KeyboardAvoidingView
				style={styles.container}
				behavior={Platform.OS === 'ios' ? 'padding' : undefined}
				keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}>
				<FlatList
					data={messages}
					renderItem={renderMessage}
					keyExtractor={(item) => item.id}
					inverted
					contentContainerStyle={styles.messageList}
					ListEmptyComponent={
						<View style={styles.emptyContainer}>
							<BodyS color="secondary" style={styles.emptyText}>
								Send a message to start the conversation
							</BodyS>
						</View>
					}
				/>

				<View style={styles.inputContainer}>
					<TextInput
						style={styles.input}
						value={inputText}
						onChangeText={setInputText}
						placeholder="Type a message..."
						placeholderTextColor="#666"
						multiline
						maxLength={2000}
						editable={!sending}
					/>
					<TouchableOpacity
						style={[
							styles.sendButton,
							(!inputText.trim() || sending) && styles.sendButtonDisabled,
						]}
						onPress={() => handleSend()}
						disabled={!inputText.trim() || sending}>
						<SendIcon width={24} height={24} color="black" />
					</TouchableOpacity>
				</View>
			</KeyboardAvoidingView>
			<SafeAreaInset type="bottom" minPadding={16} />
		</ThemedView>
	);
};

const styles = StyleSheet.create({
	root: {
		flex: 1,
	},
	container: {
		flex: 1,
	},
	messageList: {
		paddingHorizontal: 16,
		paddingVertical: 8,
		flexGrow: 1,
	},
	emptyContainer: {
		flex: 1,
		justifyContent: 'center',
		alignItems: 'center',
		transform: [{ scaleY: -1 }],
	},
	emptyText: {
		textAlign: 'center',
	},
	messageBubble: {
		maxWidth: '80%',
		padding: 12,
		borderRadius: 16,
		marginVertical: 4,
	},
	sentBubble: {
		alignSelf: 'flex-end',
		backgroundColor: '#FF6600',
		borderBottomRightRadius: 4,
	},
	receivedBubble: {
		alignSelf: 'flex-start',
		backgroundColor: '#333',
		borderBottomLeftRadius: 4,
	},
	messageText: {
		color: '#fff',
	},
	messageFooter: {
		flexDirection: 'row',
		justifyContent: 'flex-end',
		marginTop: 4,
		gap: 8,
	},
	statusText: {
		marginLeft: 8,
	},
	inputContainer: {
		flexDirection: 'row',
		alignItems: 'flex-end',
		paddingHorizontal: 16,
		paddingVertical: 8,
		borderTopWidth: 1,
		borderTopColor: '#333',
	},
	input: {
		flex: 1,
		backgroundColor: '#222',
		borderRadius: 20,
		paddingHorizontal: 16,
		paddingVertical: 10,
		marginRight: 8,
		color: '#fff',
		fontSize: 16,
		maxHeight: 100,
	},
	sendButton: {
		width: 44,
		height: 44,
		borderRadius: 22,
		backgroundColor: '#FF6600',
		justifyContent: 'center',
		alignItems: 'center',
	},
	sendButtonDisabled: {
		opacity: 0.5,
	},
});

export default Chat;
