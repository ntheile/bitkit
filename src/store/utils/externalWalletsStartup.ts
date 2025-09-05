import { RootState } from '..'
import { dispatch } from '../helpers'
import { setExternalWalletStatus, TExternalWalletsState } from '../slices/externalWallets'
import { createNodeInstance, syncExternalWalletTransactions } from './externalWallets'

// Function to initialize the default external wallet on app startup
export const initializeDefaultExternalWallet = async (
  getState: () => RootState,
): Promise<void> => {
  try {
    const state = getState()
    const wallets: TExternalWalletsState = state.externalWallets
    const defaultWallet = wallets.defaultWallet

    if (!defaultWallet) {
      console.log('No default external wallet configured for initialization')
      return
    }

    const walletConfig = wallets[defaultWallet]
    if (!walletConfig || !walletConfig.connected) {
      console.log(`Default wallet ${defaultWallet} is not connected, skipping initialization`)
      return
    }

    console.log(`Initializing default external wallet: ${defaultWallet}`)

    // Create node instance to test connection and get info
    const node = createNodeInstance(defaultWallet, walletConfig)
    if (!node) {
      console.warn(`Failed to create node instance for ${defaultWallet}`)
      return
    }

    // Test connection and get node info
    const nodeInfo = await node.getInfo()
    console.log(`Default external wallet ${defaultWallet} initialized successfully:`, {
      alias: nodeInfo.alias,
      pubkey: nodeInfo.pubkey ? `${nodeInfo.pubkey.substring(0, 20)}...` : 'unknown',
      network: nodeInfo.network,
      blockHeight: nodeInfo.blockHeight ? Number(nodeInfo.blockHeight) : 0,
    })

    // Update the external wallet state with fresh connection info
    dispatch(
      setExternalWalletStatus({
        type: defaultWallet,
        connected: true,
        lastNodeInfo: {
          alias: nodeInfo.alias,
          pubkey: nodeInfo.pubkey,
          network: nodeInfo.network,
          blockHeight: nodeInfo.blockHeight ? Number(nodeInfo.blockHeight) : 0,
          blockHash: nodeInfo.blockHash,
          color: nodeInfo.color,
          nodeType: defaultWallet,
          sendBalanceSats: nodeInfo.sendBalanceMsat
            ? Number(nodeInfo.sendBalanceMsat / BigInt(1000))
            : 0,
          receiveBalanceSats: nodeInfo.receiveBalanceMsat
            ? Number(nodeInfo.receiveBalanceMsat / BigInt(1000))
            : 0,
          feeCreditBalanceSats: nodeInfo.feeCreditBalanceMsat
            ? Number(nodeInfo.feeCreditBalanceMsat / BigInt(1000))
            : 0,
          pendingOpenReceiveBalanceSats: nodeInfo.pendingOpenReceiveBalance
            ? Number(nodeInfo.pendingOpenReceiveBalance / BigInt(1000))
            : 0,
        },
      }),
    )

    // Sync transactions on startup
    console.log(`Syncing transactions for ${defaultWallet}...`)
    await syncExternalWalletTransactions(getState).catch((error) => {
      console.error(`Error syncing transactions for ${defaultWallet}:`, error)
    })
    
    console.log(`Default external wallet ${defaultWallet} fully initialized`)
  } catch (error) {
    console.error('Error initializing default external wallet:', error)
    
    // Update the external wallet state with error
    const state = getState()
    const defaultWallet = state.externalWallets.defaultWallet
    if (defaultWallet) {
      dispatch(
        setExternalWalletStatus({
          type: defaultWallet,
          connected: false,
          error: error instanceof Error ? error.message : 'Unknown error during initialization',
        }),
      )
    }
  }
}
