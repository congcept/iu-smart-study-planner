import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Card, Button } from '@components/ui';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <Card title="Something went wrong">
          <div className="text-center py-8">
            <p className="text-gray-600 mb-4">An unexpected error occurred. Please try again.</p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button
                variant="primary"
                onClick={() => this.setState({ hasError: false, error: null })}
              >
                Try Again
              </Button>
              {/* Retrying re-renders the same tree, so an error that depends on
                  the current state reappears immediately. A reload is the only
                  way out that always works. */}
              <Button variant="secondary" onClick={() => window.location.reload()}>
                Reload the page
              </Button>
            </div>
          </div>
        </Card>
      );
    }

    return this.props.children;
  }
}
