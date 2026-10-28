import './git-lang';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { setCourse } from '../shared/course';
import { applyContentTable, lang } from '../shared/i18n';
import faContent from '../i18n/git.fa.json';
import { configureProgress } from '../progress/store';
import { configureSync } from '../account/api';
import { gitCourse } from '../courses/git/course';
import { registerOffline } from '../shared/offline';
import App from '../App';
import '../styles.css';

// Must run before the app renders: selects the course (in the chosen language), its saved progress and its sync target.
if (lang() === 'fa') applyContentTable(gitCourse, faContent);
setCourse(gitCourse);
configureProgress('zs-progress-git-v1');
configureSync('git');

registerOffline();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
);
