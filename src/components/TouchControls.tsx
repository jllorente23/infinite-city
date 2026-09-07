'use client';

import { useEffect, useRef } from 'react';
import { controls } from '@/game/store';

/**
 * Steering is an analogue slider and the pedals are separate elements, so a
 * thumb on each works. Every listener calls preventDefault to stop the browser
 * from turning a long press into a text selection.
 */
export function TouchControls() {
  const steer = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = steer.current!;
    const k = knob.current!;
    let id: number | null = null;
    let mouse = false;

    const setFromX = (clientX: number) => {
      const r = el.getBoundingClientRect();
      let v = ((clientX - r.left) / r.width - 0.5) * 2;
      v = Math.max(-1, Math.min(1, v));
      if (Math.abs(v) < 0.06) v = 0;
      controls.steer = -v;
      k.style.transform = `translateX(${v * (r.width / 2 - 50)}px)`;
    };
    const release = () => { id = null; mouse = false; controls.steer = 0; k.style.transform = 'translateX(0)'; };

    const ts = (e: TouchEvent) => { e.preventDefault(); if (id === null) { id = e.changedTouches[0].identifier; setFromX(e.changedTouches[0].clientX); } };
    const tm = (e: TouchEvent) => { e.preventDefault(); for (const t of Array.from(e.changedTouches)) if (t.identifier === id) setFromX(t.clientX); };
    const te = (e: TouchEvent) => { for (const t of Array.from(e.changedTouches)) if (t.identifier === id) release(); };
    const md = (e: MouseEvent) => { mouse = true; setFromX(e.clientX); };
    const mm = (e: MouseEvent) => { if (mouse) setFromX(e.clientX); };

    el.addEventListener('touchstart', ts, { passive: false });
    el.addEventListener('touchmove', tm, { passive: false });
    el.addEventListener('touchend', te);
    el.addEventListener('touchcancel', te);
    el.addEventListener('mousedown', md);
    window.addEventListener('mousemove', mm);
    window.addEventListener('mouseup', release);
    window.addEventListener('blur', release);
    return () => {
      controls.steer = 0;
      controls.throttle = 0;
      controls.brake = 0;
      el.removeEventListener('touchstart', ts);
      el.removeEventListener('touchmove', tm);
      el.removeEventListener('touchend', te);
      el.removeEventListener('touchcancel', te);
      el.removeEventListener('mousedown', md);
      window.removeEventListener('mousemove', mm);
      window.removeEventListener('mouseup', release);
      window.removeEventListener('blur', release);
    };
  }, []);

  useEffect(() => {
    const map: Record<string, 'l' | 'r' | 'g' | 'b'> = {
      ArrowLeft: 'l', a: 'l', A: 'l', ArrowRight: 'r', d: 'r', D: 'r',
      ArrowUp: 'g', w: 'g', W: 'g', ArrowDown: 'b', s: 'b', S: 'b'
    };
    const down = (e: KeyboardEvent) => {
      const k = map[e.key]; if (!k) return; e.preventDefault();
      if (k === 'l') controls.steer = 1;
      if (k === 'r') controls.steer = -1;
      if (k === 'g') controls.throttle = 1;
      if (k === 'b') controls.brake = 1;
    };
    const up = (e: KeyboardEvent) => {
      const k = map[e.key]; if (!k) return;
      if (k === 'l' || k === 'r') controls.steer = 0;
      if (k === 'g') controls.throttle = 0;
      if (k === 'b') controls.brake = 0;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  const pedal = (which: 'throttle' | 'brake') => ({
    onTouchStart: (e: React.TouchEvent) => { e.preventDefault(); controls[which] = 1; },
    onTouchEnd: (e: React.TouchEvent) => { e.preventDefault(); controls[which] = 0; },
    onTouchCancel: () => { controls[which] = 0; },
    onMouseDown: () => { controls[which] = 1; },
    onMouseUp: () => { controls[which] = 0; },
    onMouseLeave: () => { controls[which] = 0; },
    onContextMenu: (e: React.MouseEvent) => e.preventDefault()
  });

  return (
    <div className="controls">
      <div className="steer" ref={steer}>
        <div className="knob" ref={knob} />
      </div>
      <div className="pedals">
        <button className="pedal brake" {...pedal('brake')}>Freno</button>
        <button className="pedal gas" {...pedal('throttle')}>Gas</button>
      </div>
    </div>
  );
}
