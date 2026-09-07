'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { CuboidCollider, RigidBody, TrimeshCollider } from '@react-three/rapier';
import { CELL } from './config';
import { ChunkData, ensureFacades, generateChunk } from './city';
import { playerPos, qualityOf, useGame } from './store';
import { setTerrainSeed } from './rng';
import { useCityProps } from './props';
import { useCityNature } from './nature';
import { useCityBuildings } from './buildings';
import { useCityCars } from './carModels';
import { signalState } from './signals';

type Slot = { key: string; i: number; j: number; lod: number };

/** Which cells should exist around the player, and at what level of detail. */
function wantedSlots(ci: number, cj: number, loadRadius: number, detailRadius: number, midRadius: number) {
  const out: Slot[] = [];
  for (let i = ci - loadRadius; i <= ci + loadRadius; i++) {
    for (let j = cj - loadRadius; j <= cj + loadRadius; j++) {
      const d = Math.max(Math.abs(i - ci), Math.abs(j - cj));
      const lod = d <= detailRadius ? 2 : d <= midRadius ? 1 : 0;
      out.push({ key: `${i},${j}`, i, j, lod });
    }
  }
  out.sort((a, b) => b.lod - a.lod);
  return out;
}

export function City() {
  const seed = useGame((s) => s.seed);
  const quality = useGame((s) => s.quality);
  const q = qualityOf(quality);

  // Chunks are generated synchronously during render. The seed must therefore
  // be active before the initial state creates them; doing this in an effect
  // left the first terrain mesh on the previous phase while vehicle physics
  // queried the new one.
  setTerrainSeed(seed);

  // Suspends until the lamp, signal and nature models are in, so the first
  // chunks that generate already have them and no block is left with placeholders.
  useCityProps();
  useCityNature();
  useCityBuildings();
  useCityCars();

  const [cells, setCells] = useState<Slot[]>(() =>
    wantedSlots(0, 0, q.loadRadius, q.detailRadius, q.midRadius)
  );
  const center = useRef({ i: 0, j: 0 });
  const setBooting = useGame((s) => s.setBooting);

  useEffect(() => {
    ensureFacades();
    const ci = Math.floor(playerPos.x / CELL);
    const cj = Math.floor(playerPos.z / CELL);
    center.current = { i: ci, j: cj };
    setCells(wantedSlots(ci, cj, q.loadRadius, q.detailRadius, q.midRadius));
  }, [seed, quality, q.loadRadius, q.detailRadius, q.midRadius]);

  useLayoutEffect(() => {
    const id = requestAnimationFrame(() => setBooting(false));
    return () => cancelAnimationFrame(id);
  }, [seed, quality, setBooting]);

  useFrame(() => {
    const ci = Math.floor(playerPos.x / CELL);
    const cj = Math.floor(playerPos.z / CELL);
    if (ci === center.current.i && cj === center.current.j) return;
    center.current = { i: ci, j: cj };
    setCells(wantedSlots(ci, cj, q.loadRadius, q.detailRadius, q.midRadius));
  });

  return (
    <group>
      {cells.map((c) => (
        <Chunk key={`${c.key}:${c.lod}:${seed}`} seed={seed} i={c.i} j={c.j} lod={c.lod} />
      ))}
    </group>
  );
}

function Chunk({ seed, i, j, lod }: { seed: number; i: number; j: number; lod: number }) {
  const data = useMemo<ChunkData>(() => generateChunk(seed, i, j, lod), [seed, i, j, lod]);

  useEffect(() => () => data.dispose(), [data]);

  const tri = useMemo(() => {
    if (lod !== 2 || !data.ground) return null;
    const pos = data.ground.attributes.position.array as Float32Array;
    const idx = data.ground.index!.array as ArrayLike<number>;
    return { vertices: new Float32Array(pos), indices: new Uint32Array(Array.from(idx)) };
  }, [data, lod]);

  useSignalLights(data, seed, lod === 2);

  return (
    <>
      <primitive object={data.group} />
      {lod === 2 && (
        <RigidBody type="fixed" colliders={false} friction={1}>
          {tri && <TrimeshCollider args={[tri.vertices, tri.indices]} />}
          {data.boxes.map((b, k) => (
            <CuboidCollider key={k} args={b.half} position={b.pos} />
          ))}
        </RigidBody>
      )}
    </>
  );
}

/** Traffic lights are pure display here: the timing function is the source of truth. */
function useSignalLights(data: ChunkData, seed: number, active: boolean) {
  const acc = useRef(0);
  useFrame((_, delta) => {
    if (!active || !data.signals.length) return;
    acc.current += delta;
    if (acc.current < 0.15) return;
    acc.current = 0;
    const clock = useGame.getState().clock;
    for (const s of data.signals) {
      const st = signalState(seed, s.nx, s.nz, s.axisX, clock);
      s.dots[0].visible = st === 0;
      s.dots[1].visible = st === 1;
      s.dots[2].visible = st === 2;
    }
  });
}
