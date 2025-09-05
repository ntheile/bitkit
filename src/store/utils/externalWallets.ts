import { RootState } from '..'
import { dispatch } from '../helpers'
import { updateActivityItems } from '../slices/activity'
import {
  TExternalWalletsState,
  setExternalWalletStatus,
} from '../slices/externalWallets'
import { batchAddMetaTxTags } from '../slices/metadata'
import {
  EActivityType,
  IActivityItem,
  TLightningActivityItem,
} from '../types/activity'

import {
  LndNode,
  LndConfig,
  ClnNode,
  ClnConfig,
  PhoenixdNode,
  PhoenixdConfig,
  NwcNode,
  NwcConfig,
  BlinkNode,
  BlinkConfig,
  SpeedNode,
  SpeedConfig,
  StrikeNode,
  StrikeConfig,
  Transaction as LniTransaction,
  PayInvoiceParams,
  CreateInvoiceParams,
  InvoiceType,
  getInfoAsync,
} from 'lni_react_native'

type LniListTransactionsArgs = {
  from: bigint
  limit: bigint
  paymentHash?: string | undefined
}

// Map LNI transaction to internal activity item (lightning for now)
const mapLniTxToActivity = (tx: LniTransaction): IActivityItem | undefined => {
  try {
    const isSent = tx.type === 'outgoing'
    const valueMsat = tx.amountMsats ?? BigInt(0)
    // const feeMsat = tx.feesPaid ?? BigInt(0) // Not used currently

    // Convert from millisats to sats, ensuring we have valid numbers
    const valueSats = Number(valueMsat / BigInt(1000))
    // const feeSats = Number(feeMsat / BigInt(1000)) // Not used currently

    // Ensure we have a valid timestamp
    const timestamp = Number(tx.createdAt) * 1000 || Date.now()

    return {
      id: tx.paymentHash,
      activityType: EActivityType.lightning,
      txType: isSent ? 'sent' : 'received',
      status: tx.preimage ? 'successful' : 'pending',
      value: Math.abs(valueSats), // Ensure positive value
      fee: 0, //Math.abs(feeSats), // Ensure positive fee
      address: tx.invoice || '',
      confirmed: !!tx.preimage,
      message: tx.description || '',
      timestamp,
      preimage: tx.preimage || '',
    } as TLightningActivityItem
  } catch (error) {
    console.warn('Error mapping transaction to activity item:', error, tx)
    return undefined
  }
}

export const syncExternalWalletTransactions = async (
  getState: () => RootState,
) => {
  try {
    const state = getState()
    const wallets: TExternalWalletsState = state.externalWallets
    const activity: IActivityItem[] = []

    // Check if we have any connected wallets
    const connectedWallets = Object.keys(wallets).filter((key) => {
      const wallet = wallets[key as keyof TExternalWalletsState]
      return (
        wallet &&
        typeof wallet === 'object' &&
        'connected' in wallet &&
        wallet.connected
      )
    })

    if (connectedWallets.length === 0) {
      console.log('No connected external wallets found')
      return
    }

    // Reduced limit to prevent Redux middleware performance warnings
    const LIMIT = BigInt(100)

    console.log(
      `Syncing transactions for ${connectedWallets.length} connected external wallets`,
    )

    for (const key of connectedWallets) {
      const w = wallets[key as keyof TExternalWalletsState]
      if (!w || typeof w !== 'object' || !('connected' in w) || !w.connected)
        continue

      try {
        console.log(`Syncing transactions for ${key} wallet`)
        let node: any

        if (key === 'lnd') {
          const l = w as any // TLndConnection
          node = new LndNode(
            LndConfig.create({
              url: l.url,
              macaroon: l.macaroon,
              socks5Proxy: l.socks5Proxy,
              acceptInvalidCerts: true,
              httpTimeout: BigInt(60),
            }),
          )
        } else if (key === 'cln') {
          node = new ClnNode(
            ClnConfig.create({
              url: (w as any).url,
              rune: (w as any).rune,
              socks5Proxy: (w as any).socks5Proxy,
              acceptInvalidCerts: true,
              httpTimeout: BigInt(60),
            }),
          )
        } else if (key === 'phoenixd') {
          node = new PhoenixdNode(
            PhoenixdConfig.create({
              url: (w as any).url,
              password: (w as any).password,
              socks5Proxy: (w as any).socks5Proxy,
              acceptInvalidCerts: true,
              httpTimeout: BigInt(60),
            }),
          )
        } else if (key === 'nwc') {
          node = new NwcNode(
            NwcConfig.create({
              nwcUri: (w as any).nwcUri,
              socks5Proxy: (w as any).socks5Proxy,
              httpTimeout: (w as any).httpTimeout
                ? BigInt((w as any).httpTimeout)
                : BigInt(60),
            }),
          )
        } else if (key === 'blink') {
          node = new BlinkNode(
            BlinkConfig.create({
              apiKey: (w as any).apiKey,
            }),
          )
        } else if (key === 'speed') {
          node = new SpeedNode(
            SpeedConfig.create({
              apiKey: (w as any).apiKey,
            }),
          )
        } else if (key === 'strike') {
          node = new StrikeNode(
            StrikeConfig.create({
              apiKey: (w as any).apiKey,
            }),
          )
        } else {
          console.log(`Skipping unsupported wallet type: ${key}`)
          continue // strike placeholder
        }

        if (node?.listTransactions) {
          const txns = await node.listTransactions({
            from: BigInt(0),
            limit: LIMIT,
            paymentHash: undefined,
          } as LniListTransactionsArgs)

          console.log('LNI list txns', txns)

          if (Array.isArray(txns)) {
            console.log(`Found ${txns.length} transactions for ${key}`)

            // Process transactions in smaller batches to avoid Redux performance issues
            const BATCH_SIZE = 50
            const batches: any[][] = []

            for (let i = 0; i < txns.length; i += BATCH_SIZE) {
              batches.push(txns.slice(i, i + BATCH_SIZE))
            }

            // Process each batch with a small delay to prevent overwhelming Redux
            for (
              let batchIndex = 0;
              batchIndex < batches.length;
              batchIndex++
            ) {
              const batch = batches[batchIndex]
              const batchActivity: IActivityItem[] = []
              const batchTags: { txId: string; tag: string }[] = []

              for (const tx of batch) {
                const mapped = mapLniTxToActivity(tx)
                if (mapped) {
                  // Add wallet-specific prefix to ensure unique IDs across different external wallets
                  mapped.id = `${key}-${mapped.id}`
                  batchActivity.push(mapped)
                  batchTags.push({
                    txId: mapped.id,
                    tag: key.toUpperCase(),
                  })
                }
              }

              // Add batch to main activity array
              activity.push(...batchActivity)

              // Batch tag all transactions from this batch in a single Redux action
              dispatch(batchAddMetaTxTags(batchTags))

              // Minimal delay between batches since we're now using efficient batch operations
              if (batches.length > 1 && batchIndex < batches.length - 1) {
                await new Promise((resolve) => setTimeout(resolve, 2))
              }
            }
          } else {
            console.log(`No transactions found for ${key}`)
          }
        } else {
          console.warn(`listTransactions method not available for ${key}`)
        }
      } catch (e) {
        console.warn(`Failed syncing external wallet ${key}:`, e)
      }
    }

    if (activity.length > 0) {
      console.log(
        `Adding ${activity.length} external wallet transactions to activity list`,
      )

      // Batch the activity update to reduce Redux middleware overhead
      dispatch(updateActivityItems(activity))
    } else {
      console.log('No new external wallet transactions to add')
    }
  } catch (error) {
    console.error('Error syncing external wallet transactions:', error)
  }
}

// Function to create a node instance for a given wallet type
export const createNodeInstance = (
  walletType: string,
  walletConfig: any,
): any => {
  switch (walletType) {
    case 'lnd':
      return new LndNode(
        LndConfig.create({
          url: walletConfig.url,
          macaroon: walletConfig.macaroon,
          socks5Proxy: walletConfig.socks5Proxy,
          acceptInvalidCerts: true,
          httpTimeout: BigInt(60),
        }),
      )
    case 'cln':
      return new ClnNode(
        ClnConfig.create({
          url: walletConfig.url,
          rune: walletConfig.rune,
          socks5Proxy: walletConfig.socks5Proxy,
          acceptInvalidCerts: true,
          httpTimeout: BigInt(60),
        }),
      )
    case 'phoenixd':
      return new PhoenixdNode(
        PhoenixdConfig.create({
          url: walletConfig.url,
          password: walletConfig.password,
          socks5Proxy: walletConfig.socks5Proxy,
          acceptInvalidCerts: true,
          httpTimeout: BigInt(60),
        }),
      )
    case 'nwc':
      return new NwcNode(
        NwcConfig.create({
          nwcUri: walletConfig.nwcUri,
          socks5Proxy: walletConfig.socks5Proxy,
          httpTimeout: walletConfig.httpTimeout
            ? BigInt(walletConfig.httpTimeout)
            : BigInt(60),
        }),
      )
    case 'blink':
      return new BlinkNode(
        BlinkConfig.create({
          apiKey: walletConfig.apiKey,
        }),
      )
    case 'speed':
      return new SpeedNode(
        SpeedConfig.create({
          apiKey: walletConfig.apiKey,
        }),
      )
    case 'strike':
      return new StrikeNode(
        StrikeConfig.create({
          apiKey: walletConfig.apiKey,
        }),
      )
    default:
      console.warn(`Unsupported wallet type: ${walletType}`)
      return null
  }
}

// Function to fetch getInfo from the default external wallet
export const fetchDefaultExternalWalletInfo = async (
  getState: () => RootState,
) => {
  try {
    const state = getState()
    const wallets: TExternalWalletsState = state.externalWallets
    const defaultWallet = wallets.defaultWallet

    if (!defaultWallet) {
      console.log('No default external wallet set')
      return
    }

    const walletConfig = wallets[defaultWallet]
    if (!walletConfig || !walletConfig.connected) {
      console.log(`Default wallet ${defaultWallet} is not connected`)
      return
    }

    console.log(`Fetching getInfo from default wallet: ${defaultWallet}`)

    const node = createNodeInstance(defaultWallet, walletConfig)
    if (!node || !node.getInfo) {
      console.warn(`getInfo not available for ${defaultWallet}`)
      return
    }

    if (node.getInfoAsync) {
      console.log('node.getInfoAsync fn', node.getInfoAsync)
      console.log('walletConfig', walletConfig)
      const info2 = await getInfoAsync(
        LndConfig.create({
          url: walletConfig.url,
          macaroon: walletConfig.macaroon,
          socks5Proxy: '',
          acceptInvalidCerts: true,
          httpTimeout: BigInt(60),
        }),
      )
      console.log('getInfoAsync result 2', info2)
    }

    const nodeInfo = await node.getInfo()
    console.log(`Node info for ${defaultWallet}:`, nodeInfo)

    // Create a serializable version of nodeInfo for Redux storage
    const serializableNodeInfo = {
      alias: nodeInfo.alias,
      pubkey: nodeInfo.pubkey,
      network: nodeInfo.network,
      blockHeight: nodeInfo.blockHeight ? Number(nodeInfo.blockHeight) : 0,
      blockHash: nodeInfo.blockHash,
      color: nodeInfo.color,
      nodeType: defaultWallet, // Store the node type (lnd, cln, phoenixd)
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
      pendingOpenSendBalanceSats: nodeInfo.pendingOpenSendBalance
        ? Number(nodeInfo.pendingOpenSendBalance / BigInt(1000))
        : 0,
      unsettledReceiveBalanceSats: nodeInfo.unsettledReceiveBalanceMsat
        ? Number(nodeInfo.unsettledReceiveBalanceMsat / BigInt(1000))
        : 0,
      unsettledSendBalanceSats: nodeInfo.unsettledSendBalanceMsat
        ? Number(nodeInfo.unsettledSendBalanceMsat / BigInt(1000))
        : 0,
    }

    // Update the external wallet state with the serialized node info
    dispatch(
      setExternalWalletStatus({
        type: defaultWallet,
        connected: true,
        lastNodeInfo: serializableNodeInfo,
      }),
    )

    // Log the balance information from the external wallet
    if (nodeInfo.sendBalanceMsat !== undefined) {
      const sendBalanceSats = Number(nodeInfo.sendBalanceMsat / BigInt(1000))
      console.log(
        `External wallet ${defaultWallet} send balance: ${sendBalanceSats} sats`,
      )
    }

    if (nodeInfo.receiveBalanceMsat !== undefined) {
      const receiveBalanceSats = Number(
        nodeInfo.receiveBalanceMsat / BigInt(1000),
      )
      console.log(
        `External wallet ${defaultWallet} receive balance: ${receiveBalanceSats} sats`,
      )
    }

    console.log(
      `External wallet ${defaultWallet} node info:`,
      serializableNodeInfo,
    )

    return nodeInfo
  } catch (error) {
    console.error('Error fetching default external wallet info:', error)

    // Update the external wallet state with error
    const state = getState()
    const defaultWallet = state.externalWallets.defaultWallet
    if (defaultWallet) {
      dispatch(
        setExternalWalletStatus({
          type: defaultWallet,
          connected: false,
          error: (error as Error).message,
        }),
      )
    }
  }
}

// Function to pay an invoice using the default external wallet
// Function to create an invoice using the default external wallet
export const createExternalWalletInvoice = async (
  getState: () => RootState,
  amountSats: number,
  description?: string,
  expiryDeltaSeconds?: number,
): Promise<{
  paymentRequest: string
  paymentHash: string
} | null> => {
  try {
    const state = getState()
    const wallets: TExternalWalletsState = state.externalWallets
    const defaultWallet = wallets.defaultWallet

    if (!defaultWallet) {
      console.log('No default external wallet set for invoice creation')
      return null
    }

    const walletConfig = wallets[defaultWallet]
    if (!walletConfig || !walletConfig.connected) {
      console.log(
        `Default wallet ${defaultWallet} is not connected for invoice creation`,
      )
      return null
    }

    console.log(
      `Creating invoice with default external wallet: ${defaultWallet}`,
    )

    const node = createNodeInstance(defaultWallet, walletConfig)
    if (!node || !node.createInvoice) {
      console.warn(`createInvoice not available for ${defaultWallet}`)
      return null
    }

    // Create CreateInvoiceParams following the Rust test pattern
    const createInvoiceParams: CreateInvoiceParams = {
      invoiceType: InvoiceType.Bolt11,
      amountMsats: amountSats ? BigInt(amountSats * 1000) : undefined,
      description: description || undefined,
      expiry: expiryDeltaSeconds ? BigInt(expiryDeltaSeconds) : BigInt(3600), // Default 1 hour
    }

    console.log('Creating invoice with params:', {
      amountSats,
      description,
      expiryDeltaSeconds,
    })

    console.log(`[TIMING] Starting invoice creation at: ${Date.now()}`)
    const response = await node.createInvoice(createInvoiceParams)
    console.log(`[TIMING] Invoice creation completed at: ${Date.now()}`)

    console.log(`Invoice created successfully with ${defaultWallet}:`, {
      invoice: `${response.invoice.substring(0, 20)}...`,
      paymentHash: response.paymentHash,
      type: response.type,
      description: response.description,
    })

    // Update the external wallet state to maintain connection
    dispatch(
      setExternalWalletStatus({
        type: defaultWallet,
        connected: true,
      }),
    )

    return {
      paymentRequest: response.invoice, // The Transaction struct uses 'invoice' field
      paymentHash: response.paymentHash,
    }
  } catch (error) {
    console.error('Error creating invoice with external wallet:', error)

    // Update the external wallet state with error
    const state = getState()
    const defaultWallet = state.externalWallets.defaultWallet
    if (defaultWallet) {
      dispatch(
        setExternalWalletStatus({
          type: defaultWallet,
          connected: false,
          error: (error as Error).message,
        }),
      )
    }

    return null
  }
}

export const payExternalWalletInvoice = async (
  getState: () => RootState,
  invoice: string,
  amountSats?: number,
): Promise<{
  paymentHash: string
  preimage?: string
  feeSats?: number
} | null> => {
  try {
    const state = getState()
    const wallets: TExternalWalletsState = state.externalWallets
    const defaultWallet = wallets.defaultWallet

    if (!defaultWallet) {
      console.log('No default external wallet set for payment')
      return null
    }

    const walletConfig = wallets[defaultWallet]
    if (!walletConfig || !walletConfig.connected) {
      console.log(
        `Default wallet ${defaultWallet} is not connected for payment`,
      )
      return null
    }

    console.log(`Paying invoice with default external wallet: ${defaultWallet}`)

    const node = createNodeInstance(defaultWallet, walletConfig)
    if (!node || !node.payInvoice) {
      console.warn(`payInvoice not available for ${defaultWallet}`)
      return null
    }

    // Create PayInvoiceParams - following the Rust test pattern
    const params: PayInvoiceParams = {
      invoice,
      amountMsats: amountSats ? BigInt(amountSats * 1000) : undefined,
    }

    console.log('Paying invoice with params:', {
      invoice: `${invoice.substring(0, 20)}...`,
      amountSats,
    })

    const response = await node.payInvoice(params)

    console.log(`Payment successful with ${defaultWallet}:`, {
      paymentHash: response.paymentHash,
      preimage: response.preimage,
      feeSats: response.feeMsats ? Number(response.feeMsats / BigInt(1000)) : 0,
    })

    // Update the external wallet state to maintain connection
    dispatch(
      setExternalWalletStatus({
        type: defaultWallet,
        connected: true,
      }),
    )

    return {
      paymentHash: response.paymentHash,
      preimage: response.preimage,
      feeSats: response.feeMsats ? Number(response.feeMsats / BigInt(1000)) : 0,
    }
  } catch (error) {
    console.error('Error paying invoice with external wallet:', error)

    // Update the external wallet state with error
    const state = getState()
    const defaultWallet = state.externalWallets.defaultWallet
    if (defaultWallet) {
      dispatch(
        setExternalWalletStatus({
          type: defaultWallet,
          connected: false,
          error: (error as Error).message,
        }),
      )
    }

    return null
  }
}
