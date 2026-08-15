import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AptosWalletAdapterProvider } from '@aptos-labs/wallet-adapter-react'
import { ToastProvider } from './components/Toast'
import App from './App'
import './styles/global.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchInterval: 10000, // Auto-refetch every 10 seconds
      refetchIntervalInBackground: true,
      staleTime: 5000,
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AptosWalletAdapterProvider
        autoConnect={true}
        onError={() => {
          // Wallet errors are handled by the adapter
        }}
      >
        <ToastProvider>
          <App />
        </ToastProvider>
      </AptosWalletAdapterProvider>
    </QueryClientProvider>
  </React.StrictMode>,
)
