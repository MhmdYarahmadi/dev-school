import React from 'react';
import ReactDOM from 'react-dom/client';
import { ErrorBoundary } from '../components/ErrorBoundary';
import AdminPage from '../pages/AdminPage';
import '../styles.css';

// The admin dashboard: one page for every course. No course is "current" here.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <main className="page">
      <ErrorBoundary>
        <AdminPage />
      </ErrorBoundary>
    </main>
  </React.StrictMode>,
);
