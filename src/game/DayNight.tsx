'use client';

import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { DAY_SECONDS } from './config';
import { createAssets } from './textures';
import { vehicleMats } from './vehicles';
import { playerPos, qualityOf, useGame } from './store';

const DAY_TOP = new THREE.Color(0x5f8fd6);
const DAY_HOR = new THREE.Color(0xc6d6e8);
const SET_TOP = new THREE.Color(0x4d4278);
const SET_HOR = new THREE.Color(0xf0a266);
const NIGHT_TOP = new THREE.Color(0x04060e);
const NIGHT_HOR = new THREE.Color(0x131b30);
const SUN_DAY = new THREE.Color(0xfff0d6);
const SUN_LOW = new THREE.Color(0xffb070);
const MOON = new THREE.Color(0x8fa8dd);
const HEMI_DAY = new THREE.Color(0xe8f0fa);
const HEMI_NIGHT = new THREE.Color(0x2a3550);
const GROUND_DAY = new THREE.Color(0x5e6670);
const GROUND_NIGHT = new THREE.Color(0x141a24);

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function DayNight() {
  const { scene } = useThree();
  const quality = useGame((s) => s.quality);
  const q = qualityOf(quality);
  const setHud = useGame((s) => s.setHud);
  const sun = useRef<THREE.DirectionalLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const time = useRef(0.3);

  const assets = createAssets();

  const sky = useMemo(() => {
    const mat = new THREE.ShaderMaterial({
      uniforms: { top: { value: new THREE.Color(0x6d9be0) }, bottom: { value: new THREE.Color(0xc9d8ea) } },
      vertexShader: `varying vec3 vW;
        void main(){ vW = (modelMatrix * vec4(position,1.0)).xyz - cameraPosition;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 top; uniform vec3 bottom; varying vec3 vW;
        void main(){ float h = normalize(vW).y; float t = smoothstep(-0.02, 0.45, h);
        gl_FragColor = vec4(mix(bottom, top, t), 1.0); }`,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(900, 24, 12), mat);
    return { mesh, mat };
  }, []);

  const stars = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(800 * 3);
    for (let i = 0; i < 800; i++) {
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(Math.random() * 0.95 + 0.05);
      pos[i * 3] = Math.cos(th) * Math.sin(ph) * 850;
      pos[i * 3 + 1] = Math.cos(ph) * 850;
      pos[i * 3 + 2] = Math.sin(th) * Math.sin(ph) * 850;
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({ color: 0xffffff, size: 1.8, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
    return new THREE.Points(g, m);
  }, []);

  const fog = useMemo(() => new THREE.Fog(0xc4d4e6, 150, (q.loadRadius + 0.4) * 50), [q.loadRadius]);
  scene.fog = fog;

  useFrame((state, delta) => {
    time.current = (time.current + delta / DAY_SECONDS) % 1;
    const t = time.current;
    const ang = t * Math.PI * 2;
    const elev = -Math.cos(ang);
    const day = smooth(-0.12, 0.22, elev);
    const dusk = Math.max(0, 1 - Math.abs(elev) / 0.28);
    const night = 1 - day;

    const top = NIGHT_TOP.clone().lerp(DAY_TOP, day).lerp(SET_TOP, dusk * 0.6);
    const hor = NIGHT_HOR.clone().lerp(DAY_HOR, day).lerp(SET_HOR, dusk * 0.85);
    sky.mat.uniforms.top.value.copy(top);
    sky.mat.uniforms.bottom.value.copy(hor);
    fog.color.copy(hor);

    const dir = new THREE.Vector3(Math.sin(ang), -Math.cos(ang), 0.35).normalize();
    if (sun.current) {
      if (elev >= 0) {
        sun.current.position.set(playerPos.x + dir.x * 110, dir.y * 110, playerPos.z + dir.z * 110);
        sun.current.color.copy(SUN_LOW).lerp(SUN_DAY, Math.min(1, elev * 3));
        sun.current.intensity = 1.35 * day;
      } else {
        sun.current.position.set(playerPos.x - dir.x * 110, -dir.y * 110, playerPos.z - dir.z * 110);
        sun.current.color.copy(MOON);
        sun.current.intensity = 0.3 * night;
      }
      sun.current.target.position.set(playerPos.x, 0, playerPos.z);
      sun.current.target.updateMatrixWorld();
    }
    if (hemi.current) {
      hemi.current.intensity = 0.3 + 0.7 * day;
      hemi.current.color.copy(HEMI_NIGHT).lerp(HEMI_DAY, day);
      hemi.current.groundColor.copy(GROUND_NIGHT).lerp(GROUND_DAY, day);
    }

    (stars.material as THREE.PointsMaterial).opacity = Math.pow(night, 2) * 0.9;
    sky.mesh.position.copy(state.camera.position);
    stars.position.copy(state.camera.position);

    const { mats } = assets;
    for (const f of mats.facades) f.emissiveIntensity = night * 1.1;
    mats.merged.emissiveIntensity = night * 1.1;
    mats.glow.opacity = night * 0.85;
    mats.bulb.emissiveIntensity = 0.25 + night * 1.6;
    mats.mallGlass.emissiveIntensity = night * 0.5;

    const vm = vehicleMats();
    const lightsOn = day < 0.55;
    vm.head.emissiveIntensity = lightsOn ? 1.1 : 0;
    vm.brake.emissiveIntensity = lightsOn ? 0.6 : 0.15;
    const envI = 0.25 + day;
    for (const key of Object.keys(vm.body)) vm.body[Number(key)].envMapIntensity = envI;
    vm.glass.envMapIntensity = envI;
    vm.rim.envMapIntensity = envI * 1.1;
    vm.chrome.envMapIntensity = envI * 1.2;
    const flash = performance.now() % 900 < 450;
    vm.barR.emissiveIntensity = flash ? 1.4 : 0.15;
    vm.barB.emissiveIntensity = flash ? 0.15 : 1.4;

    setHud({ clock: t * 24 });
  });

  return (
    <>
      <primitive object={sky.mesh} />
      <primitive object={stars} />
      <hemisphereLight ref={hemi} args={[0xe8f0fa, 0x5e6670, 0.9]} />
      <directionalLight
        ref={sun}
        castShadow={q.shadows}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-near={1}
        shadow-camera-far={260}
        shadow-camera-left={-70}
        shadow-camera-right={70}
        shadow-camera-top={70}
        shadow-camera-bottom={-70}
        shadow-bias={-0.0008}
      />
    </>
  );
}
