import { useState, useEffect, useCallback, memo, createContext, useContext, ReactNode } from 'react';

interface Toast {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  message: string;
  txHash?: string;
  duration?: number;
}

interface ToastContextValue {
  showToast: (toast: Omit<Toast, 'id'>) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};

const SHELBY_EXPLORER_URL = 'https://explorer.aptoslabs.com/txn';

const ToastItem = memo(({ toast, onClose }: { toast: Toast; onClose: () => void }) => {
  useEffect(() => {
    const timer = setTimeout(onClose, toast.duration || 5000);
    return () => clearTimeout(timer);
  }, [toast.duration, onClose]);

  const getTypeStyles = () => {
    switch (toast.type) {
      case 'success':
        return { borderColor: 'var(--success)', icon: '✓' };
      case 'error':
        return { borderColor: 'var(--red)', icon: '✗' };
      case 'warning':
        return { borderColor: 'var(--yellow)', icon: '!' };
      case 'info':
      default:
        return { borderColor: 'var(--blue)', icon: 'i' };
    }
  };

  const styles = getTypeStyles();

  return (
    <div
      style={{
        background: 'var(--background0)',
        border: `1px solid ${styles.borderColor}`,
        padding: '0.75rem 1rem',
        marginBottom: '0.5rem',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '0.75rem',
        maxWidth: '350px',
        animation: 'slideIn 0.2s ease-out',
      }}
    >
      <span style={{
        color: styles.borderColor,
        fontWeight: 'bold',
        fontSize: '0.9rem',
      }}>
        [{styles.icon}]
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: '0.8rem',
          color: 'var(--foreground0)',
          wordBreak: 'break-word',
        }}>
          {toast.message}
        </div>
        {toast.txHash && (
          <a
            href={`${SHELBY_EXPLORER_URL}/${toast.txHash}?network=shelbynet`}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: '0.7rem',
              color: 'var(--accent)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.25rem',
              marginTop: '0.25rem',
            }}
          >
            View on Explorer →
          </a>
        )}
      </div>
      <button
        onClick={onClose}
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--foreground2)',
          cursor: 'pointer',
          padding: '0',
          fontSize: '0.8rem',
          lineHeight: 1,
        }}
      >
        ×
      </button>
    </div>
  );
});

ToastItem.displayName = 'ToastItem';

export const ToastProvider = memo(({ children }: { children: ReactNode }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    setToasts((prev) => [...prev, { ...toast, id }]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {/* Toast container */}
      <div
        style={{
          position: 'fixed',
          top: '1rem',
          right: '1rem',
          zIndex: 9999,
          pointerEvents: 'none',
        }}
      >
        <div style={{ pointerEvents: 'auto' }}>
          {toasts.map((toast) => (
            <ToastItem
              key={toast.id}
              toast={toast}
              onClose={() => removeToast(toast.id)}
            />
          ))}
        </div>
      </div>
      <style>{`
        @keyframes slideIn {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
      `}</style>
    </ToastContext.Provider>
  );
});

ToastProvider.displayName = 'ToastProvider';
