# Dynamic — wallet integration

Seikine uses [Dynamic](https://dynamic.xyz) for wallet connection and session management across the app. Dynamic drives authentication and embedded-wallet creation; [wagmi](https://wagmi.sh) reflects the active account, bridged by Dynamic's wagmi connector. We migrated to Dynamic from a prior wallet provider during the build.

> The frontend lives in a separate private repo; the integration code below is the real, unmodified source, surfaced here for reference. The Dynamic environment ID is a public client-side identifier read from an env var (`VITE_DYNAMIC_ENVIRONMENT_ID`) — never hardcoded, never committed. No secrets are involved in the wallet layer.

## Provider stack

The nesting order is required and exact: `DynamicContextProvider → WagmiProvider → QueryClientProvider → DynamicWagmiConnector → app`. The `DynamicWagmiConnector` sits **inside** `WagmiProvider` + `QueryClientProvider` so it can bridge the active Dynamic session into wagmi's connector state — which makes `useAccount`, `useReadContract`, `useWriteContract`, etc. work uniformly whether the wallet is embedded or external (MetaMask, WalletConnect).

```jsx
// src/providers/Web3Provider.jsx
import { DynamicContextProvider } from '@dynamic-labs/sdk-react-core'
import { EthereumWalletConnectors } from '@dynamic-labs/ethereum'
import { DynamicWagmiConnector } from '@dynamic-labs/wagmi-connector'
import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { wagmiConfig } from '../config/wagmi'

const queryClient = new QueryClient()
const DYNAMIC_ENVIRONMENT_ID = import.meta.env.VITE_DYNAMIC_ENVIRONMENT_ID

export default function Web3Provider({ children }) {
  return (
    <DynamicContextProvider
      settings={{
        environmentId: DYNAMIC_ENVIRONMENT_ID,
        walletConnectors: [EthereumWalletConnectors],
      }}
    >
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          <DynamicWagmiConnector>{children}</DynamicWagmiConnector>
        </QueryClientProvider>
      </WagmiProvider>
    </DynamicContextProvider>
  )
}
```

(The real file also renders a friendly "missing environment ID" screen if the env var is unset, instead of a cryptic SDK error.)

## Connect / disconnect — `useDynamicContext`

The connect button uses Dynamic's hooks directly: `setShowAuthFlow(true)` opens Dynamic's auth modal (external or embedded wallet), `useIsLoggedIn()` tracks session state, `handleLogOut` disconnects, and `sdkHasLoaded` avoids a flash of the wrong state before the SDK is ready. The active address comes from wagmi's `useAccount()` — populated *because* the Dynamic session is bridged into the connector.

```jsx
// src/components/ConnectButton.jsx
import { useDynamicContext, useIsLoggedIn } from '@dynamic-labs/sdk-react-core'
import { useAccount } from 'wagmi'

export default function ConnectButton() {
  const { sdkHasLoaded, setShowAuthFlow, handleLogOut } = useDynamicContext()
  const authenticated = useIsLoggedIn()
  const { address } = useAccount()

  if (!sdkHasLoaded) return <button className="btn primary" disabled>…</button>

  if (authenticated) {
    return (
      <button className="btn primary" onClick={handleLogOut} title="Click to disconnect">
        {address ? shorten(address) : 'Connected'} ↓
      </button>
    )
  }
  return (
    <button className="btn primary" onClick={() => setShowAuthFlow(true)}>
      Connect wallet →
    </button>
  )
}
```

## Where it's used

`useDynamicContext` gates the wallet-dependent flows across the app — the connect button plus the **Stake**, **Positions**, and **Cross** pages each call `setShowAuthFlow` to prompt connection when an action needs a wallet. Dynamic is the single entry point for authentication; wagmi (via the connector) is how the rest of the app reads and writes on-chain with the connected account.

## Stack

`@dynamic-labs/sdk-react-core`, `@dynamic-labs/ethereum`, `@dynamic-labs/wagmi-connector`, wagmi, `@tanstack/react-query`, React/Vite. Live in the deployed app's "Connect wallet" flow.
