'use client';

import { useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';

type Mark = { x: number; y: number; z: number; yaw: number; t: number; life: number };

const pool: Mark[] = [];
const MAX = 220;
const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3(0.32, 1, 1.15);
const UP = new THREE.Vector3(0, 1, 0);

export function stampSkid(x: number, y: number, z: number, yaw: number) {
  if (pool.length >= MAX) pool.shift();
  pool.push({ x, y, z, yaw, t: 0, life: 28 });
}

export function SkidMarks() {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const geo = useRef(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
  const mat = useRef(new THREE.MeshBasicMaterial({
    color: 0x141414,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4
  }));

  useFrame((_, dt) => {
    const inst = mesh.current;
    if (!inst) return;
    const step = Math.min(dt, 0.05);
    for (let k = pool.length - 1; k >= 0; k--) {
      pool[k].t += step;
      if (pool[k].t >= pool[k].life) pool.splice(k, 1);
    }
    inst.count = pool.length;
    pool.forEach((s, i) => {
      const fade = 1 - s.t / s.life;
      _p.set(s.x, s.y, s.z);
      _q.setFromAxisAngle(UP, s.yaw);
      _s.set(0.28 + fade * 0.04, 1, 1.05);
      _m.compose(_p, _q, _s);
      inst.setMatrixAt(i, _m);
    });
    inst.instanceMatrix.needsUpdate = true;
    inst.visible = pool.length > 0;
  });

  return <instancedMesh ref={mesh} args={[geo.current, mat.current, MAX]} frustumCulled={false} />;
}
