'use client';

import { useMemo } from 'react';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';

/**
 * Kenney Nature Kit models sit at roughly one metre per unit. City trees want
 * to be 6–10 m, so they are scaled here and the origin is shifted to the
 * ground plane (the kit buries the trunk 5 cm).
 */
export const NATURE = {
  oak: { url: '/models/nature/tree_oak.glb', scale: 7.2 },
  tall: { url: '/models/nature/tree_tall.glb', scale: 6.4 },
  default: { url: '/models/nature/tree_default.glb', scale: 6.2 },
  pine: { url: '/models/nature/tree_pineDefaultA.glb', scale: 6.8 },
  small: { url: '/models/nature/tree_small.glb', scale: 5.6 },
  bush: { url: '/models/nature/plant_bushDetailed.glb', scale: 5.4 },
  bushSmall: { url: '/models/nature/plant_bushSmall.glb', scale: 4.8 },
  grass: { url: '/models/nature/grass_large.glb', scale: 3.6 },
  flowerY: { url: '/models/nature/flower_yellowA.glb', scale: 4.2 },
  flowerR: { url: '/models/nature/flower_redA.glb', scale: 4.2 },
  flowerP: { url: '/models/nature/flower_purpleA.glb', scale: 4.2 }
} as const;

export type NatureKind = keyof typeof NATURE;
export const TREE_KINDS: NatureKind[] = ['oak', 'tall', 'default', 'pine', 'small'];
export const GROUND_KINDS: NatureKind[] = ['bush', 'bushSmall', 'grass', 'flowerY', 'flowerR', 'flowerP'];

export type NatureMesh = { geometry: THREE.BufferGeometry; material: THREE.Material };
export type CityNature = Record<NatureKind, NatureMesh>;

let cache: CityNature | null = null;

export function cityNature() {
  return cache;
}

function mergeMeshes(scene: THREE.Object3D, scale: number): NatureMesh {
  const parts: THREE.BufferGeometry[] = [];
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const raw = mesh.geometry.clone();
    raw.applyMatrix4(mesh.matrixWorld);
    const flat = raw.index ? raw.toNonIndexed() : raw;
    if (flat !== raw) raw.dispose();
    parts.push(flat);
  });
  if (!parts.length) throw new Error('nature file contains no mesh');

  let vCount = 0;
  for (const g of parts) vCount += g.attributes.position.count;
  const pos = new Float32Array(vCount * 3);
  const col = new Float32Array(vCount * 3);
  const nor = new Float32Array(vCount * 3);
  let off = 0;
  for (const g of parts) {
    const n = g.attributes.position.count;
    const src = g.attributes;
    pos.set(src.position.array as Float32Array, off * 3);
    if (src.normal) nor.set(src.normal.array as Float32Array, off * 3);
    if (src.color) {
      const arr = src.color.array as Float32Array;
      const stride = src.color.itemSize;
      for (let k = 0; k < n; k++) {
        col[(off + k) * 3] = arr[k * stride];
        col[(off + k) * 3 + 1] = arr[k * stride + 1];
        col[(off + k) * 3 + 2] = arr[k * stride + 2];
      }
    } else {
      for (let k = 0; k < n; k++) { col[(off + k) * 3] = 1; col[(off + k) * 3 + 1] = 1; col[(off + k) * 3 + 2] = 1; }
    }
    off += n;
    g.dispose();
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geometry.scale(scale, scale, scale);
  if (!parts.some((g) => g.attributes.normal)) geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  geometry.translate(-((box.min.x + box.max.x) / 2), -box.min.y, -((box.min.z + box.max.z) / 2));
  geometry.computeBoundingSphere();

  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  return { geometry, material };
}

export function useCityNature(): CityNature {
  const oak = useGLTF(NATURE.oak.url);
  const tall = useGLTF(NATURE.tall.url);
  const def = useGLTF(NATURE.default.url);
  const pine = useGLTF(NATURE.pine.url);
  const small = useGLTF(NATURE.small.url);
  const bush = useGLTF(NATURE.bush.url);
  const bushSmall = useGLTF(NATURE.bushSmall.url);
  const grass = useGLTF(NATURE.grass.url);
  const flowerY = useGLTF(NATURE.flowerY.url);
  const flowerR = useGLTF(NATURE.flowerR.url);
  const flowerP = useGLTF(NATURE.flowerP.url);

  return useMemo(() => {
    const baked: CityNature = {
      oak: mergeMeshes(oak.scene, NATURE.oak.scale),
      tall: mergeMeshes(tall.scene, NATURE.tall.scale),
      default: mergeMeshes(def.scene, NATURE.default.scale),
      pine: mergeMeshes(pine.scene, NATURE.pine.scale),
      small: mergeMeshes(small.scene, NATURE.small.scale),
      bush: mergeMeshes(bush.scene, NATURE.bush.scale),
      bushSmall: mergeMeshes(bushSmall.scene, NATURE.bushSmall.scale),
      grass: mergeMeshes(grass.scene, NATURE.grass.scale),
      flowerY: mergeMeshes(flowerY.scene, NATURE.flowerY.scale),
      flowerR: mergeMeshes(flowerR.scene, NATURE.flowerR.scale),
      flowerP: mergeMeshes(flowerP.scene, NATURE.flowerP.scale)
    };
    cache = baked;
    return baked;
  }, [oak, tall, def, pine, small, bush, bushSmall, grass, flowerY, flowerR, flowerP]);
}

for (const spec of Object.values(NATURE)) useGLTF.preload(spec.url);
