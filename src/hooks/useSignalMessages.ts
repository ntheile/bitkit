/**
 * Signal Messages Hook
 *
 * Manages the WebSocket connection for receiving Signal messages
 * and integrates with Redux for message storage.
 */

import { useEffect, useCallback, useRef } from 'react';
import { useAppDispatch } from './redux';
import { addMessage, SignalMessage } from '../store/slices/signalMessages';
import {
	MessageSocket,
	getMessageSocket,
	disconnectMessageSocket,
	ReceivedMessage,
} from '../utils/signal/message-socket';
import { getAccountInfo } from '../storage/signal-store';

export interface UseSignalMessagesOptions {
	enabled?: boolean;
	onMessageReceived?: (message: ReceivedMessage) => void;
}

export interface UseSignalMessagesResult {
	isConnected: boolean;
	connect: () => void;
	disconnect: () => void;
}

/**
 * Hook to manage Signal message WebSocket connection.
 *
 * Automatically connects when Signal is linked and enabled.
 * Stores received messages in Redux.
 */
export function useSignalMessages(
	options: UseSignalMessagesOptions = {},
): UseSignalMessagesResult {
	const { enabled = true, onMessageReceived } = options;
	const dispatch = useAppDispatch();
	const socketRef = useRef<MessageSocket | null>(null);
	const isConnectedRef = useRef(false);

	const handleMessageReceived = useCallback(
		(message: ReceivedMessage) => {
			console.log('useSignalMessages: Received message from', message.senderAci);

			// Convert to Redux message format
			const reduxMessage: SignalMessage = {
				id: message.id,
				text: message.text,
				timestamp: message.timestamp,
				sent: false, // We received this message
				status: 'sent', // Already delivered to us
			};

			// Add to Redux store
			dispatch(
				addMessage({
					contactId: message.senderAci,
					message: reduxMessage,
				}),
			);

			// Call optional callback
			onMessageReceived?.(message);
		},
		[dispatch, onMessageReceived],
	);

	const connect = useCallback(() => {
		const accountInfo = getAccountInfo();
		if (!accountInfo) {
			console.log('useSignalMessages: Cannot connect - no account info');
			return;
		}

		if (socketRef.current?.isConnected()) {
			console.log('useSignalMessages: Already connected');
			return;
		}

		console.log('useSignalMessages: Connecting...');

		socketRef.current = getMessageSocket({
			onMessageReceived: handleMessageReceived,
			onConnected: () => {
				console.log('useSignalMessages: Connected');
				isConnectedRef.current = true;
			},
			onDisconnected: () => {
				console.log('useSignalMessages: Disconnected');
				isConnectedRef.current = false;
			},
			onError: (error) => {
				console.error('useSignalMessages: Error:', error);
			},
		});

		socketRef.current.connect();
	}, [handleMessageReceived]);

	const disconnect = useCallback(() => {
		console.log('useSignalMessages: Disconnecting...');
		disconnectMessageSocket();
		socketRef.current = null;
		isConnectedRef.current = false;
	}, []);

	// Auto-connect when enabled and Signal is linked
	useEffect(() => {
		if (!enabled) {
			disconnect();
			return;
		}

		const accountInfo = getAccountInfo();
		if (accountInfo) {
			connect();
		}

		return () => {
			disconnect();
		};
	}, [enabled, connect, disconnect]);

	return {
		isConnected: isConnectedRef.current,
		connect,
		disconnect,
	};
}

export default useSignalMessages;
