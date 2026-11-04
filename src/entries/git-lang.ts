/**
 * Imported first by the Git entry, so every module sees the chosen language when it loads
 * (mission texts are translated as they're defined). Farsi pages run right to left.
 */
import { initLang, setTable, t } from '../shared/i18n';
import ui from '../i18n/ui.fa.json';

if (initLang('git') === 'fa') {
  setTable(ui);
  document.documentElement.lang = 'fa';
  document.documentElement.dir = 'rtl';
  document.title = t('Git School: learn Git');
}
