
import React, { Component, ErrorInfo, ReactNode } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { FirebaseProvider } from './components/FirebaseProvider';
import { DemoWorkspaceProvider } from './lib/demoStateManager';

interface ErrorProps {
  children: ReactNode;
}

interface ErrorState {
  hasError: boolean;
  error: Error | null;
}

class AppErrorBoundary extends Component<any, any> {
  constructor(props: any) {
    super(props);
    (this as any).state = {
      hasError: false,
      error: null
    };
  }

  public static getDerivedStateFromError(error: Error) {
    const errorId = Math.random().toString(36).substring(2, 8).toUpperCase();
    return { hasError: true, error, errorId };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const errorId = (this as any).state?.errorId || 'UNKNOWN';
    console.error(`[AppErrorBoundary Error ID: ${errorId}]:`, error, errorInfo);
  }

  public render() {
    if ((this as any).state.hasError) {
      let errorMessage = "We've encountered an unexpected issue. Our team has been notified.";
      let isFirestoreError = false;
      const errorId = (this as any).state.errorId || 'ERR';

      try {
        if ((this as any).state.error?.message) {
          const parsed = JSON.parse((this as any).state.error.message);
          if (parsed.error && parsed.operationType) {
            isFirestoreError = true;
            errorMessage = `Security Policy Violation: You don't have permission to ${parsed.operationType} this resource.`;
            if (parsed.path) {
              errorMessage += ` (Path: ${parsed.path})`;
            }
          }
        }
      } catch (e) {
        // Not a JSON error message
      }

      return (
        <div className="min-h-screen bg-brand-background flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white rounded-2xl shadow-2xl border border-brand-divider/20 p-10 text-center space-y-6 animate-in zoom-in-95">
            <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mx-auto text-red-500">
              <i className={`fa-solid ${isFirestoreError ? 'fa-shield-halved' : 'fa-triangle-exclamation'} text-3xl`}></i>
            </div>
            
            <div className="space-y-2">
              <h2 className="text-2xl font-bold text-brand-primary">
                {isFirestoreError ? "Access Restricted" : "Something went wrong"}
              </h2>
              <p className="text-slate-500 text-sm leading-relaxed">
                {errorMessage}
              </p>
            </div>

            <div className="pt-4">
              <button
                onClick={() => window.location.reload()}
                className="w-full py-4 bg-brand-primary text-white rounded-xl font-bold uppercase tracking-widest text-[11px] shadow-lg shadow-brand-primary/20 hover:scale-[1.02] active:scale-95 transition-all"
              >
                Refresh Application
              </button>
            </div>

            <p className="text-[10px] text-slate-400 font-medium uppercase tracking-widest">
              Error ID: {errorId}
            </p>
          </div>
        </div>
      );
    }

    return (this as any).props.children;
  }
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <AppErrorBoundary>
      <FirebaseProvider>
        <DemoWorkspaceProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </DemoWorkspaceProvider>
      </FirebaseProvider>
    </AppErrorBoundary>
  </React.StrictMode>
);
