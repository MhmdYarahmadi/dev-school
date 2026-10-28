import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { setCourse } from '../shared/course';
import { configureProgress } from '../progress/store';
import { configureSync } from '../account/api';
import { pgCourse } from '../courses/pg/course';
import { registerOffline } from '../shared/offline';
import App from '../App';
import '../styles.css';

// Must run before the app renders: selects the course, its saved progress and its sync target.
setCourse(pgCourse);
configureProgress('pgschool-progress-v1');
configureSync('pg');

registerOffline();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
);
