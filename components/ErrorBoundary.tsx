
import React, { ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<any, any> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    const { children } = (this as any).props;
    if ((this as any).state.hasError) {
      let errorMessage = 'An unexpected error occurred.';
      let errorDetails = '';

      try {
        if (this.state.error) {
          const parsedError = JSON.parse(this.state.error.message);
          if (parsedError.error && parsedError.operationType) {
            errorMessage = `Firestore ${parsedError.operationType} error: ${parsedError.error}`;
            errorDetails = `Path: ${parsedError.path || 'N/A'}`;
          }
        }
      } catch (e) {
        errorMessage = this.state.error?.message || errorMessage;
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-brand-background p-6">
          <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 border border-brand-divider/20 text-center space-y-6">
            <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto text-red-500 text-2xl">
              <i className="fa-solid fa-triangle-exclamation"></i>
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-bold text-brand-primary">Something went wrong</h2>
              <p className="text-slate-600">{errorMessage}</p>
              {errorDetails && <p className="text-xs text-slate-400 font-mono">{errorDetails}</p>}
            </div>
            <button
              onClick={() => window.location.reload()}
              className="w-full py-3 bg-brand-primary text-white rounded-lg font-semibold hover:opacity-90 transition-all"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return children;
  }
}
