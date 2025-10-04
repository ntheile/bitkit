import React, { ReactElement, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

import { useAppDispatch, useAppSelector } from '../../hooks/redux';
import store from '../../store';
import { externalWalletSelector } from '../../store/reselect/externalWallets';
import {
	setExternalWalletStatus,
	upsertExternalWallet,
	setDefaultExternalWallet,
} from '../../store/slices/externalWallets';
import { TConnectWalletWidgetOptions } from '../../store/types/widgets';
import { syncExternalWalletTransactions } from '../../store/utils/externalWallets';
import { BodyM, CaptionB, Title } from '../../styles/text';
import LabeledInput from '../LabeledInput';
import Button from '../buttons/Button';
import BaseWidget from './BaseWidget';

import {
  LndNode,
  LndConfig,
  ClnConfig,
  ClnNode,
  PhoenixdConfig,
  PhoenixdNode,
  NwcNode,
  NwcConfig,
  BlinkNode,
  BlinkConfig,
  SpeedNode,
  SpeedConfig,
  StrikeConfig,
  StrikeNode,
} from 'lni_react_native';


type WalletType = 'lnd' | 'cln' | 'phoenixd' | 'strike' | 'nwc' | 'blink' | 'speed';

interface ConnectionForm {
	walletType: WalletType;
	url: string;
	macaroon: string;
	rune: string;
	password: string;
	apiKey: string;
	nwcUri: string;
	baseUrl: string;
}

const ConnectWalletWidget = ({
	options,
	isEditing = false,
	style,
	testID,
	onPressIn,
	onLongPress,
}: {
	options: TConnectWalletWidgetOptions;
	isEditing?: boolean;
	style?: StyleProp<ViewStyle>;
	testID?: string;
	onPressIn?: () => void;
	onLongPress?: () => void;
}): ReactElement => {
	const { t } = useTranslation('widgets');
	const dispatch = useAppDispatch();
	const [selectedWallet, setSelectedWallet] = useState<WalletType>('lnd');

	// Select stored connection for current wallet type
	const storedConnection: any = useAppSelector((state) =>
		externalWalletSelector(state, selectedWallet),
	);
	const [connectionForm, setConnectionForm] = useState<ConnectionForm>({
		walletType: 'lnd',
		url: '',
		macaroon: '',
		rune: '',
		password: '',
		apiKey: '',
		nwcUri: '',
		baseUrl: '',
	});
	const [isConnecting, setIsConnecting] = useState(false);
	const [connectionStatus, setConnectionStatus] = useState<
		'idle' | 'connected' | 'error'
	>('idle');
	const [isEditingConnection, setIsEditingConnection] = useState(false);

	useEffect(()=>{
		syncExternalWalletTransactions(() => store.getState())
	}, [])

	// Prefill form from stored connection when switching wallets
	useEffect(() => {
		if (storedConnection) {
			setConnectionForm((prev) => ({
				...prev,
				walletType: selectedWallet,
				url: storedConnection.url || '',
				macaroon: storedConnection.macaroon || '',
				rune: storedConnection.rune || '',
				password: storedConnection.password || '',
				apiKey: storedConnection.apiKey || '',
				nwcUri: storedConnection.nwcUri || '',
				baseUrl: storedConnection.baseUrl || '',
			}));
			setConnectionStatus(storedConnection.connected ? 'connected' : 'idle');
		} else {
			setConnectionStatus('idle');
		}
	}, [selectedWallet, storedConnection]);

	// Add new handler for wallet switching
	const handleWalletSwitch = (walletType: WalletType) => {
		setSelectedWallet(walletType);
		setConnectionForm((prev) => ({
			...prev,
			walletType,
		}));
		setIsEditingConnection(false); // Reset edit mode when switching wallets
	};

	const handleConnect = async () => {
		setIsConnecting(true);
		setConnectionStatus('idle');

		try {
			// ensureLniLoaded();
			let nodeInstance: any;

			switch (selectedWallet) {
				case 'lnd': {
					if (!connectionForm.url || !connectionForm.macaroon) {
						throw new Error('URL and Macaroon are required for LND connection');
					}

					nodeInstance = new LndNode(
						LndConfig.create({
							url: connectionForm.url,
							macaroon: connectionForm.macaroon,
							socks5Proxy: undefined,
							acceptInvalidCerts: true,
							httpTimeout: BigInt(120),
						}),
					);

					// Test the connection by getting node info
					const nodeInfo = await nodeInstance.getInfo();
					console.log('LND connection successful:', nodeInfo);
					break;
				}

				case 'cln': {
					if (!connectionForm.url || !connectionForm.rune) {
						throw new Error(
							'URL and Rune are required for Core Lightning connection',
						);
					}

					nodeInstance = new ClnNode(
						ClnConfig.create({
							url: connectionForm.url,
							rune: connectionForm.rune,
							socks5Proxy: undefined,
							acceptInvalidCerts: true,
							httpTimeout: BigInt(120),
						}),
					);

					// Test the connection by getting node info
					const nodeInfo = await nodeInstance.getInfo();
					console.log('Core Lightning connection successful:', nodeInfo);
					break;
				}

				case 'phoenixd': {
					if (!connectionForm.url || !connectionForm.password) {
						throw new Error(
							'URL and Password are required for Phoenixd connection',
						);
					}

					nodeInstance = new PhoenixdNode(
						PhoenixdConfig.create({
							url: connectionForm.url,
							password: connectionForm.password,
							socks5Proxy: undefined,
							acceptInvalidCerts: true,
							httpTimeout: BigInt(120),
						}),
					);

					// Test the connection by getting node info
					const nodeInfo = await nodeInstance.getInfo();
					console.log('Phoenixd connection successful:', nodeInfo);
					break;
				}

				case 'strike': {
					if (!connectionForm.apiKey) {
						throw new Error('API Key is required for Strike connection');
					}

					nodeInstance = new StrikeNode(
						StrikeConfig.create({
							apiKey: connectionForm.apiKey,
						}),
					);

					// Test the connection by getting node info
					const nodeInfo = await nodeInstance.getInfo();
					console.log('Strike connection successful:', nodeInfo);
					break;
				}

				case 'nwc': {
					if (!connectionForm.nwcUri) {
						throw new Error('NWC URI is required for NWC connection');
					}

					nodeInstance = new NwcNode(
						NwcConfig.create({
							nwcUri: connectionForm.nwcUri,
							socks5Proxy: undefined,
							httpTimeout: BigInt(120),
						}),
					);

					// Test the connection by getting node info
					const nodeInfo = await nodeInstance.getInfo();
					console.log('NWC connection successful:', nodeInfo);
					break;
				}

				case 'blink': {
					if (!connectionForm.apiKey) {
						throw new Error('API Key is required for Blink connection');
					}

					nodeInstance = new BlinkNode(
						BlinkConfig.create({
							apiKey: connectionForm.apiKey,
						}),
					);

					// Test the connection by getting node info
					const nodeInfo = await nodeInstance.getInfo();
					console.log('Blink connection successful:', nodeInfo);
					break;
				}

				case 'speed': {
					if (!connectionForm.apiKey) {
						throw new Error('API Key is required for Speed connection');
					}

					nodeInstance = new SpeedNode(
						SpeedConfig.create({
							apiKey: connectionForm.apiKey,
						}),
					);

					// Test the connection by getting node info
					const nodeInfo = await nodeInstance.getInfo();
					console.log('Speed connection successful:', nodeInfo);
					break;
				}

				default:
					throw new Error('Unknown wallet type');
			}

			// Persist credentials (minimal) & status
			dispatch(
				upsertExternalWallet({
					type: selectedWallet,
					data: { ...connectionForm },
				}),
			);
			dispatch(
				setExternalWalletStatus({
					type: selectedWallet,
					connected: true,
					lastNodeInfo: undefined, // Could store nodeInfo; omitted to reduce size
				}),
			);
			
			// Set as default wallet if no default is currently set
			const currentState = store.getState();
			if (!currentState.externalWallets.defaultWallet) {
				dispatch(setDefaultExternalWallet(selectedWallet));
			}
			
			setConnectionStatus('connected');
			// Fire & forget transaction sync
			syncExternalWalletTransactions(store.getState).catch((e) =>
				console.warn('Sync failed', e),
			);
		} catch (error) {
			console.error('Failed to connect:', error);
			setConnectionStatus('error');
			dispatch(
				setExternalWalletStatus({
					type: selectedWallet,
					connected: false,
					error: (error as Error).message,
				}),
			);
		} finally {
			setIsConnecting(false);
		}
	};

	const renderWalletSelector = () => {
		const walletTypes: {
			type: WalletType;
			label: string;
			description: string;
		}[] = [
			{ type: 'lnd', label: 'LND', description: 'Lightning Network Daemon' },
			{
				type: 'cln',
				label: 'Core Lightning',
				description: 'Blockstream Core Lightning',
			},
			{ type: 'phoenixd', label: 'Phoenixd', description: 'Phoenix daemon' },
			{ type: 'strike', label: 'Strike', description: 'Strike API' },
			{ type: 'blink', label: 'Blink', description: 'Blink Wallet' },
			{ type: 'speed', label: 'Speed', description: 'Speed Wallet' },
			{ type: 'nwc', label: 'NWC', description: 'Nostr Wallet Connect' },
		];

		return (
			<View style={styles.walletSelector}>
				{walletTypes.map((wallet) => (
					<Button
						key={wallet.type}
						text={wallet.label}
						variant={selectedWallet === wallet.type ? 'primary' : 'secondary'}
						size="small"
						onPress={() => handleWalletSwitch(wallet.type)}
						style={styles.walletButton}
					/>
				))}
			</View>
		);
	};

	const renderConnectionForm = () => {
		switch (selectedWallet) {
			case 'lnd':
				return (
					<View style={styles.formSection}>
						<BodyM style={styles.formTitle}>LND Connection</BodyM>
						<LabeledInput
							label="REST URL"
							placeholder="https://your-node:8080"
							value={connectionForm.url}
							onChange={(text) =>
								setConnectionForm((prev) => ({ ...prev, url: text }))
							}
							style={styles.input}
						/>
						<LabeledInput
							label="Macaroon (hex)"
							placeholder="0201036c6e6404..."
							value={connectionForm.macaroon}
							onChange={(text) =>
								setConnectionForm((prev) => ({ ...prev, macaroon: text }))
							}
							multiline
							style={styles.input}
						/>
					</View>
				);

			case 'cln':
				return (
					<View style={styles.formSection}>
						<BodyM style={styles.formTitle}>Core Lightning Connection</BodyM>
						<LabeledInput
							label="REST URL"
							placeholder="https://your-cln-node:3010"
							value={connectionForm.url}
							onChange={(text) =>
								setConnectionForm((prev) => ({ ...prev, url: text }))
							}
							style={styles.input}
						/>
						<LabeledInput
							label="Rune"
							placeholder="Your CLN rune string"
							value={connectionForm.rune}
							onChange={(text) =>
								setConnectionForm((prev) => ({ ...prev, rune: text }))
							}
							multiline
							style={styles.input}
						/>
					</View>
				);

			case 'phoenixd':
				return (
					<View style={styles.formSection}>
						<BodyM style={styles.formTitle}>Phoenixd Connection</BodyM>
						<LabeledInput
							label="REST URL"
							placeholder="http://localhost:9740"
							value={connectionForm.url}
							onChange={(text) =>
								setConnectionForm((prev) => ({ ...prev, url: text }))
							}
							style={styles.input}
						/>
						<LabeledInput
							label="Password"
							placeholder="Your phoenixd password"
							value={connectionForm.password}
							onChange={(text) =>
								setConnectionForm((prev) => ({ ...prev, password: text }))
							}
							style={styles.input}
						/>
					</View>
				);

			case 'strike':
				return (
					<View style={styles.formSection}>
						<BodyM style={styles.formTitle}>Strike API Connection</BodyM>
						<LabeledInput
							label="API Key"
							placeholder="Your Strike API key"
							value={connectionForm.apiKey}
							onChange={(text) =>
								setConnectionForm((prev) => ({ ...prev, apiKey: text }))
							}
							style={styles.input}
						/>
					</View>
				);

			case 'blink':
				return (
					<View style={styles.formSection}>
						<BodyM style={styles.formTitle}>Blink Wallet Connection</BodyM>
						<LabeledInput
							label="API Key"
							placeholder="Your Blink API key"
							value={connectionForm.apiKey}
							onChange={(text) =>
								setConnectionForm((prev) => ({ ...prev, apiKey: text }))
							}
							style={styles.input}
						/>
					</View>
				);

			case 'speed':
				return (
					<View style={styles.formSection}>
						<BodyM style={styles.formTitle}>Speed Wallet Connection</BodyM>
						<LabeledInput
							label="API Key"
							placeholder="Your Speed API key"
							value={connectionForm.apiKey}
							onChange={(text) =>
								setConnectionForm((prev) => ({ ...prev, apiKey: text }))
							}
							style={styles.input}
						/>
					</View>
				);

			case 'nwc':
				return (
					<View style={styles.formSection}>
						<BodyM style={styles.formTitle}>Nostr Wallet Connect</BodyM>
						<LabeledInput
							label="NWC URI"
							placeholder="nostr+walletconnect://..."
							value={connectionForm.nwcUri}
							onChange={(text) =>
								setConnectionForm((prev) => ({ ...prev, nwcUri: text }))
							}
							multiline
							style={styles.input}
						/>
					</View>
				);

			default:
				return null;
		}
	};

	const isFormValid = () => {
		switch (selectedWallet) {
			case 'lnd':
				return connectionForm.url && connectionForm.macaroon;
			case 'cln':
				return connectionForm.url && connectionForm.rune;
			case 'phoenixd':
				return connectionForm.url && connectionForm.password;
			case 'strike':
				return connectionForm.apiKey;
			case 'blink':
				return connectionForm.apiKey;
			case 'speed':
				return connectionForm.apiKey;
			case 'nwc':
				return connectionForm.nwcUri;
			default:
				return false;
		}
	};

	return (
		<BaseWidget
			id="connectwallet"
			isEditing={isEditing}
			style={style}
			testID={testID}
			onPressIn={onPressIn}
			onLongPress={onLongPress}>
			<Title numberOfLines={2}>{t('connectwallet.title')}</Title>

			{options.showInstructions && (
				<View style={styles.instructions}>
					<CaptionB color="secondary" numberOfLines={3}>
						{t('connectwallet.instructions')}
					</CaptionB>
				</View>
			)}

			{/* Always show wallet selector */}
			{renderWalletSelector()}

			{/* Show connection form when idle or when editing */}
			{(connectionStatus === 'idle' || isEditingConnection) && (
				<>
					{renderConnectionForm()}
					<View style={styles.buttonRow}>
						<Button
							text={isConnecting ? 'Connecting...' : 'Connect'}
							size="small"
							disabled={!isFormValid() || isConnecting}
							onPress={handleConnect}
							style={[styles.connectButton, styles.flexButton]}
						/>
						{isEditingConnection && (
							<Button
								text="Cancel"
								variant="secondary"
								size="small"
								onPress={() => setIsEditingConnection(false)}
								style={[styles.connectButton, styles.flexButton]}
							/>
						)}
					</View>
				</>
			)}

			{/* Show connected status with edit button */}
			{connectionStatus === 'connected' && !isEditingConnection && (
				<View style={styles.statusSection}>
					<BodyM color="green">
						✓ Connected to {selectedWallet.toUpperCase()}
					</BodyM>
					<View style={styles.buttonRow}>
						<Button
							text="Edit"
							variant="secondary"
							size="small"
							onPress={() => setIsEditingConnection(true)}
							style={[styles.connectButton, styles.flexButton]}
						/>
						<Button
							text="Disconnect"
							variant="secondary"
							size="small"
							onPress={() => {
								setConnectionStatus('idle');
								setIsEditingConnection(false);
								dispatch(
									setExternalWalletStatus({
										type: selectedWallet,
										connected: false,
									}),
								);
							}}
							style={[styles.connectButton, styles.flexButton]}
						/>
					</View>
				</View>
			)}

			{connectionStatus === 'error' && (
				<View style={styles.statusSection}>
					<BodyM color="red">✗ Connection failed</BodyM>
					<Button
						text="Try Again"
						variant="secondary"
						size="small"
						onPress={() => setConnectionStatus('idle')}
						style={styles.connectButton}
					/>
				</View>
			)}

			{options.showSource && (
				<View style={styles.source}>
					<View style={styles.columnLeft}>
						<CaptionB color="secondary" numberOfLines={1}>
							{t('widget.source')}
						</CaptionB>
					</View>
					<View style={styles.columnRight}>
						<CaptionB color="secondary" numberOfLines={1}>
							LNI + Bitkit
						</CaptionB>
					</View>
				</View>
			)}
		</BaseWidget>
	);
};

const styles = StyleSheet.create({
	instructions: {
		marginTop: 8,
	},
	pairingCode: {
		marginTop: 8,
	},
	walletSelector: {
		flexDirection: 'row',
		flexWrap: 'wrap',
		gap: 8,
		marginTop: 12,
	},
	walletButton: {
		minWidth: 80,
	},
	formSection: {
		marginTop: 16,
	},
	formTitle: {
		marginBottom: 12,
		fontWeight: '600',
	},
	input: {
		marginBottom: 12,
	},
	connectButton: {
		marginTop: 16,
	},
	buttonRow: {
		flexDirection: 'row',
		gap: 8,
		marginTop: 16,
	},
	flexButton: {
		flex: 1,
		marginTop: 0,
	},
	statusSection: {
		marginTop: 16,
		alignItems: 'center',
		gap: 12,
	},
	columnLeft: {
		flex: 1,
		flexDirection: 'row',
		alignItems: 'center',
	},
	columnRight: {
		flex: 1,
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'flex-end',
	},
	source: {
		marginTop: 16,
		flexDirection: 'row',
		alignItems: 'center',
	},
});

export default ConnectWalletWidget;
