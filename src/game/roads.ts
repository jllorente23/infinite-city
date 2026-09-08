'use client';

import { useMemo } from 'react';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';
import { ROAD_TILE } from './config';

/**
 * Kenney *City Kit Roads* (CC0) laid over the street grid. Each tile is a unit
 * square 0.02 thick whose roadway runs along X and spans the full width, so a
 * tile scaled to `ROAD_TILE` is exactly one `STREET` of asphalt.
 *
 * They are baked with the driving surface at y=0 and the slab hanging below,
 * which means a tile can be dropped straight onto a terrain height.
 */
export type RoadKind = 'straight' | 'crossroad' | 'crossroadPath';

const DIR = '/models/props/';
const URLS: Record<RoadKind, string> = {
  straight: `${DIR}road-straight.glb`,
  crossroad: `${DIR}road-crossroad-line.glb`,
  crossroadPath: `${DIR}road-crossroad-path.glb`
};

/**
 * Height of the *driving surface* in the source model. The tile is 0.02 tall
 * overall, but that top level is the raised verge running down either side;
 * the asphalt sits at 0.01 and spans the middle 80% of the tile. Baking against
 * the bounding box top instead put the verges on the road and sank the asphalt
 * 14 cm into the terrain, so all a tile ever showed was two strips at the kerb.
 */
const SURFACE = 0.01;

export type RoadMesh = { geometry: THREE.BufferGeometry; material: THREE.Material };
export type CityRoads = Record<RoadKind, RoadMesh>;

let cache: CityRoads | null = null;

export function cityRoads() {
  return cache;
}

function bake(scene: THREE.Object3D): RoadMesh {
  let source: THREE.Mesh | null = null;
  scene.traverse((o) => {
    if (!source && (o as THREE.Mesh).isMesh) source = o as THREE.Mesh;
  });
  if (!source) throw new Error('road tile contains no mesh');
  const mesh = source as THREE.Mesh;
  const geometry = mesh.geometry.clone();
  geometry.scale(ROAD_TILE, ROAD_TILE, ROAD_TILE);
  geometry.translate(0, -SURFACE * ROAD_TILE, 0);
  geometry.computeBoundingSphere();
  const src = mesh.material as THREE.MeshStandardMaterial;
  const material = new THREE.MeshLambertMaterial({
    map: src.map ?? null,
    color: src.color ? src.color.clone() : new THREE.Color(0xffffff)
  });
  return { geometry, material };
}

export function useCityRoads(): CityRoads {
  const straight = useGLTF(URLS.straight);
  const crossroad = useGLTF(URLS.crossroad);
  const crossroadPath = useGLTF(URLS.crossroadPath);
  return useMemo(() => {
    cache = {
      straight: bake(straight.scene),
      crossroad: bake(crossroad.scene),
      crossroadPath: bake(crossroadPath.scene)
    };
    return cache;
  }, [straight, crossroad, crossroadPath]);
}

for (const url of Object.values(URLS)) useGLTF.preload(url);
