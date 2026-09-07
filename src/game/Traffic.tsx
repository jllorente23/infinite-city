'use client';

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { RapierRigidBody, RigidBody, CuboidCollider } from '@react-three/rapier';
import { CELL } from './config';
import { heightAt } from './rng';
import { makeVehicle, pickHue, SPEC, VehicleKind } from './vehicles';
import { playerPos, qualityOf, useGame } from './store';
import { signalState } from './signals';

const KINDS: VehicleKind[] = ['sedan', 'sedan', 'suv', 'taxi', 'pickup', 'van', 'bus', 'police', 'ambulance'];
const DIR_YAW = [-Math.PI / 2, Math.PI, Math.PI / 2, 0];

type Agent = {
  dir: number;
  center: number;
  along: number;
  cruise: number;
  speed: number;
  kind: VehicleKind;
  len: number;
};

/**
 * Traffic drives the lane grid and stops at red, but the bodies are dynamic, so
 * ramming one sends it sliding instead of stopping you dead.
 */
export function Traffic() {
  const seed = useGame((s) => s.seed);
  const quality = useGame((s) => s.quality);
  const count = qualityOf(quality).traffic;

  const specs = useMemo(
    () =>
      Array.from({ length: count }, () => {
        const kind = KINDS[Math.floor(Math.random() * KINDS.length)];
        return { kind, hue: pickHue(kind, Math.random()) };
      }),
    [count, seed]
  );

  return (
    <>
      {specs.map((s, k) => (
        <TrafficCar key={`${seed}-${k}`} seed={seed} kind={s.kind} hue={s.hue} />
      ))}
    </>
  );
}

function laneOf(dir: number, center: number, along: number) {
  if (dir === 0) return { x: along, z: center + 3.5 };
  if (dir === 1) return { x: center - 3.5, z: along };
  if (dir === 2) return { x: along, z: center - 3.5 };
  return { x: center + 3.5, z: along };
}

function TrafficCar({ seed, kind, hue }: { seed: number; kind: VehicleKind; hue: number }) {
  const body = useRef<RapierRigidBody>(null);
  const model = useMemo(() => makeVehicle(kind, hue, true), [kind, hue]);
  const spec = SPEC[kind === 'taxi' || kind === 'police' ? 'sedan' : kind === 'ambulance' ? 'van' : kind] || SPEC.sedan;

  const agent = useRef<Agent>({
    dir: 0, center: 0, along: 0, cruise: 12, speed: 0, kind, len: spec.L
  });

  const respawn = () => {
    const a = agent.current;
    const ang = Math.random() * Math.PI * 2;
    const d = 60 + Math.random() * 170;
    const axisX = Math.random() < 0.5;
    a.dir = axisX ? (Math.random() < 0.5 ? 0 : 2) : Math.random() < 0.5 ? 1 : 3;
    const px = playerPos.x + Math.cos(ang) * d;
    const pz = playerPos.z + Math.sin(ang) * d;
    if (axisX) { a.center = Math.round(pz / CELL) * CELL; a.along = px; }
    else { a.center = Math.round(px / CELL) * CELL; a.along = pz; }
    a.cruise = 10 + Math.random() * 7;
    a.speed = a.cruise;
    const p = laneOf(a.dir, a.center, a.along);
    body.current?.setTranslation({ x: p.x, y: heightAt(p.x, p.z) + 1.2, z: p.z }, true);
    body.current?.setLinvel({ x: 0, y: 0, z: 0 }, true);
    body.current?.setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), DIR_YAW[a.dir]), true);
  };

  useEffect(() => { respawn(); }, []);

  useFrame((_, delta) => {
    const rb = body.current;
    if (!rb) return;
    const a = agent.current;
    const dt = Math.min(delta, 0.05);
    const sgn = a.dir === 0 || a.dir === 1 ? 1 : -1;
    const axisX = a.dir === 0 || a.dir === 2;
    const t = rb.translation();

    // the body may have been shoved off its lane: read the real position back
    a.along = axisX ? t.x : t.z;

    let want = a.cruise;
    const node = sgn > 0 ? Math.ceil(a.along / CELL) * CELL : Math.floor(a.along / CELL) * CELL;
    const toNode = Math.abs(node - a.along);
    if (toNode < 34) {
      const nx = axisX ? node : a.center;
      const nz = axisX ? a.center : node;
      const clock = useGame.getState().clock * 60;
      const st = signalState(seed, nx, nz, axisX, clock);
      if (st !== 2 && !(st === 1 && toNode < 12 && a.speed > 9)) {
        want = Math.min(want, Math.max(0, (toNode - 9.5) * 0.75));
      }
    }

    const dx = playerPos.x - t.x;
    const dz = playerPos.z - t.z;
    const rel = axisX ? dx * sgn : dz * sgn;
    const dist = Math.hypot(dx, dz);
    if (rel > 0 && rel < 13 && dist < 15) want = Math.min(want, Math.max(0, (rel - 5) * 0.9));

    a.speed += (want - a.speed) * Math.min(1, dt * (want < a.speed ? 5 : 2));

    // steer back to the lane centre with a velocity nudge, never by teleporting
    const target = laneOf(a.dir, a.center, a.along);
    const lateral = axisX ? target.z - t.z : target.x - t.x;
    const vel = rb.linvel();
    const drive = {
      x: axisX ? sgn * a.speed : THREE.MathUtils.clamp(lateral * 2.2, -6, 6),
      y: vel.y,
      z: axisX ? THREE.MathUtils.clamp(lateral * 2.2, -6, 6) : sgn * a.speed
    };
    rb.setLinvel(drive, true);

    // keep it pointing down its lane unless it is being pushed around
    const q = rb.rotation();
    const cur = new THREE.Quaternion(q.x, q.y, q.z, q.w);
    const aim = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), DIR_YAW[a.dir]);
    cur.slerp(aim, 1 - Math.pow(0.02, dt));
    rb.setRotation(cur, true);

    model.position.set(t.x, t.y - spec.wr - 0.05, t.z);
    model.quaternion.copy(cur);
    if (model.wheels) {
      for (const w of model.wheels) w.rotation.x += (a.speed * dt) / spec.wr;
    }

    if (dist > 230 || t.y < heightAt(t.x, t.z) - 12) respawn();
  });

  return (
    <>
      <RigidBody
        ref={body}
        colliders={false}
        mass={kind === 'bus' ? 9000 : 1250}
        linearDamping={0.4}
        angularDamping={2}
        canSleep={false}
      >
        <CuboidCollider args={[spec.W / 2, 0.7, spec.L / 2]} position={[0, 0, 0]} friction={0.7} />
      </RigidBody>
      <primitive object={model} />
    </>
  );
}
