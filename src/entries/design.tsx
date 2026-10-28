import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { setCourse } from '../shared/course';
import { configureProgress } from '../progress/store';
import { configureSync } from '../account/api';
import { sdCourse } from '../courses/sd/course';
import { registerOffline } from '../shared/offline';
import App from '../App';
import '../styles.css';

// Must run before the app renders: selects the course, its saved progress and its sync target.
setCourse(sdCourse);
configureProgress('zs-progress-sd-v1');
configureSync('sd');

registerOffline();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
);
