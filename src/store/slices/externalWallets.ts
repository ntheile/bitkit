import { PayloadAction, createSlice } from '@reduxjs/toolkit';

export type TExternalWalletType = 'lnd' | 'cln' | 'phoenixd' | 'strike' | 'blink' | 'speed' | 'nwc';

export interface TBaseConnectionState {
	connected: boolean;
	lastConnectedAt?: number; // epoch ms
	lastNodeInfo?: unknown; // raw info object returned by getInfo (if available)
	error?: string;
}

export interface TLndConnection extends TBaseConnectionState {
	url: string;
	macaroon: string; // hex
	socks5Proxy?: string;
	acceptInvalidCerts?: boolean;
}

export interface TClnConnection extends TBaseConnectionState {
	url: string;
	rune: string;
	socks5Proxy?: string;
	acceptInvalidCerts?: boolean;
}

export interface TPhoenixdConnection extends TBaseConnectionState {
	url: string;
	password: string;
	socks5Proxy?: string;
	acceptInvalidCerts?: boolean;
}

export interface TStrikeConnection extends TBaseConnectionState {
	apiKey: string;
}

export interface TBlinkConnection extends TBaseConnectionState {
	baseUrl: string;
	apiKey: string;
}

export interface TSpeedConnection extends TBaseConnectionState {
	baseUrl: string;
	apiKey: string;
}

export interface TNwcConnection extends TBaseConnectionState {
	nwcUri: string;
	socks5Proxy?: string;
	httpTimeout?: number; // stored as number in state, converted to bigint for LNI
}

export interface TExternalWalletsState {
	lnd?: TLndConnection;
	cln?: TClnConnection;
	phoenixd?: TPhoenixdConnection;
	strike?: TStrikeConnection;
	blink?: TBlinkConnection;
	speed?: TSpeedConnection;
	nwc?: TNwcConnection;
	defaultWallet?: TExternalWalletType;
}

export const initialExternalWalletsState: TExternalWalletsState = {};

type TUpsertPayload = {
	type: TExternalWalletType;
	data: Partial<
		TLndConnection & TClnConnection & TPhoenixdConnection & TStrikeConnection & TBlinkConnection & TSpeedConnection & TNwcConnection
	>;
};

type TSetStatusPayload = {
	type: TExternalWalletType;
	connected: boolean;
	error?: string;
	lastNodeInfo?: unknown;
};

export const externalWalletsSlice = createSlice({
	name: 'externalWallets',
	initialState: initialExternalWalletsState,
	reducers: {
		upsertExternalWallet: (state, action: PayloadAction<TUpsertPayload>) => {
			const { type, data } = action.payload;
			const existing: any = state[type];
			state[type] = {
				connected: existing?.connected ?? false,
				lastConnectedAt: existing?.lastConnectedAt,
				lastNodeInfo: existing?.lastNodeInfo,
				error: undefined,
				...existing,
				...data,
			} as any;
		},
		setExternalWalletStatus: (
			state,
			action: PayloadAction<TSetStatusPayload>,
		) => {
			const { type, connected, error, lastNodeInfo } = action.payload;
			const existing: any = state[type] || {};
			state[type] = {
				...existing,
				connected,
				error,
				lastConnectedAt: connected ? Date.now() : existing.lastConnectedAt,
				lastNodeInfo:
					lastNodeInfo ?? (connected ? existing.lastNodeInfo : undefined),
			};
		},
		removeExternalWallet: (
			state,
			action: PayloadAction<TExternalWalletType>,
		) => {
			delete (state as any)[action.payload];
		},
		setDefaultExternalWallet: (
			state,
			action: PayloadAction<TExternalWalletType | undefined>,
		) => {
			state.defaultWallet = action.payload;
		},
		resetExternalWalletsState: () => initialExternalWalletsState,
	},
});

export const {
	upsertExternalWallet,
	setExternalWalletStatus,
	removeExternalWallet,
	setDefaultExternalWallet,
	resetExternalWalletsState,
} = externalWalletsSlice.actions;

export default externalWalletsSlice.reducer;
