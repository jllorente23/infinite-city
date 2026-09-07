'use client';

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { RapierRigidBody, RigidBody, CuboidCollider } from '@react-three/rapier';
import { CELL } from './config';
import { heightAt } from './rng';
import { makeVehicle, pickHue, specOf, vehicleHeight, VehicleKind } from './vehicles';
import { playerPos, qualityOf, useGame } from './store';
import { signalState } from './signals';

const KINDS: VehicleKind[] = ['sedan', 'sedan', 'suv', 'taxi', 'pickup', 'van', 'bus', 'police', 'ambulance'];
const DIR_YAW = [-Math.PI / 2, Math.PI, Math.PI / 2, 0];
/** Offset from the street centreline to a lane centreline. */
const LANE = 3.5;
/** Bumper to bumper distance a car will not close in on. */
const MIN_GAP = 3.2;
/** Comfortable deceleration, which sets how early a car starts slowing. */
const BRAKE = 7;
/** Where a car waits on red, measured from the middle of the junction. */
const STOP_LINE = 8.5;

/**
 * Fastest speed from which the car can still stop in `distance` without closing
 * on something moving at `leadSpeed`. Braking to this every frame cannot collide.
 */
const approachSpeed = (distance: number, leadSpeed = 0) =>
  Math.sqrt(Math.max(0, leadSpeed * leadSpeed + 2 * BRAKE * distance));

type Agent = {
  dir: number;
  center: number;
  along: number;
  cruise: number;
  speed: number;
  len: number;
  live: boolean;
};

/** Every car currently on the road, so each one can see the one in front. */
const agents = new Set<Agent>();

/** Directions 0 and 2 run along X, 1 and 3 along Z. */
const runsAlongX = (dir: number) => dir === 0 || dir === 2;
const headingSign = (dir: number) => (dir === 0 || dir === 1 ? 1 : -1);

function laneOf(dir: number, center: number, along: number) {
  if (dir === 0) return { x: along, z: center + LANE };
  if (dir === 1) return { x: center - LANE, z: along };
  if (dir === 2) return { x: along, z: center - LANE };
  return { x: center + LANE, z: along };
}

/**
 * Traffic follows the lane grid, stops at red and keeps its distance from the
 * car in front. The bodies are kinematic: the road cannot push them under and a
 * shunt cannot spin them, which is what used to bury them in the asphalt.
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

/** Nearest car ahead in the same lane, or null when the road is clear. */
function leaderAhead(self: Agent) {
  let bestGap = Infinity;
  let leader: Agent | null = null;
  const sgn = headingSign(self.dir);
  for (const other of agents) {
    if (other === self || !other.live) continue;
    if (other.dir !== self.dir || other.center !== self.center) continue;
    const ahead = (other.along - self.along) * sgn;
    if (ahead <= 0) continue;
    const gap = ahead - (self.len + other.len) / 2;
    if (gap < bestGap) { bestGap = gap; leader = other; }
  }
  return leader ? { gap: bestGap, speed: leader.speed } : null;
}

function TrafficCar({ seed, kind, hue }: { seed: number; kind: VehicleKind; hue: number }) {
  const body = useRef<RapierRigidBody>(null);
  const model = useMemo(() => makeVehicle(kind, hue, true), [kind, hue]);
  const spec = specOf(kind);

  const hull = useMemo(() => {
    const top = Math.max(vehicleHeight(kind), spec.bottom + 1);
    return {
      half: [spec.W / 2, (top - spec.bottom) / 2, spec.L / 2] as [number, number, number],
      centre: (top + spec.bottom) / 2
    };
  }, [kind, spec]);

  const agent = useRef<Agent>({
    dir: 0, center: 0, along: 0, cruise: 12, speed: 0, len: spec.L, live: false
  });

  const spin = useRef(0);

  /** Drop the car back onto a random lane near the player, clear of other traffic. */
  const respawn = () => {
    const a = agent.current;
    for (let attempt = 0; attempt < 12; attempt++) {
      const ang = Math.random() * Math.PI * 2;
      const d = 60 + Math.random() * 170;
      const alongX = Math.random() < 0.5;
      const dir = alongX ? (Math.random() < 0.5 ? 0 : 2) : Math.random() < 0.5 ? 1 : 3;
      const px = playerPos.x + Math.cos(ang) * d;
      const pz = playerPos.z + Math.sin(ang) * d;
      const center = Math.round((alongX ? pz : px) / CELL) * CELL;
      const along = alongX ? px : pz;

      // never materialise inside another car
      let clear = true;
      for (const other of agents) {
        if (other === a || !other.live) continue;
        if (other.dir !== dir || other.center !== center) continue;
        if (Math.abs(other.along - along) < other.len + a.len + MIN_GAP) { clear = false; break; }
      }
      if (!clear) continue;

      a.dir = dir;
      a.center = center;
      a.along = along;
      a.cruise = 10 + Math.random() * 7;
      a.speed = a.cruise;
      a.live = true;
      place(true);
      return;
    }
    // Every lane it tried was busy. Stay parked off duty and try again next frame
    // rather than materialising inside another car.
    a.live = false;
  };

  /** Push the agent's lane position onto the rigid body and the mesh. */
  const place = (snap = false) => {
    const a = agent.current;
    const p = laneOf(a.dir, a.center, a.along);
    const y = heightAt(p.x, p.z);
    const rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), DIR_YAW[a.dir]);
    if (snap) {
      // a respawn is a teleport, so it must not be interpolated from the old lane
      body.current?.setTranslation({ x: p.x, y, z: p.z }, true);
      body.current?.setRotation(rot, true);
    } else {
      body.current?.setNextKinematicTranslation({ x: p.x, y, z: p.z });
      body.current?.setNextKinematicRotation(rot);
    }
    model.position.set(p.x, y, p.z);
    model.rotation.set(0, DIR_YAW[a.dir], 0);
  };

  useEffect(() => {
    const a = agent.current;
    agents.add(a);
    respawn();
    return () => { a.live = false; agents.delete(a); };
  }, []);

  useFrame((_, delta) => {
    const a = agent.current;
    if (!a.live) { respawn(); return; }
    const dt = Math.min(delta, 0.05);
    const sgn = headingSign(a.dir);
    const alongX = runsAlongX(a.dir);
    const here = laneOf(a.dir, a.center, a.along);

    let want = a.cruise;
    // How much further down the lane the car may travel this frame, and the speed
    // it must already be doing on arrival. Enforced after integrating, so a car
    // can never end up inside whatever is in front of it.
    let room = Infinity;
    let roomSpeed = 0;

    const hold = (distance: number, speed = 0) => {
      want = Math.min(want, approachSpeed(distance, speed));
      if (distance < room) { room = distance; roomSpeed = speed; }
    };

    // red and amber lights at the next intersection
    const node = sgn > 0 ? Math.ceil(a.along / CELL) * CELL : Math.floor(a.along / CELL) * CELL;
    const toNode = Math.abs(node - a.along);
    if (toNode < 40) {
      const nx = alongX ? node : a.center;
      const nz = alongX ? a.center : node;
      const clock = useGame.getState().clock * 60;
      const st = signalState(seed, nx, nz, alongX, clock);
      const mayGo = st === 2 || (st === 1 && toNode < 12 && a.speed > 9);
      if (!mayGo) hold(toNode - STOP_LINE);
    }

    // keep a gap to the car in front instead of driving through it
    const lead = leaderAhead(a);
    if (lead) hold(lead.gap - MIN_GAP, lead.speed);

    // and treat the player's car as one more obstacle
    const dx = playerPos.x - here.x;
    const dz = playerPos.z - here.z;
    const ahead = (alongX ? dx : dz) * sgn;
    const lateral = Math.abs(alongX ? dz : dx);
    if (ahead > 0 && ahead < 24 && lateral < 3.4) hold(ahead - 6);

    a.speed += (want - a.speed) * Math.min(1, dt * (want < a.speed ? 7 : 2.2));
    a.speed = Math.max(0, a.speed);
    // Clamped to the room available, and allowed to ease backwards if something
    // already overlaps, so a bad spawn or a shunt untangles itself.
    const move = Math.min(a.speed * dt, Math.max(room, -6 * dt));
    if (move < a.speed * dt) a.speed = Math.min(a.speed, Math.max(0, roomSpeed));
    a.along += sgn * move;
    place();

    spin.current -= (a.speed * dt) / spec.wr;
    if (model.wheels) for (const w of model.wheels) w.rotation.x = spin.current;

    if (Math.hypot(playerPos.x - here.x, playerPos.z - here.z) > 260) respawn();
  });

  return (
    <>
      <RigidBody ref={body} type="kinematicPosition" colliders={false}>
        <CuboidCollider args={hull.half} position={[0, hull.centre, 0]} friction={0.7} />
      </RigidBody>
      <primitive object={model} />
    </>
  );
}
