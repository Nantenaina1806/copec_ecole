import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary a intercepté une erreur :', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
          <div className="card max-w-md text-center">
            <h1 className="text-lg font-semibold text-slate-900 mb-2">Une erreur est survenue</h1>
            <p className="text-sm text-slate-500 mb-4">
              Quelque chose s&apos;est mal passé lors de l&apos;affichage de cette page.
            </p>
            <button className="btn-primary" onClick={() => window.location.reload()}>
              Recharger la page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
