'use client';

import { useMemo } from 'react';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';

/**
 * Quaternius Ultimate Nature Pack (CC0). The models already sit near city
 * metres; a small extra scale plants a 8–11 m tree. Vertex colours come from
 * the authored materials (bark / leaf / flower), so they are not white cubes.
 */
export const NATURE = {
  common: { url: '/models/nature/CommonTree_1.glb', scale: 3.8 },
  commonB: { url: '/models/nature/CommonTree_3.glb', scale: 4.1 },
  birch: { url: '/models/nature/BirchTree_2.glb', scale: 3.9 },
  pine: { url: '/models/nature/PineTree_2.glb', scale: 4.4 },
  willow: { url: '/models/nature/Willow_1.glb', scale: 3.6 },
  bush: { url: '/models/nature/Bush_1.glb', scale: 2.05 },
  berries: { url: '/models/nature/BushBerries_1.glb', scale: 1.9 },
  flowers: { url: '/models/nature/Flowers.glb', scale: 2.1 },
  plant: { url: '/models/nature/Plant_2.glb', scale: 1.85 },
  grass: { url: '/models/nature/Grass_2.glb', scale: 1.7 },
  rock: { url: '/models/nature/Rock_Moss_1.glb', scale: 1.8 }
} as const;

export type NatureKind = keyof typeof NATURE;
export const TREE_KINDS: NatureKind[] = ['common', 'commonB', 'birch', 'pine', 'willow'];
export const GROUND_KINDS: NatureKind[] = ['bush', 'berries', 'flowers', 'plant', 'grass', 'rock'];
/** Compact kerb planting — no wide bushes that spill onto the asphalt. */
export const KERB_KINDS: NatureKind[] = ['flowers', 'plant', 'grass', 'rock'];

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
    const mat = mesh.material as THREE.MeshStandardMaterial;
    if (!flat.attributes.color && mat?.color) {
      const n = flat.attributes.position.count;
      const col = new Float32Array(n * 3);
      for (let k = 0; k < n; k++) {
        col[k * 3] = mat.color.r;
        col[k * 3 + 1] = mat.color.g;
        col[k * 3 + 2] = mat.color.b;
      }
      flat.setAttribute('color', new THREE.BufferAttribute(col, 3));
    }
    parts.push(flat);
  });
  if (!parts.length) throw new Error('nature file contains no mesh');

  let vCount = 0;
  for (const g of parts) vCount += g.attributes.position.count;
  const pos = new Float32Array(vCount * 3);
  const col = new Float32Array(vCount * 3);
  const nor = new Float32Array(vCount * 3);
  let off = 0;
  let hadNormal = false;
  for (const g of parts) {
    const n = g.attributes.position.count;
    const src = g.attributes;
    pos.set(src.position.array as Float32Array, off * 3);
    if (src.normal) { nor.set(src.normal.array as Float32Array, off * 3); hadNormal = true; }
    if (src.color) {
      const arr = src.color.array as Float32Array;
      const stride = src.color.itemSize;
      for (let k = 0; k < n; k++) {
        col[(off + k) * 3] = arr[k * stride];
        col[(off + k) * 3 + 1] = arr[k * stride + 1];
        col[(off + k) * 3 + 2] = arr[k * stride + 2];
      }
    } else {
      for (let k = 0; k < n; k++) { col[(off + k) * 3] = 0.35; col[(off + k) * 3 + 1] = 0.55; col[(off + k) * 3 + 2] = 0.28; }
    }
    off += n;
    g.dispose();
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geometry.scale(scale, scale, scale);
  if (!hadNormal) geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  geometry.translate(-((box.min.x + box.max.x) / 2), -box.min.y, -((box.min.z + box.max.z) / 2));
  geometry.computeBoundingSphere();

  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  return { geometry, material };
}

export function useCityNature(): CityNature {
  const common = useGLTF(NATURE.common.url);
  const commonB = useGLTF(NATURE.commonB.url);
  const birch = useGLTF(NATURE.birch.url);
  const pine = useGLTF(NATURE.pine.url);
  const willow = useGLTF(NATURE.willow.url);
  const bush = useGLTF(NATURE.bush.url);
  const berries = useGLTF(NATURE.berries.url);
  const flowers = useGLTF(NATURE.flowers.url);
  const plant = useGLTF(NATURE.plant.url);
  const grass = useGLTF(NATURE.grass.url);
  const rock = useGLTF(NATURE.rock.url);

  return useMemo(() => {
    const baked: CityNature = {
      common: mergeMeshes(common.scene, NATURE.common.scale),
      commonB: mergeMeshes(commonB.scene, NATURE.commonB.scale),
      birch: mergeMeshes(birch.scene, NATURE.birch.scale),
      pine: mergeMeshes(pine.scene, NATURE.pine.scale),
      willow: mergeMeshes(willow.scene, NATURE.willow.scale),
      bush: mergeMeshes(bush.scene, NATURE.bush.scale),
      berries: mergeMeshes(berries.scene, NATURE.berries.scale),
      flowers: mergeMeshes(flowers.scene, NATURE.flowers.scale),
      plant: mergeMeshes(plant.scene, NATURE.plant.scale),
      grass: mergeMeshes(grass.scene, NATURE.grass.scale),
      rock: mergeMeshes(rock.scene, NATURE.rock.scale)
    };
    cache = baked;
    return baked;
  }, [common, commonB, birch, pine, willow, bush, berries, flowers, plant, grass, rock]);
}

for (const spec of Object.values(NATURE)) useGLTF.preload(spec.url);
