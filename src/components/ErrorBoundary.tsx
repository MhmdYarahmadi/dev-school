import { Component, type ReactNode } from 'react';

/** Keeps one broken page from blanking the whole app. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    // After a deploy, an open tab asks for code files that no longer exist: reload once to get the new ones.
    if (/dynamically imported module|Importing a module script failed|error loading dynamically imported/i.test(error.message)) {
      try {
        if (sessionStorage.getItem('chunk-reload') !== location.href) {
          sessionStorage.setItem('chunk-reload', location.href);
          location.reload();
        }
      } catch {
        /* storage unavailable: keep the "Try again" message */
      }
    }
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="callout bad">
        <p><b>Something went wrong on this page.</b> Your progress is safe.</p>
        <pre className="small">{this.state.error.message}</pre>
        <button className="btn small" onClick={() => this.setState({ error: null })}>Try again</button>
      </div>
    );
  }
}
