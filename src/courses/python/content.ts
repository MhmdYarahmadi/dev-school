import { commonBadges, type CourseContent } from '../../shared/course';
import { PYTHON_MODULES } from './content/index';
import { PYTHON_GAMES } from './games/registry';

/** Python course: data only, so the admin dashboard can import it. */
export const pythonContent: CourseContent = {
  id: 'python',
  title: 'پایتون',
  brand: ['python', 'school'],
  icon: '🐍',
  path: '/python/',
  heroTitle: 'پایتون را با انجام‌دادن یاد بگیر 🐍',
  heroText:
    'همین‌جا توی مرورگر کد پایتون می‌نویسی و **بلافاصله اجرا** می‌کنی — بدون نصب، بدون دردسر. کدت روی یک پایتونِ واقعی (CPython) اجرا می‌شود. هر درس چهار گام دارد: **یادگیری ← تمرین ← بازی ← آزمون**. اول حدس بزن، بعد اجرا کن و هر وقت گیر کردی راهنمایی بگیر.',
  modules: PYTHON_MODULES,
  games: PYTHON_GAMES,
  levels: [
    { xp: 0, title: 'تازه‌کار' },
    { xp: 100, title: 'چاپ‌کننده' },
    { xp: 300, title: 'متغیرباز' },
    { xp: 600, title: 'رشته‌شناس' },
    { xp: 1000, title: 'حلقه‌باز' },
    { xp: 1600, title: 'لیست‌دار' },
    { xp: 2400, title: 'تابع‌نویس' },
    { xp: 3400, title: 'برنامه‌نویس پایتون' },
  ],
  badges: [
    ...commonBadges(PYTHON_MODULES),
    { id: 'First Print', icon: '🖨️', name: 'اولین چاپ', how: 'اولین تمرین پایتون را حل کن', earned: (p) => Object.entries(p.exercises).some(([id, e]) => e.done && id.startsWith('p01')) },
    { id: 'Stringsmith', icon: '🧵', name: 'رشته‌شناس', how: 'آزمون رشته‌ها را قبول شو', earned: (p) => !!p.tests.p03?.passed },
    { id: 'Decider', icon: '🔀', name: 'تصمیم‌گیر', how: 'آزمون تصمیم‌گیری را قبول شو', earned: (p) => !!p.tests.p05?.passed },
    { id: 'Looper', icon: '🔁', name: 'حلقه‌باز', how: 'آزمون حلقه‌ها را قبول شو', earned: (p) => !!p.tests.p06?.passed },
    { id: 'Function Author', icon: '🧰', name: 'تابع‌نویس', how: 'آزمون توابع را قبول شو', earned: (p) => !!p.tests.p09?.passed },
  ],
  kindLabels: { write: 'کد را بنویس', fillBlank: 'جای خالی را پر کن', fixBug: 'اشکال را رفع کن', parsons: 'مرتب کن', readQuery: 'حدس بزن' },
};
