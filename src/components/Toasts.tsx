import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { onToast } from '../progress/store';

export function Toasts() {
  const [items, setItems] = useState<{ id: number; msg: string }[]>([]);
  useEffect(
    () =>
      onToast((msg) => {
        const id = Math.random();
        setItems((xs) => [...xs.slice(-3), { id, msg }]);
        setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 2800);
      }),
    [],
  );
  return (
    <div className="toasts" aria-live="polite">
      <AnimatePresence>
        {items.map((t) => (
          <motion.div key={t.id} className="toast" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 40 }}>
            {t.msg}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
