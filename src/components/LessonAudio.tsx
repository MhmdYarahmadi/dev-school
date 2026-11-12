import { useEffect, useRef, useState } from 'react';
import { t } from '../shared/i18n';

const SPEEDS = [1, 1.25, 1.5];
const SPEED_KEY = 'zs-audio-speed';

function savedSpeed(): number {
  try {
    const v = Number(localStorage.getItem(SPEED_KEY));
    return SPEEDS.includes(v) ? v : 1;
  } catch {
    return 1;
  }
}

/**
 * A recorded voiceover for a lesson. Nothing is downloaded until the learner presses Listen; then
 * the whole file is fetched (the service worker keeps it, so it plays offline afterwards) and played
 * from memory, which also makes seeking work offline without range requests.
 */
export function LessonAudio({ src }: { src: string }) {
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [url, setUrl] = useState('');
  const [speed, setSpeed] = useState(savedSpeed);
  const audio = useRef<HTMLAudioElement>(null);

  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  useEffect(() => {
    if (audio.current) audio.current.playbackRate = speed;
  }, [speed, state]);

  const load = async () => {
    setState('loading');
    try {
      const res = await fetch(src);
      if (!res.ok) throw new Error(String(res.status));
      setUrl(URL.createObjectURL(new Blob([await res.arrayBuffer()], { type: 'audio/mp4' })));
      setState('ready');
    } catch {
      setState('error');
    }
  };

  const nextSpeed = () => {
    const s = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    setSpeed(s);
    try {
      localStorage.setItem(SPEED_KEY, String(s));
    } catch {
      // private mode: the speed only lasts for this page
    }
  };

  if (state !== 'ready') {
    return (
      <div className="lesson-audio row">
        <button className="btn" onClick={load} disabled={state === 'loading'}>
          🔊 {state === 'loading' ? t('Loading…') : t('Listen to this lesson')}
        </button>
        {state === 'error' && <span className="small muted">{t('The recording could not be loaded. Check your connection and try again.')}</span>}
      </div>
    );
  }
  return (
    <div className="lesson-audio row" dir="ltr">
      <audio ref={audio} src={url} controls autoPlay className="grow" />
      <button className="btn" onClick={nextSpeed} title={t('Playback speed')}>
        {speed}×
      </button>
    </div>
  );
}
