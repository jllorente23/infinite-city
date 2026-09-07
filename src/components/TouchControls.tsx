'use client';

import { useEffect, useRef, useState } from 'react';
import { controls } from '@/game/store';

function useKeyboard() {
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
}

/**
 * Keyboard always lives here. The joystick and pedals only mount on a real
 * touch screen — on desktop they just cover the view.
 */
export function TouchControls() {
  useKeyboard();
  const [touch, setTouch] = useState(false);
  useEffect(() => {
    setTouch('ontouchstart' in window || navigator.maxTouchPoints > 0);
  }, []);
  if (!touch) return null;
  return <TouchPad />;
}

function TouchPad() {
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

    el.addEventListener('touchstart', ts, { passive: false });
    el.addEventListener('touchmove', tm, { passive: false });
    el.addEventListener('touchend', te);
    el.addEventListener('touchcancel', te);
    window.addEventListener('blur', release);
    return () => {
      controls.steer = 0;
      controls.throttle = 0;
      controls.brake = 0;
      el.removeEventListener('touchstart', ts);
      el.removeEventListener('touchmove', tm);
      el.removeEventListener('touchend', te);
      el.removeEventListener('touchcancel', te);
      window.removeEventListener('blur', release);
    };
  }, []);

  const pedal = (which: 'throttle' | 'brake') => ({
    onTouchStart: (e: React.TouchEvent) => { e.preventDefault(); controls[which] = 1; },
    onTouchEnd: (e: React.TouchEvent) => { e.preventDefault(); controls[which] = 0; },
    onTouchCancel: () => { controls[which] = 0; },
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
