'use client';

import { useMemo } from 'react';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';

type Spec = { url: string; L: number; ride: number; truckWheel?: boolean };

const FILES = {
  sedan: { url: '/models/vehicles/sedan.glb', L: 4.5, ride: 0.26 },
  suv: { url: '/models/vehicles/suv-luxury.glb', L: 4.75, ride: 0.34 },
  jeep: { url: '/models/vehicles/suv.glb', L: 4.3, ride: 0.46 },
  pickup: { url: '/models/vehicles/truck.glb', L: 5.2, ride: 0.38, truckWheel: true },
  van: { url: '/models/vehicles/van.glb', L: 5.3, ride: 0.36 },
  bus: { url: '/models/vehicles/delivery.glb', L: 9.6, ride: 0.5, truckWheel: true },
  taxi: { url: '/models/vehicles/taxi.glb', L: 4.5, ride: 0.26 },
  police: { url: '/models/vehicles/police.glb', L: 4.5, ride: 0.26 },
  ambulance: { url: '/models/vehicles/ambulance.glb', L: 5.3, ride: 0.36 }
} as const;

type CarKind = keyof typeof FILES;

const WHEEL_URL = '/models/vehicles/wheel-default.glb';
const WHEEL_TRUCK_URL = '/models/vehicles/wheel-truck.glb';

export type CarKit = {
  body: THREE.Group;
  wheel: THREE.BufferGeometry;
  wheelTruck: THREE.BufferGeometry;
  wheelMat: THREE.Material;
};

let cache: CarKit | null = null;

export function cityCars() {
  return cache;
}

function isHelperCube(mesh: THREE.Mesh) {
  mesh.geometry.computeBoundingBox();
  const b = mesh.geometry.boundingBox;
  if (!b) return false;
  const sx = b.max.x - b.min.x;
  const sy = b.max.y - b.min.y;
  const sz = b.max.z - b.min.z;
  return Math.abs(sx - 2) < 0.08 && Math.abs(sy - 2) < 0.08 && Math.abs(sz - 2) < 0.08;
}

function lambertOf(src: THREE.Material) {
  const m = src as THREE.MeshStandardMaterial;
  return new THREE.MeshLambertMaterial({
    map: m.map ?? null,
    color: m.color ? m.color.clone() : new THREE.Color(0xffffff)
  });
}

/** Strip authored wheels, scale the body to the physics length, face -Z, and
 *  sit the underbody at `ride`. Rapier supplies the moving wheels separately. */
function bakeBody(scene: THREE.Object3D, length: number, ride: number) {
  const inner = new THREE.Group();
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    // Every Kenney body GLB already includes four wheels (and some include a
    // spare). They cannot stay attached to the body because Rapier positions
    // and spins the four suspension wheels independently.
    if (!mesh.isMesh || isHelperCube(mesh) || /wheel/i.test(mesh.name)) return;
    const clone = new THREE.Mesh(mesh.geometry, lambertOf(mesh.material as THREE.Material));
    mesh.matrixWorld.decompose(clone.position, clone.quaternion, clone.scale);
    clone.castShadow = true;
    clone.receiveShadow = true;
    inner.add(clone);
  });
  if (!inner.children.length) throw new Error('car file contains no body mesh');

  inner.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(inner);
  const s = length / Math.max(0.2, box.max.z - box.min.z);
  inner.scale.setScalar(s);
  inner.rotation.y = Math.PI;
  inner.position.set(0, 0, 0);
  inner.updateMatrixWorld(true);
  box.setFromObject(inner);
  inner.position.set(
    -((box.min.x + box.max.x) / 2),
    ride - box.min.y,
    -((box.min.z + box.max.z) / 2)
  );

  const root = new THREE.Group();
  root.add(inner);
  return root;
}

function bakeWheel(scene: THREE.Object3D) {
  let source: THREE.Mesh | null = null;
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || isHelperCube(mesh)) return;
    if (!source) source = mesh;
  });
  if (!source) throw new Error('wheel file contains no mesh');
  const mesh = source as THREE.Mesh;
  const geometry = mesh.geometry.clone();
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  // Kenney wheels already rotate around X: X is width and Y/Z are diameter.
  const diam = Math.max(box.max.y - box.min.y, box.max.z - box.min.z);
  geometry.scale(1 / diam, 1 / diam, 1 / diam);
  geometry.center();
  return { geometry, material: lambertOf(mesh.material as THREE.Material) };
}

export function useCityCars(): CarKit {
  const sedan = useGLTF(FILES.sedan.url);
  const suv = useGLTF(FILES.suv.url);
  const jeep = useGLTF(FILES.jeep.url);
  const pickup = useGLTF(FILES.pickup.url);
  const van = useGLTF(FILES.van.url);
  const bus = useGLTF(FILES.bus.url);
  const taxi = useGLTF(FILES.taxi.url);
  const police = useGLTF(FILES.police.url);
  const ambulance = useGLTF(FILES.ambulance.url);
  const wheel = useGLTF(WHEEL_URL);
  const wheelTruck = useGLTF(WHEEL_TRUCK_URL);

  return useMemo(() => {
    const scenes: Record<CarKind, THREE.Group> = {
      sedan: sedan.scene,
      suv: suv.scene,
      jeep: jeep.scene,
      pickup: pickup.scene,
      van: van.scene,
      bus: bus.scene,
      taxi: taxi.scene,
      police: police.scene,
      ambulance: ambulance.scene
    };
    const body = new THREE.Group();
    body.name = 'car-kit';
    (Object.keys(scenes) as CarKind[]).forEach((kind) => {
      const spec = FILES[kind];
      const baked = bakeBody(scenes[kind], spec.L, spec.ride);
      baked.name = kind;
      baked.visible = false;
      body.add(baked);
    });
    const w = bakeWheel(wheel.scene);
    const wt = bakeWheel(wheelTruck.scene);
    cache = { body, wheel: w.geometry, wheelTruck: wt.geometry, wheelMat: w.material };
    return cache;
  }, [sedan, suv, jeep, pickup, van, bus, taxi, police, ambulance, wheel, wheelTruck]);
}

export function kitBody(kind: string) {
  const cars = cityCars();
  if (!cars) return null;
  const proto = cars.body.children.find((c) => c.name === kind);
  if (!proto) return null;
  const clone = proto.clone();
  clone.visible = true;
  return clone;
}

export function kitWheel(radius: number, width: number, truck = false) {
  const cars = cityCars();
  if (!cars) return null;
  const geo = truck ? cars.wheelTruck : cars.wheel;
  const mesh = new THREE.Mesh(geo, cars.wheelMat);
  // Normalized wheel geometry retains a width of 0.58–0.67. Compensate so the
  // requested width is the actual width instead of scaling the tire too thin.
  const box = geo.boundingBox;
  const unitWidth = box ? box.max.x - box.min.x : 2 / 3;
  mesh.scale.set(width / unitWidth, radius * 2, radius * 2);
  mesh.castShadow = true;
  return mesh;
}

export function usesTruckWheel(kind: string) {
  return !!(FILES as Record<string, Spec>)[kind]?.truckWheel;
}

for (const spec of Object.values(FILES)) useGLTF.preload(spec.url);
useGLTF.preload(WHEEL_URL);
useGLTF.preload(WHEEL_TRUCK_URL);
