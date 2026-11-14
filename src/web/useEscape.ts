import { useEffect, useRef } from 'react';

/** Cierra paneles y ventanas con la tecla Esc (el último abierto primero). */
const stack: { current: () => void }[] = [];
let bound = false;
export function useEscape(onClose: () => void) {
  const ref = useRef(onClose);
  ref.current = onClose;
  useEffect(() => {
    stack.push(ref);
    if (!bound) {
      bound = true;
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && stack.length && !e.defaultPrevented) { e.preventDefault(); stack[stack.length - 1].current(); }
      });
    }
    return () => { const i = stack.lastIndexOf(ref); if (i >= 0) stack.splice(i, 1); };
  }, []);
}
