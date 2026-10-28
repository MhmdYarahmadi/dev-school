import type { GameMeta } from '../../../shared/course';

/** Python course games. */
export const PYTHON_GAMES: Record<string, GameMeta> = {
  outputPredictor: {
    id: 'outputPredictor',
    title: 'حدس خروجی',
    icon: '🎯',
    moduleId: 'p01',
    pitch: 'یک قطعه کد نشان داده می‌شود؛ قبل از اجرا حدس بزن چه چیزی چاپ می‌شود. سریع باش و رفلکسِ «اول حدس بزن، بعد اجرا کن» را تقویت کن.',
    skills: 'print, عملگرها, رشته‌ها, حدس خروجی',
  },
};
