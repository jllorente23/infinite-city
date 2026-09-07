'use client';

import { useMemo } from 'react';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';

const LAMP_URL = '/models/props/street-lamp.glb';
const SIGNAL_URL = '/models/props/traffic-light.glb';

/**
 * Kenney's kit is modelled at roughly one unit per road tile, so both props get
 * scaled up to city metres. The factors are picked from the raw bounds: the lamp
 * is 0.675 units tall and the signal 0.515 up to the top of its housing.
 */
const LAMP_SCALE = 9.04;
const SIGNAL_SCALE = 10;

/**
 * Both props are baked so their front faces -Z, the same convention the vehicles
 * use, which means one yaw helper places either of them.
 */
export const propYaw = (dx: number, dz: number) => Math.atan2(-dx, -dz);

/** Underside of the lamp head, at the far end of the arm, which reaches out -Z. */
export const LAMP_HEAD = { y: 5.9, z: -1.58 };

/** Signal lenses measured off the model: red on top, then amber, then green.
 *  They sit just inside the visors on the -Z face. */
export const SIGNAL_LENS_Y = [4.98, 4.57, 4.16];
export const SIGNAL_LENS_OUT = 0.52;

export type PropMesh = { geometry: THREE.BufferGeometry; material: THREE.Material };
export type CityProps = { lamp: PropMesh; signal: PropMesh };

let cache: CityProps | null = null;

/**
 * generateChunk is synchronous and runs while React renders a chunk, so it cannot
 * call a loader hook. It reads the models from here instead; useCityProps fills
 * this in and suspends the city until both files have arrived.
 */
export function cityProps() {
  return cache;
}

/** Each kit file is a single mesh sharing one atlas material, which instances well. */
function bake(scene: THREE.Object3D, scale: number, yaw = 0): PropMesh {
  let source: THREE.Mesh | null = null;
  scene.traverse((o) => {
    if (!source && (o as THREE.Mesh).isMesh) source = o as THREE.Mesh;
  });
  if (!source) throw new Error('prop file contains no mesh');
  const mesh = source as THREE.Mesh;

  // Bake scale and the front-facing turn into the geometry, so instance matrices
  // only ever carry a place and a yaw.
  // The kit ships hard-edged normals over shared vertices, so they are left as
  // authored: a uniform scale does not affect them and rotateY carries them along.
  const geometry = mesh.geometry.clone();
  geometry.scale(scale, scale, scale);
  if (yaw) geometry.rotateY(yaw);
  geometry.computeBoundingSphere();

  // Lambert to match the rest of the city, reusing the kit's colour atlas.
  const src = mesh.material as THREE.MeshStandardMaterial;
  const material = new THREE.MeshLambertMaterial({
    map: src.map ?? null,
    color: src.color ? src.color.clone() : new THREE.Color(0xffffff)
  });
  return { geometry, material };
}

export function useCityProps(): CityProps {
  const lamp = useGLTF(LAMP_URL);
  const signal = useGLTF(SIGNAL_URL);
  return useMemo(() => {
    cache = {
      lamp: bake(lamp.scene, LAMP_SCALE),
      // the kit models the signal looking down -X, so turn it to face -Z
      signal: bake(signal.scene, SIGNAL_SCALE, -Math.PI / 2)
    };
    return cache;
  }, [lamp, signal]);
}

useGLTF.preload(LAMP_URL);
useGLTF.preload(SIGNAL_URL);
