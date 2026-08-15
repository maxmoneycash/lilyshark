import { useState, useRef, useEffect, memo } from 'react';
import { useWallet } from '@aptos-labs/wallet-adapter-react';

interface WalletButtonProps {
  variant?: 'header' | 'tab'; // 'tab' for mobile bottom nav style
}

const WalletButtonComponent = ({ variant = 'header' }: WalletButtonProps) => {
  const { connected, account, connect, disconnect, wallets } = useWallet();
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const shortenAddress = (address: string) => {
    if (address.length <= 12) return address;
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
  };

  const installedWallets = wallets?.filter(w => w.readyState === 'Installed') || [];

  // Tab variant - styled like other tab buttons (for mobile)
  if (variant === 'tab') {
    return (
      <div ref={dropdownRef} style={{ position: 'relative', display: 'flex' }}>
        <button
          onClick={() => setShowDropdown(!showDropdown)}
          className={connected ? 'active' : ''}
          style={{
            background: 'none',
            border: 'none',
            borderLeft: '1px solid var(--background2)',
            color: connected ? 'var(--accent)' : 'var(--foreground2)',
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontSize: '0.85rem',
            padding: '0.5rem 0.75rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.25rem',
            minHeight: '48px',
            whiteSpace: 'nowrap',
          }}
        >
          {connected ? (
            <>
              <span style={{ color: 'var(--success)', fontSize: '0.5rem' }}>●</span>
              {shortenAddress(account?.address?.toString() || '')}
            </>
          ) : (
            'Connect'
          )}
        </button>

        {showDropdown && (
          <div style={{
            position: 'absolute',
            bottom: '100%',
            right: 0,
            marginBottom: '0.5rem',
            background: 'var(--background0)',
            border: '1px solid var(--background2)',
            padding: '0.75rem',
            minWidth: '220px',
            zIndex: 1000,
          }}>
            {connected && account?.address ? (
              <>
                <div style={{
                  padding: '0.5rem',
                  marginBottom: '0.5rem',
                  background: 'var(--background1)',
                }}>
                  <small style={{ color: 'var(--foreground2)', fontSize: '0.65rem' }}>Connected</small>
                  <div style={{
                    fontFamily: 'monospace',
                    fontSize: '0.65rem',
                    wordBreak: 'break-all',
                    color: 'var(--foreground0)',
                    marginTop: '0.25rem',
                  }}>
                    {account.address.toString()}
                  </div>
                </div>
                <button
                  is-="button"
                  variant-="foreground2"
                  box-="square"
                  onClick={() => {
                    disconnect();
                    setShowDropdown(false);
                  }}
                  style={{ width: '100%' }}
                >
                  Disconnect
                </button>
              </>
            ) : (
              <>
                <small style={{
                  color: 'var(--foreground2)',
                  fontSize: '0.7rem',
                  display: 'block',
                  marginBottom: '0.5rem',
                }}>
                  Connect Wallet
                </small>
                {installedWallets.length > 0 ? (
                  <column gap-="0.5">
                    {installedWallets.map((wallet) => (
                      <button
                        key={wallet.name}
                        is-="button"
                        variant-="background3"
                        onClick={() => {
                          connect(wallet.name);
                          setShowDropdown(false);
                        }}
                        style={{
                          width: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.5rem',
                          justifyContent: 'flex-start',
                          padding: '0.5rem 1rem',
                        }}
                      >
                        {wallet.icon && (
                          <img src={wallet.icon} alt="" style={{ width: 18, height: 18 }} />
                        )}
                        {wallet.name}
                      </button>
                    ))}
                  </column>
                ) : (
                  <div style={{
                    padding: '0.75rem',
                    background: 'var(--background1)',
                    fontSize: '0.75rem',
                    color: 'var(--foreground2)',
                    textAlign: 'center',
                  }}>
                    No Aptos wallet found.
                    <br />
                    <a href="https://petra.app" target="_blank" rel="noopener noreferrer">
                      Install Petra
                    </a>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  // Header variant - for desktop, uses WebTUI button styles
  return (
    <div ref={dropdownRef} style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
      <button
        is-="button"
        variant-="background3"
        size-="small"
        onClick={() => setShowDropdown(!showDropdown)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.4rem',
          padding: '0 1.5ch',
        }}
      >
        {connected && account?.address ? (
          <>
            <span style={{ color: 'var(--success)', fontSize: '0.6rem' }}>●</span>
            {shortenAddress(account.address.toString())}
          </>
        ) : (
          'Connect'
        )}
      </button>

      {showDropdown && (
        <div style={{
          position: 'absolute',
          top: '100%',
          right: 0,
          marginTop: '0.5rem',
          background: 'var(--background0)',
          border: '1px solid var(--background2)',
          padding: '0.75rem',
          minWidth: '220px',
          zIndex: 1000,
        }}>
          {connected && account?.address ? (
            <>
              <div style={{
                padding: '0.5rem',
                marginBottom: '0.5rem',
                background: 'var(--background1)',
              }}>
                <small style={{ color: 'var(--foreground2)', fontSize: '0.65rem' }}>Connected</small>
                <div style={{
                  fontFamily: 'monospace',
                  fontSize: '0.65rem',
                  wordBreak: 'break-all',
                  color: 'var(--foreground0)',
                  marginTop: '0.25rem',
                }}>
                  {account.address.toString()}
                </div>
              </div>
              <button
                is-="button"
                variant-="foreground2"
                box-="square"
                onClick={() => {
                  disconnect();
                  setShowDropdown(false);
                }}
                style={{ width: '100%' }}
              >
                Disconnect
              </button>
            </>
          ) : (
            <>
              <small style={{
                color: 'var(--foreground2)',
                fontSize: '0.7rem',
                display: 'block',
                marginBottom: '0.5rem',
              }}>
                Connect Wallet
              </small>
              {installedWallets.length > 0 ? (
                <column gap-="0.5">
                  {installedWallets.map((wallet) => (
                    <button
                      key={wallet.name}
                      is-="button"
                      variant-="background3"
                      onClick={() => {
                        connect(wallet.name);
                        setShowDropdown(false);
                      }}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        justifyContent: 'flex-start',
                        padding: '0.5rem 1rem',
                      }}
                    >
                      {wallet.icon && (
                        <img src={wallet.icon} alt="" style={{ width: 18, height: 18 }} />
                      )}
                      {wallet.name}
                    </button>
                  ))}
                </column>
              ) : (
                <div style={{
                  padding: '0.75rem',
                  background: 'var(--background1)',
                  fontSize: '0.75rem',
                  color: 'var(--foreground2)',
                  textAlign: 'center',
                }}>
                  No Aptos wallet found.
                  <br />
                  <a href="https://petra.app" target="_blank" rel="noopener noreferrer">
                    Install Petra
                  </a>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export const WalletButton = memo(WalletButtonComponent);
