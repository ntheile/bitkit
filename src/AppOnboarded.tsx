import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import React, { memo, ReactElement } from 'react';

import InactivityTracker from './components/InactivityTracker';
import { SlashtagsProvider } from './components/SlashtagsProvider';
import { useAppStateHandler } from './hooks/useAppStateHandler';
import { useNetworkConnectivity } from './hooks/useNetworkConnectivity';
import { useSignalMessages } from './hooks/useSignalMessages';
import { useWalletStartup } from './hooks/useWalletStartup';
import DrawerNavigator from './navigation/root/DrawerNavigator';
import RootNavigationContainer from './navigation/root/RootNavigationContainer';
import { SheetRefsProvider } from './sheets/SheetRefsProvider';

const AppOnboarded = (): ReactElement => {
	useWalletStartup();
	useAppStateHandler();
	useNetworkConnectivity();
	useSignalMessages(); // Connect to Signal WebSocket for receiving messages

	return (
		<SlashtagsProvider>
			<SheetRefsProvider>
				<InactivityTracker>
					<RootNavigationContainer>
						<BottomSheetModalProvider>
							<DrawerNavigator />
						</BottomSheetModalProvider>
					</RootNavigationContainer>
				</InactivityTracker>
			</SheetRefsProvider>
		</SlashtagsProvider>
	);
};

export default memo(AppOnboarded);
