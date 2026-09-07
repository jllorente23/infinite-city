'use client';

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { CuboidCollider, RapierRigidBody, RigidBody, useBeforePhysicsStep, useRapier } from '@react-three/rapier';
import { makeChassis, makeWheel } from './vehicles';
import { useCityCars } from './carModels';
import { controls, playerPos, useGame } from './store';
import { CELL, STREET } from './config';
import { heightAt } from './rng';
import { blockTypeAt, roadHeightAt } from './city';
import { burstSparks } from './Sparks';
import { stampSkid } from './SkidMarks';
import { trafficHit } from './Traffic';

const MASS = 1150;
const ENGINE = 3600;
const BRAKE_FORCE = 125;
const MAX_STEER = 0.55;
/** Held throttle winds this up: the longer you keep the pedal down, the
 *  higher the ceiling. 26 m/s is a city cruise; full wind-up is ~60 m/s. */
const CRUISE_SPEED = 26;
const BOOST_SPEED = 34;
const REST_LEN = 0.42;
const MAX_TRAVEL = 0.25;
/** How far the springs settle under the car's own weight. Subtracted from the
 *  wheel anchors so a parked car has its wheels exactly inside the arches. */
const STATIC_SAG = 0.1;
/** Spawn at settled suspension height instead of dropping a metre onto it. */
const START_CLEARANCE = 0.12;
/** Top of the hull collider. The bottom comes from the model's ride height. */
const HULL_TOP = 1.6;
/** Centre of mass above the contact patch. Keep it low or hard braking flips the car. */
const COM_HEIGHT = 0.45;
/** Roll is the axis that tips the car over, so give it more inertia than a box would have. */
const ROLL_INERTIA_BOOST = 2.8;

/**
 * A real raycast vehicle: Rapier casts one ray per wheel and applies suspension
 * and tyre forces to the chassis body, so kerbs, ramps, slopes and shunts all
 * come out of the simulation instead of being faked.
 *
 * The body origin sits on the contact patch, which is also the model's own y=0,
 * so the hull collider, the wheels and the mesh all line up without offsets.
 */
export function Car() {
  useCityCars();
  const body = useRef<RapierRigidBody>(null);
  const { world } = useRapier();
  const { camera } = useThree();
  const setHud = useGame((s) => s.setHud);

  const { chassis, spec, wheels, hull, spots, fill } = useMemo(() => {
    const g = makeChassis('jeep', 0x6f7f4a);
    const s = g.spec!;
    const w = [0, 1, 2, 3].map(() => {
      const mesh = makeWheel(s.wr, s.wr * 0.62, false);
      g.add(mesh);
      return mesh;
    });
    g.traverse((o: any) => { if (o.isMesh) o.castShadow = true; });
    const mkSpot = (x: number) => {
      const light = new THREE.SpotLight(0xfff1c4, 0, 44, 0.42, 0.58, 1.25);
      light.position.set(x, 0.9, -2.08);
      light.target.position.set(x * 0.18, -0.2, -22);
      g.add(light);
      g.add(light.target);
      return light;
    };
    const spots = [mkSpot(-0.62), mkSpot(0.62)];
    const fill = new THREE.PointLight(0xffe4b0, 0, 10, 1.8);
    fill.position.set(0, 0.72, -2.15);
    g.add(fill);
    const halfY = (HULL_TOP - s.bottom) / 2;
    const h = {
      half: [s.W / 2, halfY, (s.L * 0.92) / 2] as [number, number, number],
      centre: (HULL_TOP + s.bottom) / 2
    };
    return { chassis: g, spec: s, wheels: w, hull: h, spots, fill };
  }, []);

  /** Mass sits low and resists roll, instead of being spread through the hull box. */
  const massProperties = useMemo(() => {
    const [hx, hy, hz] = hull.half;
    const w = hx * 2, h = hy * 2, d = hz * 2;
    return {
      mass: MASS,
      // expressed in the collider's own frame
      centerOfMass: { x: 0, y: COM_HEIGHT - hull.centre, z: 0 },
      principalAngularInertia: {
        x: (MASS * (h * h + d * d)) / 12,
        y: (MASS * (w * w + d * d)) / 12,
        z: ((MASS * (w * w + h * h)) / 12) * ROLL_INERTIA_BOOST
      },
      angularInertiaLocalFrame: { x: 0, y: 0, z: 0, w: 1 }
    };
  }, [hull]);

  const controller = useRef<any>(null);
  const camPos = useRef(new THREE.Vector3(0, 8, 14));
  const fwd = useMemo(() => new THREE.Vector3(), []);
  const up = useMemo(() => new THREE.Vector3(), []);
  const goal = useMemo(() => new THREE.Vector3(), []);
  const lookGoal = useMemo(() => new THREE.Vector3(), []);
  const bodyQuat = useMemo(() => new THREE.Quaternion(), []);
  const lookAtPos = useRef(new THREE.Vector3(0, 1.2, -5));
  const spin = useRef(0);
  const flipped = useRef(0);
  const sparkCd = useRef(0);
  const boost = useRef(0);
  const skidCd = useRef(0);

  useEffect(() => {
    if (!body.current) return;
    const c = world.createVehicleController(body.current);
    const zF = spec.arches[0].x - spec.L / 2;
    const zR = spec.arches[1].x - spec.L / 2;
    const ht = spec.W / 2 - spec.wr * 0.32;
    // Anchors sit a full wheel radius plus spring above the contact patch, so the
    // downward ray always starts above the road even with the springs compressed.
    const anchorY = spec.wr + REST_LEN - STATIC_SAG;
    const points = [
      { x: -ht, y: anchorY, z: zF },
      { x: ht, y: anchorY, z: zF },
      { x: -ht, y: anchorY, z: zR },
      { x: ht, y: anchorY, z: zR }
    ];
    for (const p of points) {
      c.addWheel(p, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, REST_LEN, spec.wr);
    }
    for (let i = 0; i < 4; i++) {
      c.setWheelSuspensionStiffness(i, 38);
      c.setWheelMaxSuspensionTravel(i, MAX_TRAVEL);
      c.setWheelSuspensionCompression(i, 2.4);
      c.setWheelSuspensionRelaxation(i, 3.2);
      c.setWheelFrictionSlip(i, 2.4);
      c.setWheelSideFrictionStiffness(i, i < 2 ? 1.0 : 0.75);
      c.setWheelMaxSuspensionForce(i, 60000);
    }
    controller.current = c;
    return () => {
      controller.current = null;
      world.removeVehicleController(c);
    };
  }, [world, spec]);

  /** Forward speed straight from the body: Rapier's own reading is signed against
   *  its +Z forward axis, while the model faces -Z. */
  const forwardSpeed = () => {
    const rb = body.current;
    if (!rb) return 0;
    const r = rb.rotation();
    fwd.set(0, 0, -1).applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w));
    const v = rb.linvel();
    return v.x * fwd.x + v.y * fwd.y + v.z * fwd.z;
  };

  useBeforePhysicsStep(() => {
    const c = controller.current;
    if (!c) return;
    const speed = forwardSpeed();
    const steerLimit = MAX_STEER * (1 - Math.min(0.55, Math.abs(speed) / 42));
    const steer = controls.steer * steerLimit;
    c.setWheelSteering(0, steer);
    c.setWheelSteering(1, steer);

    // the brake pedal doubles as reverse once the car has stopped
    const reversing = controls.brake > 0 && speed < 0.8;
    const dt = 1 / 60;
    if (controls.throttle > 0.15 && !reversing) {
      boost.current = Math.min(1, boost.current + dt / 5.2);
    } else {
      boost.current = Math.max(0, boost.current - dt / 1.6);
    }
    const top = CRUISE_SPEED + boost.current * BOOST_SPEED;
    const power = ENGINE * (0.82 + boost.current * 1.45);
    const taper = Math.max(0.1, 1 - Math.max(0, speed) / top);
    const drive = controls.throttle * power * taper - (reversing ? ENGINE * 0.45 : 0);
    // negated because the model's nose points down -Z
    c.setWheelEngineForce(2, -drive);
    c.setWheelEngineForce(3, -drive);
    const rolling = Math.abs(speed) > 0.3;
    const brake = controls.brake > 0
      ? (reversing ? 0 : BRAKE_FORCE)
      : controls.throttle > 0 ? 0 : rolling ? 18 : 28;
    for (let i = 0; i < 4; i++) c.setWheelBrake(i, brake);

    c.updateVehicle(world.timestep);
  });

  useFrame((_, delta) => {
    const c = controller.current;
    const rb = body.current;
    if (!c || !rb) return;

    const t = rb.translation();
    const r = rb.rotation();
    const visualAlpha = 1 - Math.exp(-delta * 28);
    goal.set(t.x, t.y, t.z);
    chassis.position.lerp(goal, visualAlpha);
    bodyQuat.set(r.x, r.y, r.z, r.w);
    chassis.quaternion.slerp(bodyQuat, visualAlpha);

    const speed = forwardSpeed();
    // rolling backwards about +X carries the car towards -Z, which is forwards here
    spin.current -= (speed * delta) / spec.wr;
    for (let i = 0; i < 4; i++) {
      const conn = c.wheelChassisConnectionPointCs(i);
      if (!conn) continue;
      const len = c.wheelSuspensionLength(i) ?? REST_LEN;
      const st = c.wheelSteering(i) ?? 0;
      wheels[i].position.set(conn.x, conn.y - len, conn.z);
      wheels[i].rotation.set(spin.current, i < 2 ? st : 0, 0, 'YXZ');
    }

    // Safety net. Without this a hard landing can punch the hull through the road
    // surface, and once the wheel rays start underground nothing can recover.
    // Over a canal basin the "ground" height is the missing street, so snapping
    // there would bounce the car above the water forever.
    up.set(0, 1, 0).applyQuaternion(chassis.quaternion);
    flipped.current = up.y < 0.25 ? flipped.current + delta : 0;
    const seed = useGame.getState().seed;
    const gy = roadHeightAt(seed, t.x, t.z);
    const wet = blockTypeAt(seed, Math.floor(t.x / CELL), Math.floor(t.z / CELL)) === 'canal';
    // If the jeep finds a hole in a canal cell, put it back on the nearest
    // street instead of snapping into the water.
    const fellThrough = t.y < gy - 0.35;
    if (fellThrough || flipped.current > 1.5) {
      const yaw = Math.atan2(-fwd.x, -fwd.z);
      let sx = t.x, sz = t.z;
      if (wet) {
        const lx = ((t.x % CELL) + CELL) % CELL;
        const lz = ((t.z % CELL) + CELL) % CELL;
        const ox = t.x - lx, oz = t.z - lz;
        const choices = [
          { x: ox + STREET / 4, z: t.z },
          { x: ox + CELL - STREET / 4, z: t.z },
          { x: t.x, z: oz + STREET / 4 },
          { x: t.x, z: oz + CELL - STREET / 4 }
        ];
        let best = choices[0], bestD = Infinity;
        for (const c of choices) {
          const d = Math.hypot(c.x - t.x, c.z - t.z);
          if (d < bestD) { best = c; bestD = d; }
        }
        sx = best.x; sz = best.z;
      }
      rb.setTranslation({ x: sx, y: roadHeightAt(seed, sx, sz) + START_CLEARANCE + 0.25, z: sz }, true);
      rb.setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), true);
      rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
      rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
      flipped.current = 0;
    }

    skidCd.current -= delta;
    const braking = controls.brake > 0 && Math.abs(speed) > 5.2 && !(controls.brake > 0 && speed < 0.8);
    if (braking && skidCd.current <= 0) {
      const yaw = Math.atan2(-fwd.x, -fwd.z);
      const rx = -fwd.z, rz = fwd.x;
      const hx = spec.W * 0.36;
      const hz = spec.L * 0.3;
      const y = roadHeightAt(seed, t.x, t.z) + 0.04;
      stampSkid(t.x + rx * hx - fwd.x * hz, y, t.z + rz * hx - fwd.z * hz, yaw);
      stampSkid(t.x - rx * hx - fwd.x * hz, y, t.z - rz * hx - fwd.z * hz, yaw);
      skidCd.current = Math.max(0.035, 0.085 - Math.abs(speed) * 0.0018);
    }

    sparkCd.current -= delta;
    if (sparkCd.current <= 0 && Math.abs(speed) > 3.2) {
      const hit = trafficHit(t.x, t.z, spec.L * 0.46 + 0.55);
      if (hit) {
        burstSparks(t.x, t.y + 0.38, t.z, fwd.x * speed, fwd.z * speed);
        sparkCd.current = 0.09;
      }
    }

    playerPos.x = t.x; playerPos.y = t.y; playerPos.z = t.z;
    playerPos.heading = Math.atan2(-fwd.x, -fwd.z);

    const back = 10.5 - Math.min(3.5, Math.abs(speed) / 8);
    goal.set(t.x - fwd.x * back, 0, t.z - fwd.z * back);
    goal.y = Math.max(heightAt(goal.x, goal.z), t.y - 1) + 4.6;
    camPos.current.lerp(goal, 1 - Math.pow(0.0015, delta));
    camera.position.copy(camPos.current);
    lookGoal.set(t.x + fwd.x * 5, t.y + 1.2, t.z + fwd.z * 5);
    lookAtPos.current.lerp(lookGoal, 1 - Math.pow(0.0004, delta));
    camera.lookAt(lookAtPos.current);

    const night = useGame.getState().night;
    const beams = night > 0.18 ? night : 0;
    spots[0].intensity = beams * 42;
    spots[1].intensity = beams * 42;
    fill.intensity = beams * 5.5;

    setHud({ speed: Math.round(Math.abs(speed) * 3.6) });
  });

  return (
    <>
      <RigidBody
        ref={body}
        colliders={false}
        position={[0, heightAt(0, 0) + START_CLEARANCE, 0]}
        linearDamping={0.05}
        angularDamping={0.6}
        canSleep={false}
        ccd
      >
        <CuboidCollider
          args={hull.half}
          position={[0, hull.centre, 0]}
          friction={0.6}
          restitution={0.05}
          massProperties={massProperties}
        />
      </RigidBody>
      <primitive object={chassis} />
    </>
  );
}
