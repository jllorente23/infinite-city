'use client';

import { useMemo } from 'react';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';

/** Kenney *City Kit Industrial* (CC0). Same look as the commercial and
 *  suburban kits, but with its own colour atlas. */
export type IndustrialKind =
  | 'naveC' | 'naveL' | 'naveM' | 'naveQ' | 'naveR' | 'naveT'
  | 'chimneyLarge' | 'chimneyMedium'
  | 'tankLarge' | 'tank'
  | 'containerA' | 'containerB' | 'containerC'
  | 'waterTower';

type Spec = { url: string; scale: number };

const DIR = '/models/industrial/';

const SPEC: Record<IndustrialKind, Spec> = {
  naveC: { url: `${DIR}building-c.glb`, scale: 9 },
  naveL: { url: `${DIR}building-l.glb`, scale: 8.5 },
  naveM: { url: `${DIR}building-m.glb`, scale: 9.5 },
  naveQ: { url: `${DIR}building-q.glb`, scale: 8.5 },
  naveR: { url: `${DIR}building-r.glb`, scale: 8 },
  naveT: { url: `${DIR}building-t.glb`, scale: 9.5 },
  chimneyLarge: { url: `${DIR}chimney-large.glb`, scale: 6 },
  chimneyMedium: { url: `${DIR}chimney-medium.glb`, scale: 7 },
  tankLarge: { url: `${DIR}detail-tank-large.glb`, scale: 5 },
  tank: { url: `${DIR}detail-tank.glb`, scale: 6 },
  containerA: { url: `${DIR}shipping-container-a.glb`, scale: 2 },
  containerB: { url: `${DIR}shipping-container-b.glb`, scale: 2 },
  containerC: { url: `${DIR}shipping-container-c.glb`, scale: 2 },
  waterTower: { url: `${DIR}water-tower.glb`, scale: 7 }
};

export const NAVE_KINDS: IndustrialKind[] = ['naveC', 'naveL', 'naveM', 'naveQ', 'naveR', 'naveT'];
export const STACK_KINDS: IndustrialKind[] = ['chimneyLarge', 'chimneyMedium'];
export const TANK_KINDS: IndustrialKind[] = ['tankLarge', 'tank'];
export const CONTAINER_KINDS: IndustrialKind[] = ['containerA', 'containerB', 'containerC'];

export type IndustrialMesh = {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  size: { w: number; h: number; d: number };
};

export type CityIndustrial = Record<IndustrialKind, IndustrialMesh>;

let cache: CityIndustrial | null = null;

export function cityIndustrial() {
  return cache;
}

/** Origin on the footprint centre with the base at y=0, like the other kits. */
function bake(scene: THREE.Object3D, scale: number): IndustrialMesh {
  let source: THREE.Mesh | null = null;
  scene.traverse((o) => {
    if (!source && (o as THREE.Mesh).isMesh) source = o as THREE.Mesh;
  });
  if (!source) throw new Error('industrial file contains no mesh');
  const mesh = source as THREE.Mesh;
  const geometry = mesh.geometry.clone();
  geometry.scale(scale, scale, scale);
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  geometry.translate(-((box.min.x + box.max.x) / 2), -box.min.y, -((box.min.z + box.max.z) / 2));
  geometry.computeBoundingSphere();
  const src = mesh.material as THREE.MeshStandardMaterial;
  const material = new THREE.MeshLambertMaterial({
    map: src.map ?? null,
    color: src.color ? src.color.clone() : new THREE.Color(0xffffff)
  });
  return {
    geometry,
    material,
    size: { w: box.max.x - box.min.x, h: box.max.y - box.min.y, d: box.max.z - box.min.z }
  };
}

export function useCityIndustrial(): CityIndustrial {
  const naveC = useGLTF(SPEC.naveC.url);
  const naveL = useGLTF(SPEC.naveL.url);
  const naveM = useGLTF(SPEC.naveM.url);
  const naveQ = useGLTF(SPEC.naveQ.url);
  const naveR = useGLTF(SPEC.naveR.url);
  const naveT = useGLTF(SPEC.naveT.url);
  const chimneyLarge = useGLTF(SPEC.chimneyLarge.url);
  const chimneyMedium = useGLTF(SPEC.chimneyMedium.url);
  const tankLarge = useGLTF(SPEC.tankLarge.url);
  const tank = useGLTF(SPEC.tank.url);
  const containerA = useGLTF(SPEC.containerA.url);
  const containerB = useGLTF(SPEC.containerB.url);
  const containerC = useGLTF(SPEC.containerC.url);
  const waterTower = useGLTF(SPEC.waterTower.url);

  return useMemo(() => {
    cache = {
      naveC: bake(naveC.scene, SPEC.naveC.scale),
      naveL: bake(naveL.scene, SPEC.naveL.scale),
      naveM: bake(naveM.scene, SPEC.naveM.scale),
      naveQ: bake(naveQ.scene, SPEC.naveQ.scale),
      naveR: bake(naveR.scene, SPEC.naveR.scale),
      naveT: bake(naveT.scene, SPEC.naveT.scale),
      chimneyLarge: bake(chimneyLarge.scene, SPEC.chimneyLarge.scale),
      chimneyMedium: bake(chimneyMedium.scene, SPEC.chimneyMedium.scale),
      tankLarge: bake(tankLarge.scene, SPEC.tankLarge.scale),
      tank: bake(tank.scene, SPEC.tank.scale),
      containerA: bake(containerA.scene, SPEC.containerA.scale),
      containerB: bake(containerB.scene, SPEC.containerB.scale),
      containerC: bake(containerC.scene, SPEC.containerC.scale),
      waterTower: bake(waterTower.scene, SPEC.waterTower.scale)
    };
    return cache;
  }, [
    naveC, naveL, naveM, naveQ, naveR, naveT,
    chimneyLarge, chimneyMedium, tankLarge, tank,
    containerA, containerB, containerC, waterTower
  ]);
}

for (const spec of Object.values(SPEC)) useGLTF.preload(spec.url);
