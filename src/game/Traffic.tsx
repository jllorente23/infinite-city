'use client';

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { RapierRigidBody, RigidBody, CuboidCollider } from '@react-three/rapier';
import { CELL } from './config';
import { heightAt, slopeNormal } from './rng';
import { makeVehicle, pickHue, specOf, vehicleHeight, VehicleKind } from './vehicles';
import { playerPos, qualityOf, useGame } from './store';
import { signalState } from './signals';

const KINDS: VehicleKind[] = ['sedan', 'sedan', 'suv', 'taxi', 'pickup', 'van', 'bus', 'police', 'ambulance'];
const DIR_YAW = [-Math.PI / 2, Math.PI, Math.PI / 2, 0];
const LEFT_OF = [1, 2, 3, 0];
const RIGHT_OF = [3, 0, 1, 2];
/** Offset from the street centreline to a lane centreline. */
const LANE = 3.5;
/** Bumper to bumper distance a car will not close in on. */
const MIN_GAP = 3.2;
/** Comfortable deceleration, which sets how early a car starts slowing. */
const BRAKE = 7;
/** Where a car waits on red, measured from the middle of the junction. */
const STOP_LINE = 8.5;
/** Start of the turn bezier, measured from the junction centre. */
const TURN_IN = 7;

const UP = new THREE.Vector3(0, 1, 0);
const _n = { x: 0, y: 1, z: 0 };
const _slope = new THREE.Vector3();
const _qTilt = new THREE.Quaternion();
const _qYaw = new THREE.Quaternion();
const _rot = new THREE.Quaternion();
const _pos = new THREE.Vector3();

/**
 * Fastest speed from which the car can still stop in `distance` without closing
 * on something moving at `leadSpeed`. Braking to this every frame cannot collide.
 */
const approachSpeed = (distance: number, leadSpeed = 0) =>
  Math.sqrt(Math.max(0, leadSpeed * leadSpeed + 2 * BRAKE * distance));

type Turn = 'left' | 'straight' | 'right';

type Arc = {
  t: number;
  dur: number;
  p0: [number, number];
  p1: [number, number];
  p2: [number, number];
  yaw0: number;
  yaw1: number;
  toDir: number;
  toCenter: number;
  toAlong: number;
};

type Agent = {
  dir: number;
  center: number;
  along: number;
  cruise: number;
  speed: number;
  len: number;
  live: boolean;
  plan: Turn | null;
  arc: Arc | null;
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

/** Crossing of two axis-aligned lanes: the sharp corner a turn bends around. */
function laneCorner(fromDir: number, fromCenter: number, toDir: number, toCenter: number) {
  const a = laneOf(fromDir, fromCenter, 0);
  const b = laneOf(toDir, toCenter, 0);
  return runsAlongX(fromDir) ? { x: b.x, z: a.z } : { x: a.x, z: b.z };
}

function lerpAngle(a: number, b: number, t: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function bezier2(out: THREE.Vector3, p0: [number, number], p1: [number, number], p2: [number, number], t: number) {
  const u = 1 - t;
  out.set(
    u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
    0,
    u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]
  );
  return out;
}

/**
 * Traffic is a small finite-state driver, not an LLM: cruise, pick a turn at
 * the next light, wait for green, then follow a bezier through the junction.
 * Kinematic bodies stay on the pavement; the mesh is tilted to the slope so
 * the wheels do not hover on hills.
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
  if (self.arc) return null;
  let bestGap = Infinity;
  let leader: Agent | null = null;
  const sgn = headingSign(self.dir);
  for (const other of agents) {
    if (other === self || !other.live || other.arc) continue;
    if (other.dir !== self.dir || other.center !== self.center) continue;
    const ahead = (other.along - self.along) * sgn;
    if (ahead <= 0) continue;
    const gap = ahead - (self.len + other.len) / 2;
    if (gap < bestGap) { bestGap = gap; leader = other; }
  }
  return leader ? { gap: bestGap, speed: leader.speed } : null;
}

function poseOnGround(x: number, z: number, yaw: number, out: THREE.Quaternion) {
  slopeNormal(x, z, _n);
  _slope.set(_n.x, _n.y, _n.z);
  _qTilt.setFromUnitVectors(UP, _slope);
  _qYaw.setFromAxisAngle(UP, yaw);
  out.copy(_qTilt).multiply(_qYaw);
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
    dir: 0, center: 0, along: 0, cruise: 12, speed: 0, len: spec.L, live: false, plan: null, arc: null
  });

  const spin = useRef(0);

  /** Drop the car back onto a random lane near the player, clear of other traffic. */
  const respawn = () => {
    const a = agent.current;
    a.arc = null;
    a.plan = null;
    for (let attempt = 0; attempt < 12; attempt++) {
      const ang = Math.random() * Math.PI * 2;
      const d = 60 + Math.random() * 170;
      const alongX = Math.random() < 0.5;
      const dir = alongX ? (Math.random() < 0.5 ? 0 : 2) : Math.random() < 0.5 ? 1 : 3;
      const px = playerPos.x + Math.cos(ang) * d;
      const pz = playerPos.z + Math.sin(ang) * d;
      const center = Math.round((alongX ? pz : px) / CELL) * CELL;
      const along = alongX ? px : pz;

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
    a.live = false;
  };

  const placeAt = (x: number, z: number, yaw: number, snap = false) => {
    const y = heightAt(x, z);
    poseOnGround(x, z, yaw, _rot);
    if (snap) {
      body.current?.setTranslation({ x, y, z }, true);
      body.current?.setRotation(_rot, true);
    } else {
      body.current?.setNextKinematicTranslation({ x, y, z });
      body.current?.setNextKinematicRotation(_rot);
    }
    model.position.set(x, y, z);
    model.quaternion.copy(_rot);
  };

  const place = (snap = false) => {
    const a = agent.current;
    if (a.arc) {
      const t = a.arc.t;
      bezier2(_pos, a.arc.p0, a.arc.p1, a.arc.p2, t);
      placeAt(_pos.x, _pos.z, lerpAngle(a.arc.yaw0, a.arc.yaw1, t), snap);
      return;
    }
    const p = laneOf(a.dir, a.center, a.along);
    placeAt(p.x, p.z, DIR_YAW[a.dir], snap);
  };

  const beginTurn = (a: Agent, turn: 'left' | 'right', node: number) => {
    const from = a.dir;
    const to = turn === 'left' ? LEFT_OF[from] : RIGHT_OF[from];
    const fromSgn = headingSign(from);
    const toSgn = headingSign(to);
    const start = laneOf(from, a.center, node - fromSgn * TURN_IN);
    const endAlong = a.center + toSgn * TURN_IN;
    const end = laneOf(to, node, endAlong);
    const corner = laneCorner(from, a.center, to, node);
    const dist = Math.hypot(end.x - start.x, end.z - start.z);
    a.arc = {
      t: 0,
      dur: Math.max(1.1, dist / Math.max(4, a.cruise * 0.72)),
      p0: [start.x, start.z],
      p1: [corner.x, corner.z],
      p2: [end.x, end.z],
      yaw0: DIR_YAW[from],
      yaw1: DIR_YAW[to],
      toDir: to,
      toCenter: node,
      toAlong: endAlong
    };
    a.plan = null;
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

    if (a.arc) {
      a.arc.t += dt / a.arc.dur;
      if (a.arc.t >= 1) {
        a.dir = a.arc.toDir;
        a.center = a.arc.toCenter;
        a.along = a.arc.toAlong;
        a.speed = a.cruise * 0.7;
        a.arc = null;
      }
      place();
      spin.current -= (a.speed * dt) / spec.wr;
      if (model.wheels) for (const w of model.wheels) w.rotation.x = spin.current;
      const here = a.arc
        ? bezier2(_pos, a.arc.p0, a.arc.p1, a.arc.p2, a.arc.t)
        : laneOf(a.dir, a.center, a.along);
      if (Math.hypot(playerPos.x - here.x, playerPos.z - here.z) > 260) respawn();
      return;
    }

    const sgn = headingSign(a.dir);
    const alongX = runsAlongX(a.dir);
    const here = laneOf(a.dir, a.center, a.along);

    let want = a.cruise;
    let room = Infinity;
    let roomSpeed = 0;

    const hold = (distance: number, speed = 0) => {
      want = Math.min(want, approachSpeed(distance, speed));
      if (distance < room) { room = distance; roomSpeed = speed; }
    };

    const node = sgn > 0 ? Math.ceil(a.along / CELL) * CELL : Math.floor(a.along / CELL) * CELL;
    const toNode = Math.abs(node - a.along);
    if (toNode < 42) {
      const nx = alongX ? node : a.center;
      const nz = alongX ? a.center : node;
      const clock = useGame.getState().clock * 60;
      const st = signalState(seed, nx, nz, alongX, clock);
      const mayGo = st === 2 || (st === 1 && toNode < 12 && a.speed > 9);

      if (!a.plan && toNode < 28) {
        const r = Math.random();
        a.plan = r < 0.28 ? 'left' : r < 0.56 ? 'right' : 'straight';
      }
      if (!mayGo) hold(toNode - STOP_LINE);
      else if (a.plan && a.plan !== 'straight' && toNode < TURN_IN + 0.4) {
        beginTurn(a, a.plan, node);
        place();
        return;
      }
    } else {
      a.plan = null;
    }

    const lead = leaderAhead(a);
    if (lead) hold(lead.gap - MIN_GAP, lead.speed);

    const dx = playerPos.x - here.x;
    const dz = playerPos.z - here.z;
    const ahead = (alongX ? dx : dz) * sgn;
    const lateral = Math.abs(alongX ? dz : dx);
    if (ahead > 0 && ahead < 24 && lateral < 3.4) hold(ahead - 6);

    a.speed += (want - a.speed) * Math.min(1, dt * (want < a.speed ? 7 : 2.2));
    a.speed = Math.max(0, a.speed);
    // Never reverse: that was the "forward and back" twitch. A real overlap
    // respawns the car instead of shunting it down the lane.
    if (room < -2) { respawn(); return; }
    const move = Math.min(a.speed * dt, Math.max(0, room));
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
