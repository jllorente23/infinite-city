'use client';

import { Suspense, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { Cloud, Clouds } from '@react-three/drei';
import { BLOCK, CELL, DAY_SECONDS, SKY_RADIUS } from './config';
import { cloudPuffUrl, createAssets } from './textures';
import { vehicleMats } from './vehicles';
import { playerPos, qualityOf, useGame } from './store';
import { heightAt } from './rng';
import { LAMP_HEAD } from './props';

const DAY_TOP = new THREE.Color(0x5f8fd6);
const DAY_HOR = new THREE.Color(0xc6d6e8);
const SET_TOP = new THREE.Color(0x4d4278);
const SET_HOR = new THREE.Color(0xf0a266);
const NIGHT_TOP = new THREE.Color(0x0d1c3a);
const NIGHT_HOR = new THREE.Color(0x1e3d68);
const SUN_DAY = new THREE.Color(0xfff0d6);
const SUN_LOW = new THREE.Color(0xffb070);
const MOON = new THREE.Color(0xb7c8ee);
const HEMI_DAY = new THREE.Color(0xe8f0fa);
const HEMI_NIGHT = new THREE.Color(0x6b8fc4);
const GROUND_DAY = new THREE.Color(0x5e6670);
const GROUND_NIGHT = new THREE.Color(0x1a2a3c);

const CLOUD_DAY = new THREE.Color(0xffffff);
const CLOUD_SET = new THREE.Color(0xffc79a);
const CLOUD_NIGHT = new THREE.Color(0x2b3346);

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Clouds keep the scene fog off so the haze cannot erase them overhead. */
class CloudLambert extends THREE.MeshLambertMaterial {
  constructor() {
    super();
    this.fog = false;
  }
}

/** A handful of drifting billboard clumps, parked at a fixed altitude. */
function CloudLayer({ group }: { group: React.RefObject<THREE.Group> }) {
  const texture = useMemo(() => cloudPuffUrl(), []);
  const puffs = useMemo(
    () =>
      Array.from({ length: 7 }, (_, k) => {
        const ang = (k / 7) * Math.PI * 2 + 0.7;
        const dist = 150 + ((k * 53) % 130);
        return {
          seed: k * 17 + 3,
          position: [Math.cos(ang) * dist, 120 + ((k * 29) % 70), Math.sin(ang) * dist] as [number, number, number]
        };
      }),
    []
  );
  return (
    <Clouds ref={group} material={CloudLambert} texture={texture} limit={260} frustumCulled={false}>
      {puffs.map((p) => (
        <Cloud
          key={p.seed}
          seed={p.seed}
          position={p.position}
          bounds={[95, 14, 95]}
          segments={26}
          volume={34}
          growth={9}
          speed={0.12}
          opacity={0.5}
          fade={40}
        />
      ))}
    </Clouds>
  );
}

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
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS, 32, 16), mat);
    mesh.frustumCulled = false;
    return { mesh, mat };
  }, []);

  const stars = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(800 * 3);
    const r = SKY_RADIUS * 0.94;
    for (let i = 0; i < 800; i++) {
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(Math.random() * 0.95 + 0.05);
      pos[i * 3] = Math.cos(th) * Math.sin(ph) * r;
      pos[i * 3 + 1] = Math.cos(ph) * r;
      pos[i * 3 + 2] = Math.sin(th) * Math.sin(ph) * r;
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({ color: 0xffffff, size: 1.8, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
    return new THREE.Points(g, m);
  }, []);

  // Starts well past the city core so the haze hides the streaming edge without
  // washing out everything in the middle distance.
  const fog = useMemo(() => new THREE.Fog(0xc4d4e6, q.loadRadius * 28, (q.loadRadius + 0.8) * 50), [q.loadRadius]);
  scene.fog = fog;

  const cloudGroup = useRef<THREE.Group>(null);
  const cloudMat = useRef<THREE.MeshLambertMaterial | null>(null);
  const puffUrl = useMemo(() => (q.clouds ? cloudPuffUrl() : null), [q.clouds]);

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
        sun.current.intensity = 0.72 * night;
      }
      sun.current.target.position.set(playerPos.x, 0, playerPos.z);
      sun.current.target.updateMatrixWorld();
    }
    if (hemi.current) {
      hemi.current.intensity = 0.48 + 0.52 * day;
      hemi.current.color.copy(HEMI_NIGHT).lerp(HEMI_DAY, day);
      hemi.current.groundColor.copy(GROUND_NIGHT).lerp(GROUND_DAY, day);
    }
    state.gl.toneMappingExposure = 1.08 + night * 0.22;

    (stars.material as THREE.PointsMaterial).opacity = Math.pow(night, 2) * 0.9;
    sky.mesh.position.copy(state.camera.position);
    stars.position.copy(state.camera.position);

    // Clouds ride along with the camera so the sky never empties out, and they
    // pick up the sunset tint and fade down to a thin haze at night.
    if (cloudGroup.current) {
      cloudGroup.current.position.set(state.camera.position.x, 0, state.camera.position.z);
      if (!cloudMat.current) {
        cloudGroup.current.traverse((o: any) => {
          if (o.isInstancedMesh) cloudMat.current = o.material;
        });
      }
      const cm = cloudMat.current;
      if (cm) {
        cm.color.copy(CLOUD_NIGHT).lerp(CLOUD_DAY, day).lerp(CLOUD_SET, dusk * 0.5);
        cm.opacity = 0.2 + day * 0.75;
      }
    }

    const { mats } = assets;
    for (const f of mats.facades) f.emissiveIntensity = night * 1.1;
    mats.merged.emissiveIntensity = night * 1.1;
    mats.glow.opacity = night * 0.85;
    mats.bulb.emissiveIntensity = 0.25 + night * 1.6;
    mats.mallGlass.emissiveIntensity = night * 0.5;

    const vm = vehicleMats();
    const lightsOn = day < 0.55;
    vm.head.emissiveIntensity = lightsOn ? 2.4 : 0;
    vm.brake.emissiveIntensity = lightsOn ? 0.85 : 0.15;
    const envI = 0.25 + day;
    for (const key of Object.keys(vm.body)) vm.body[Number(key)].envMapIntensity = envI;
    vm.glass.envMapIntensity = envI;
    vm.rim.envMapIntensity = envI * 1.1;
    vm.chrome.envMapIntensity = envI * 1.2;
    const flash = performance.now() % 900 < 450;
    vm.barR.emissiveIntensity = flash ? 1.4 : 0.15;
    vm.barB.emissiveIntensity = flash ? 0.15 : 1.4;

    setHud({ clock: t * 24, night });
  });

  return (
    <>
      <primitive object={sky.mesh} />
      <primitive object={stars} />
      {puffUrl && (
        // Its own boundary: a slow cloud sprite must never hold up the whole city.
        <Suspense fallback={null}>
          <CloudLayer group={cloudGroup} />
        </Suspense>
      )}
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
      <StreetGlow count={q.shadows ? 8 : 5} />
    </>
  );
}

/** A handful of warm point lights that snap to the nearest street-lamp heads. */
function StreetGlow({ count }: { count: number }) {
  const group = useRef<THREE.Group>(null);
  const lamps = useMemo(
    () =>
      Array.from({ length: count }, () => {
        const l = new THREE.PointLight(0xffd89a, 0, 26, 1.6);
        return l;
      }),
    [count]
  );

  useFrame(() => {
    const night = useGame.getState().night;
    const heads = nearestLampHeads(playerPos.x, playerPos.z, count);
    lamps.forEach((l, i) => {
      const h = heads[i];
      if (!h) { l.intensity = 0; return; }
      l.position.set(h.x, h.y, h.z);
      l.intensity = night * 22;
    });
  });

  return (
    <group ref={group}>
      {lamps.map((l, i) => (
        <primitive key={i} object={l} />
      ))}
    </group>
  );
}

function nearestLampHeads(x: number, z: number, n: number) {
  const ci = Math.floor(x / CELL);
  const cj = Math.floor(z / CELL);
  const out: { x: number; y: number; z: number; d: number }[] = [];
  for (let i = ci - 2; i <= ci + 2; i++) {
    for (let j = cj - 2; j <= cj + 2; j++) {
      const cx = i * CELL + CELL / 2;
      const cz = j * CELL + CELL / 2;
      for (const [ex, ez] of [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const) {
        const lx = cx + ex * (BLOCK / 2 - 1.2);
        const lz = cz + ez * (BLOCK / 2 - 1.2);
        out.push({ x: lx, y: heightAt(lx, lz) + LAMP_HEAD.y, z: lz, d: Math.hypot(lx - x, lz - z) });
      }
    }
  }
  out.sort((a, b) => a.d - b.d);
  return out.slice(0, n);
}
