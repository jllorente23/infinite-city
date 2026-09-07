'use client';

import { Canvas } from '@react-three/fiber';
import { Physics } from '@react-three/rapier';
import { Suspense, useState } from 'react';
import * as THREE from 'three';
import { City } from '@/game/City';
import { Car } from '@/game/Car';
import { Traffic } from '@/game/Traffic';
import { DayNight } from '@/game/DayNight';
import { qualityOf, useGame } from '@/game/store';
import { Hud } from './Hud';
import { TouchControls } from './TouchControls';

export default function Game() {
  const quality = useGame((s) => s.quality);
  const setQuality = useGame((s) => s.setQuality);
  const setSeed = useGame((s) => s.setSeed);
  const seed = useGame((s) => s.seed);
  const q = qualityOf(quality);
  const [panel, setPanel] = useState(false);
  const [draft, setDraft] = useState(String(seed));

  return (
    <div className="stage">
      <Canvas
        shadows={q.shadows}
        dpr={[1, q.dpr]}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        camera={{ fov: 64, near: 0.5, far: (q.loadRadius + 2) * 50 }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.05;
        }}
      >
        <Suspense fallback={null}>
          <Physics timeStep={1 / 60} gravity={[0, -19.6, 0]}>
            <DayNight />
            <City />
            <Car />
            <Traffic />
          </Physics>
        </Suspense>
      </Canvas>

      <Hud />
      <TouchControls />

      <button className="gear" onClick={() => setPanel((p) => !p)} aria-label="Opciones">
        &#9881;
      </button>
      {panel && (
        <div className="panel">
          <label htmlFor="seed">Semilla</label>
          <input id="seed" type="number" value={draft} onChange={(e) => setDraft(e.target.value)} />
          <button onClick={() => { setSeed(parseInt(draft, 10) || 0); setPanel(false); }}>Generar ciudad</button>
          <button onClick={() => setQuality(quality === 'high' ? 'low' : 'high')}>
            Gráficos: {quality === 'high' ? 'alto' : 'bajo'}
          </button>
          <p>
            La ciudad se construye por manzanas alrededor del carro y se descarta lo que queda lejos.
            La misma semilla siempre reconstruye la misma ciudad.
          </p>
        </div>
      )}
    </div>
  );
}
