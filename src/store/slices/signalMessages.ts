import { PayloadAction, createSlice } from '@reduxjs/toolkit';

export interface SignalMessage {
	id: string;
	text: string;
	timestamp: number;
	sent: boolean; // true = we sent it, false = we received it
	status: 'sending' | 'sent' | 'failed';
}

export interface SignalMessagesState {
	// Keyed by contact ID (ACI or PNI)
	conversations: {
		[contactId: string]: SignalMessage[];
	};
}

const initialState: SignalMessagesState = {
	conversations: {},
};

const signalMessagesSlice = createSlice({
	name: 'signalMessages',
	initialState,
	reducers: {
		addMessage: (
			state,
			action: PayloadAction<{ contactId: string; message: SignalMessage }>,
		) => {
			const { contactId, message } = action.payload;
			if (!state.conversations[contactId]) {
				state.conversations[contactId] = [];
			}
			// Add to beginning (newest first)
			state.conversations[contactId].unshift(message);
		},
		updateMessageStatus: (
			state,
			action: PayloadAction<{
				contactId: string;
				messageId: string;
				status: 'sending' | 'sent' | 'failed';
			}>,
		) => {
			const { contactId, messageId, status } = action.payload;
			const messages = state.conversations[contactId];
			if (messages) {
				const message = messages.find((m) => m.id === messageId);
				if (message) {
					message.status = status;
				}
			}
		},
		clearConversation: (state, action: PayloadAction<string>) => {
			delete state.conversations[action.payload];
		},
	},
});

export const { addMessage, updateMessageStatus, clearConversation } =
	signalMessagesSlice.actions;
export default signalMessagesSlice.reducer;
