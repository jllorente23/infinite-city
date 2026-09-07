'use client';

import { useMemo } from 'react';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';

export type BuildingKind =
  | 'midA' | 'midF' | 'midI' | 'midL'
  | 'wideJ' | 'wideN'
  | 'towerB' | 'towerD'
  | 'houseA' | 'houseE' | 'houseK' | 'houseP';

type Spec = { url: string; scale: number };

const SPEC: Record<BuildingKind, Spec> = {
  midA: { url: '/models/buildings/commercial/building-a.glb', scale: 14 },
  midF: { url: '/models/buildings/commercial/building-f.glb', scale: 13.5 },
  midI: { url: '/models/buildings/commercial/building-i.glb', scale: 13 },
  midL: { url: '/models/buildings/commercial/building-l.glb', scale: 12.5 },
  wideJ: { url: '/models/buildings/commercial/building-j.glb', scale: 11 },
  wideN: { url: '/models/buildings/commercial/building-n.glb', scale: 11.5 },
  towerB: { url: '/models/buildings/commercial/building-skyscraper-b.glb', scale: 15 },
  towerD: { url: '/models/buildings/commercial/building-skyscraper-d.glb', scale: 14.5 },
  houseA: { url: '/models/buildings/suburban/building-type-a.glb', scale: 11 },
  houseE: { url: '/models/buildings/suburban/building-type-e.glb', scale: 10.5 },
  houseK: { url: '/models/buildings/suburban/building-type-k.glb', scale: 11.5 },
  houseP: { url: '/models/buildings/suburban/building-type-p.glb', scale: 11 }
};

export const MID_KINDS: BuildingKind[] = ['midA', 'midF', 'midI', 'midL', 'wideJ', 'wideN'];
export const TOWER_KINDS: BuildingKind[] = ['towerB', 'towerD'];
export const HOUSE_KINDS: BuildingKind[] = ['houseA', 'houseE', 'houseK', 'houseP'];

export type BuildingMesh = {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  size: { w: number; h: number; d: number };
};

export type CityBuildings = Record<BuildingKind, BuildingMesh>;

let cache: CityBuildings | null = null;

export function cityBuildings() {
  return cache;
}

function bake(scene: THREE.Object3D, scale: number): BuildingMesh {
  let source: THREE.Mesh | null = null;
  scene.traverse((o) => {
    if (!source && (o as THREE.Mesh).isMesh) source = o as THREE.Mesh;
  });
  if (!source) throw new Error('building file contains no mesh');
  const mesh = source as THREE.Mesh;
  const geometry = mesh.geometry.clone();
  geometry.scale(scale, scale, scale);
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  geometry.translate(-((box.min.x + box.max.x) / 2), -box.min.y, -((box.min.z + box.max.z) / 2));
  geometry.computeBoundingSphere();
  const size = {
    w: box.max.x - box.min.x,
    h: box.max.y - box.min.y,
    d: box.max.z - box.min.z
  };
  const src = mesh.material as THREE.MeshStandardMaterial;
  const material = new THREE.MeshLambertMaterial({
    map: src.map ?? null,
    color: src.color ? src.color.clone() : new THREE.Color(0xffffff)
  });
  return { geometry, material, size };
}

export function useCityBuildings(): CityBuildings {
  const midA = useGLTF(SPEC.midA.url);
  const midF = useGLTF(SPEC.midF.url);
  const midI = useGLTF(SPEC.midI.url);
  const midL = useGLTF(SPEC.midL.url);
  const wideJ = useGLTF(SPEC.wideJ.url);
  const wideN = useGLTF(SPEC.wideN.url);
  const towerB = useGLTF(SPEC.towerB.url);
  const towerD = useGLTF(SPEC.towerD.url);
  const houseA = useGLTF(SPEC.houseA.url);
  const houseE = useGLTF(SPEC.houseE.url);
  const houseK = useGLTF(SPEC.houseK.url);
  const houseP = useGLTF(SPEC.houseP.url);

  return useMemo(() => {
    cache = {
      midA: bake(midA.scene, SPEC.midA.scale),
      midF: bake(midF.scene, SPEC.midF.scale),
      midI: bake(midI.scene, SPEC.midI.scale),
      midL: bake(midL.scene, SPEC.midL.scale),
      wideJ: bake(wideJ.scene, SPEC.wideJ.scale),
      wideN: bake(wideN.scene, SPEC.wideN.scale),
      towerB: bake(towerB.scene, SPEC.towerB.scale),
      towerD: bake(towerD.scene, SPEC.towerD.scale),
      houseA: bake(houseA.scene, SPEC.houseA.scale),
      houseE: bake(houseE.scene, SPEC.houseE.scale),
      houseK: bake(houseK.scene, SPEC.houseK.scale),
      houseP: bake(houseP.scene, SPEC.houseP.scale)
    };
    return cache;
  }, [midA, midF, midI, midL, wideJ, wideN, towerB, towerD, houseA, houseE, houseK, houseP]);
}

for (const spec of Object.values(SPEC)) useGLTF.preload(spec.url);
