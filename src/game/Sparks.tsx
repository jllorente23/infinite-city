'use client';

import { useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';

type Spark = { x: number; y: number; z: number; vx: number; vy: number; vz: number; t: number; life: number };

const pool: Spark[] = [];
const MAX = 96;
const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();

export function burstSparks(x: number, y: number, z: number, vx: number, vz: number) {
  const n = 16;
  for (let k = 0; k < n; k++) {
    if (pool.length >= MAX) pool.shift();
    const a = Math.random() * Math.PI * 2;
    const sp = 2 + Math.random() * 7;
    pool.push({
      x, y, z,
      vx: -vx * 0.15 + Math.cos(a) * sp,
      vy: 1.6 + Math.random() * 6,
      vz: -vz * 0.15 + Math.sin(a) * sp,
      t: 0,
      life: 0.22 + Math.random() * 0.28
    });
  }
}

export function Sparks() {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const geo = useRef(new THREE.SphereGeometry(0.045, 5, 4));
  const mat = useRef(new THREE.MeshBasicMaterial({ color: 0xffc56a, toneMapped: false }));

  useFrame((_, dt) => {
    const inst = mesh.current;
    if (!inst) return;
    const step = Math.min(dt, 0.04);
    for (let k = pool.length - 1; k >= 0; k--) {
      const s = pool[k];
      s.t += step;
      if (s.t >= s.life) { pool.splice(k, 1); continue; }
      s.x += s.vx * step;
      s.y += s.vy * step;
      s.z += s.vz * step;
      s.vy -= 28 * step;
    }
    inst.count = pool.length;
    pool.forEach((s, i) => {
      const fade = 1 - s.t / s.life;
      _p.set(s.x, s.y, s.z);
      _s.setScalar(0.55 + fade * 1.1);
      _m.compose(_p, _q, _s);
      inst.setMatrixAt(i, _m);
    });
    inst.instanceMatrix.needsUpdate = true;
    inst.visible = pool.length > 0;
  });

  return <instancedMesh ref={mesh} args={[geo.current, mat.current, MAX]} frustumCulled={false} />;
}
