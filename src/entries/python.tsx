import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { setCourse } from '../shared/course';
import { configureProgress } from '../progress/store';
import { configureSync } from '../account/api';
import { pythonCourse } from '../courses/python/course';
import { registerOffline } from '../shared/offline';
import App from '../App';
import '../styles.css';

// Must run before the app renders: selects the course, its saved progress and its sync target.
setCourse(pythonCourse);
configureProgress('zs-progress-python-v1');
configureSync('python');

// This course is in Persian. RTL is scoped to this SPA only (each course is its own
// entry), so the English courses are untouched. Python code is kept LTR via styles.css.
document.documentElement.lang = 'fa';
document.documentElement.dir = 'rtl';

registerOffline();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
);
