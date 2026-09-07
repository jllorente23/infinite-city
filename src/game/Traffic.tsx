'use client';

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { RapierRigidBody, RigidBody, CuboidCollider } from '@react-three/rapier';
import { CELL, HW_INNER, HW_OUTER } from './config';
import { heightAt } from './rng';
import { makeVehicle, pickHue, specOf, vehicleHeight, VehicleKind } from './vehicles';
import { playerPos, qualityOf, useGame } from './store';
import { signalState } from './signals';
import { useCityCars } from './carModels';
import { isCanalCol, isCanalRow, isHwyCol, isHwyRow } from './city';

const KINDS: VehicleKind[] = ['sedan', 'sedan', 'suv', 'taxi', 'pickup', 'van', 'bus', 'police', 'ambulance'];
const DIR_YAW = [-Math.PI / 2, Math.PI, Math.PI / 2, 0];
const LEFT_OF = [1, 2, 3, 0];
const RIGHT_OF = [3, 0, 1, 2];
/** Offset from the street centreline to a lane centreline. */
const LANE = 3.5;
/** Bumper to bumper distance a car will not close in on. */
const MIN_GAP = 4.6;
/** Comfortable deceleration, which sets how early a car starts slowing. */
const BRAKE = 7;
/** Where a car waits on red, measured from the middle of the junction. */
const STOP_LINE = 8.5;
/** Start of the turn bezier, measured from the junction centre. */
const TURN_IN = 7;

const UP = new THREE.Vector3(0, 1, 0);
const _slope = new THREE.Vector3();
const _qTilt = new THREE.Quaternion();
const _qYaw = new THREE.Quaternion();
const _rot = new THREE.Quaternion();
const _pos = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _world = { x: 0, z: 0 };
const _other = { x: 0, z: 0 };

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
  lane: number;
  hwy: boolean;
};

/** Every car currently on the road, so each one can see the one in front. */
const agents = new Set<Agent>();

/** Directions 0 and 2 run along X, 1 and 3 along Z. */
const runsAlongX = (dir: number) => dir === 0 || dir === 2;
const headingSign = (dir: number) => (dir === 0 || dir === 1 ? 1 : -1);

function laneOf(dir: number, center: number, along: number, lane = LANE) {
  if (dir === 0) return { x: along, z: center + lane };
  if (dir === 1) return { x: center - lane, z: along };
  if (dir === 2) return { x: along, z: center - lane };
  return { x: center + lane, z: along };
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
function aheadOfPlayer(x: number, z: number) {
  const hx = -Math.sin(playerPos.heading);
  const hz = -Math.cos(playerPos.heading);
  return (x - playerPos.x) * hx + (z - playerPos.z) * hz > -6;
}

function shouldRecycle(x: number, z: number) {
  const d = Math.hypot(x - playerPos.x, z - playerPos.z);
  const q = qualityOf(useGame.getState().quality);
  const fogEdge = (q.loadRadius + 0.8) * CELL;
  // Ahead/side traffic survives until it is behind the fog. Cars behind the
  // camera can be recycled sooner without producing a visible pop.
  if (d > fogEdge + 35) return true;
  if (d > Math.max(270, fogEdge * 0.82) && !aheadOfPlayer(x, z)) return true;
  return false;
}

export function Traffic() {
  useCityCars();
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

function agentWorld(a: Agent, out: { x: number; z: number }) {
  if (a.arc) {
    bezier2(_pos, a.arc.p0, a.arc.p1, a.arc.p2, a.arc.t);
    out.x = _pos.x;
    out.z = _pos.z;
  } else {
    const p = laneOf(a.dir, a.center, a.along, a.lane);
    out.x = p.x;
    out.z = p.z;
  }
  return out;
}

/** Anyone ahead in world space, including cars mid-turn, not just the same lane. */
function nearestThreat(self: Agent) {
  agentWorld(self, _world);
  const yaw = self.arc ? lerpAngle(self.arc.yaw0, self.arc.yaw1, self.arc.t) : DIR_YAW[self.dir];
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  let bestGap = Infinity;
  let leadSpeed = 0;
  for (const other of agents) {
    if (other === self || !other.live) continue;
    agentWorld(other, _other);
    const dx = _other.x - _world.x;
    const dz = _other.z - _world.z;
    const dist = Math.hypot(dx, dz);
    const need = (self.len + other.len) / 2 + MIN_GAP + 8;
    if (dist > need) continue;
    const ahead = dx * fx + dz * fz;
    if (ahead < -0.5) continue;
    const lateral = Math.abs(dx * -fz + dz * fx);
    if (lateral > 4.2 && !other.arc && !self.arc) continue;
    const gap = dist - (self.len + other.len) / 2;
    if (gap < bestGap) {
      bestGap = gap;
      leadSpeed = other.speed;
    }
  }
  return bestGap < Infinity ? { gap: bestGap, speed: leadSpeed } : null;
}

/**
 * Tilt from the four corners of the wheelbase so a sloped street does not
 * leave the car flat with two wheels in the air.
 */
function poseOnGround(x: number, z: number, yaw: number, halfL: number, halfW: number, out: THREE.Quaternion) {
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  const yF = heightAt(x + fx * halfL, z + fz * halfL);
  const yB = heightAt(x - fx * halfL, z - fz * halfL);
  const yR = heightAt(x + rx * halfW, z + rz * halfW);
  const yL = heightAt(x - rx * halfW, z - rz * halfW);
  _fwd.set(fx * 2 * halfL, yF - yB, fz * 2 * halfL);
  _right.set(rx * 2 * halfW, yR - yL, rz * 2 * halfW);
  _slope.crossVectors(_right, _fwd);
  if (_slope.y < 0) _slope.negate();
  _slope.normalize();
  _qTilt.setFromUnitVectors(UP, _slope);
  _qYaw.setFromAxisAngle(UP, yaw);
  out.copy(_qTilt).multiply(_qYaw);
  return (yF + yB + yR + yL) * 0.25;
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
    dir: 0, center: 0, along: 0, cruise: 12, speed: 0, len: spec.L, live: false, plan: null, arc: null, lane: LANE, hwy: false
  });

  const spin = useRef(0);

  /** Drop the car back onto a random lane near the player, clear of other traffic. */
  const respawn = () => {
    const a = agent.current;
    a.arc = null;
    a.plan = null;
    const adopt = (dir: number, center: number, along: number, lane: number, hwy: boolean, cruise: number) => {
      a.dir = dir;
      a.center = center;
      a.along = along;
      a.lane = lane;
      a.hwy = hwy;
      a.cruise = cruise;
      a.speed = cruise;
      a.live = true;
      place(true);
    };
    const blocked = (probe: { x: number; z: number }) => {
      for (const other of agents) {
        if (other === a || !other.live) continue;
        agentWorld(other, _other);
        if (Math.hypot(probe.x - _other.x, probe.z - _other.z) < other.len + a.len + MIN_GAP) return true;
      }
      return false;
    };

    for (let attempt = 0; attempt < 16; attempt++) {
      const behind = playerPos.heading + Math.PI + (Math.random() - 0.5) * 2.2;
      const side = playerPos.heading + (Math.random() < 0.5 ? 1 : -1) * (1.05 + Math.random() * 0.7);
      const ang = attempt % 3 === 0 ? side : behind;
      const d = 100 + Math.random() * 150;
      const px = playerPos.x + Math.cos(ang) * d;
      const pz = playerPos.z + Math.sin(ang) * d;
      const wantHwy = attempt < 6;
      let dir = 0, center = 0, along = 0, lane = LANE, hwy = false;

      if (wantHwy) {
        const ci = Math.round(px / CELL);
        const cj = Math.round(pz / CELL);
        let found = false;
        for (let off = -3; off <= 3 && !found; off++) {
          if (isHwyCol(seed, ci + off) && !isCanalCol(seed, ci + off)) {
            dir = Math.random() < 0.5 ? 1 : 3;
            center = (ci + off) * CELL + CELL / 2;
            along = pz;
            lane = Math.random() < 0.5 ? HW_INNER : HW_OUTER;
            hwy = true;
            found = true;
          } else if (isHwyRow(seed, cj + off) && !isCanalRow(seed, cj + off)) {
            dir = Math.random() < 0.5 ? 0 : 2;
            center = (cj + off) * CELL + CELL / 2;
            along = px;
            lane = Math.random() < 0.5 ? HW_INNER : HW_OUTER;
            hwy = true;
            found = true;
          }
        }
        if (!found) continue;
      } else {
        const alongX = Math.random() < 0.5;
        dir = alongX ? (Math.random() < 0.5 ? 0 : 2) : Math.random() < 0.5 ? 1 : 3;
        center = Math.round((alongX ? pz : px) / CELL) * CELL;
        along = alongX ? px : pz;
        lane = LANE;
        hwy = false;
      }

      const probe = laneOf(dir, center, along, lane);
      if (blocked(probe)) continue;
      if (d < 160 && aheadOfPlayer(probe.x, probe.z)) continue;

      adopt(dir, center, along, lane, hwy, hwy ? 16 + Math.random() * 8 : 10 + Math.random() * 7);
      return;
    }
    a.live = false;
  };

  const placeAt = (x: number, z: number, yaw: number, snap = false) => {
    const y = poseOnGround(x, z, yaw, spec.L * 0.42, spec.W * 0.42, _rot);
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
    const p = laneOf(a.dir, a.center, a.along, a.lane);
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
        : laneOf(a.dir, a.center, a.along, a.lane);
      if (shouldRecycle(here.x, here.z)) respawn();
      return;
    }

    const sgn = headingSign(a.dir);
    const alongX = runsAlongX(a.dir);
    const here = laneOf(a.dir, a.center, a.along, a.lane);

    let want = a.cruise;
    let room = Infinity;
    let roomSpeed = 0;

    const hold = (distance: number, speed = 0) => {
      want = Math.min(want, approachSpeed(distance, speed));
      if (distance < room) { room = distance; roomSpeed = speed; }
    };

    if (!a.hwy) {
      const node = sgn > 0 ? Math.ceil(a.along / CELL) * CELL : Math.floor(a.along / CELL) * CELL;
      const toNode = Math.abs(node - a.along);
      if (toNode < 42) {
        const nx = alongX ? node : a.center;
        const nz = alongX ? a.center : node;
        const clock = useGame.getState().clock;
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
    } else {
      a.plan = 'straight';
    }

    const lead = nearestThreat(a);
    if (lead) hold(lead.gap - MIN_GAP, lead.speed);

    const dx = playerPos.x - here.x;
    const dz = playerPos.z - here.z;
    const ahead = (alongX ? dx : dz) * sgn;
    const lateral = Math.abs(alongX ? dz : dx);
    if (ahead > 0 && ahead < 24 && lateral < 3.4) hold(ahead - 6);

    a.speed += (want - a.speed) * Math.min(1, dt * (want < a.speed ? 7 : 2.2));
    a.speed = Math.max(0, a.speed);
    // Never teleport an overlap away: that pop was visible at junctions.
    // Holding still lets the leading car open the gap naturally.
    if (room < -2) {
      a.speed = 0;
      place();
      return;
    }
    const move = Math.min(a.speed * dt, Math.max(0, room));
    if (move < a.speed * dt) a.speed = Math.min(a.speed, Math.max(0, roomSpeed));
    a.along += sgn * move;
    place();

    spin.current -= (a.speed * dt) / spec.wr;
    if (model.wheels) for (const w of model.wheels) w.rotation.x = spin.current;

    if (shouldRecycle(here.x, here.z)) respawn();
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
