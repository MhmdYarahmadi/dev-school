// First, before any module that translates text when it loads: this course is only in Persian,
// so the shared interface (menus, buttons, review, tests) uses the Farsi table.
import './python-lang';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { setCourse } from '../shared/course';
import { isolateContent } from '../shared/i18n';
import { configureProgress } from '../progress/store';
import { configureSync } from '../account/api';
import { pythonCourse } from '../courses/python/course';
import { registerOffline } from '../shared/offline';
import App from '../App';
import '../styles.css';
import '@fontsource-variable/vazirmatn';

// Must run before the app renders: selects the course, its saved progress and its sync target.
// Code in this course is English inside Persian lessons: keep each English piece in its own order.
isolateContent(pythonCourse);
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
