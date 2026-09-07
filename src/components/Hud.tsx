'use client';

import { useGame } from '@/game/store';

export function Hud() {
  const speed = useGame((s) => s.speed);
  const clock = useGame((s) => s.clock);
  const hh = Math.floor(clock) % 24;
  const mm = Math.floor((clock - Math.floor(clock)) * 60);
  const pad = (n: number) => (n < 10 ? '0' : '') + n;
  const h12 = ((hh + 11) % 12) + 1;
  const ap = hh >= 12 ? 'PM' : 'AM';

  return (
    <div className="hud">
      <div className="hud-speed">
        <div className="val">{speed}</div>
        <div className="cap">km/h</div>
      </div>
      <div className="gta-clock" aria-label="Hora del juego">
        <div className="gta-clock-time">{pad(h12)}:{pad(mm)}</div>
        <div className="gta-clock-ap">{ap}</div>
      </div>
    </div>
  );
}
