'use client';

import { useGame } from '@/game/store';

export function Hud() {
  const speed = useGame((s) => s.speed);
  const clock = useGame((s) => s.clock);
  const hh = Math.floor(clock);
  const mm = Math.floor((clock - hh) * 60);
  const pad = (n: number) => (n < 10 ? '0' : '') + n;

  return (
    <div className="hud">
      <div>
        <div className="val">{speed}</div>
        <div className="cap">km/h</div>
        <div className="cap">{pad(hh)}:{pad(mm)}</div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div className="cap">semilla</div>
        <div className="val" style={{ fontSize: 20 }}>{useGame.getState().seed}</div>
      </div>
    </div>
  );
}
