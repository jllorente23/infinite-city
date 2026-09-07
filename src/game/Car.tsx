'use client';

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { CuboidCollider, RapierRigidBody, RigidBody, useBeforePhysicsStep, useRapier } from '@react-three/rapier';
import { makeChassis, makeWheel } from './vehicles';
import { controls, playerPos, useGame } from './store';
import { CELL } from './config';
import { heightAt, isInsideBlock } from './rng';
import { blockTypeAt } from './city';

const MASS = 1150;
const ENGINE = 3400;
const BRAKE_FORCE = 110;
const MAX_STEER = 0.55;
/** Engine force fades to nothing here, which is what caps the top speed. */
const TOP_SPEED = 30;
const REST_LEN = 0.42;
const MAX_TRAVEL = 0.25;
/** How far the springs settle under the car's own weight. Subtracted from the
 *  wheel anchors so a parked car has its wheels exactly inside the arches. */
const STATIC_SAG = 0.1;
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
  const body = useRef<RapierRigidBody>(null);
  const { world } = useRapier();
  const { camera } = useThree();
  const setHud = useGame((s) => s.setHud);

  const { chassis, spec, wheels, hull } = useMemo(() => {
    const g = makeChassis('jeep', 0x6f7f4a);
    const s = g.spec!;
    const w = [0, 1, 2, 3].map(() => {
      const mesh = makeWheel(s.wr, s.wr * 0.62, false);
      g.add(mesh);
      return mesh;
    });
    g.traverse((o: any) => { if (o.isMesh) o.castShadow = true; });
    const halfY = (HULL_TOP - s.bottom) / 2;
    const h = {
      half: [s.W / 2, halfY, (s.L * 0.92) / 2] as [number, number, number],
      centre: (HULL_TOP + s.bottom) / 2
    };
    return { chassis: g, spec: s, wheels: w, hull: h };
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
  const spin = useRef(0);
  const flipped = useRef(0);

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
      c.setWheelSuspensionStiffness(i, 48);
      c.setWheelMaxSuspensionTravel(i, MAX_TRAVEL);
      c.setWheelSuspensionCompression(i, 1.6);
      c.setWheelSuspensionRelaxation(i, 2.2);
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
    const taper = Math.max(0, 1 - Math.max(0, speed) / TOP_SPEED);
    const drive = controls.throttle * ENGINE * taper - (reversing ? ENGINE * 0.45 : 0);
    // negated because the model's nose points down -Z
    c.setWheelEngineForce(2, -drive);
    c.setWheelEngineForce(3, -drive);
    const rolling = Math.abs(speed) > 0.3;
    const brake = controls.brake > 0
      ? (reversing ? 0 : BRAKE_FORCE)
      : controls.throttle > 0 ? 0 : rolling ? 9 : 0;
    for (let i = 0; i < 4; i++) c.setWheelBrake(i, brake);

    c.updateVehicle(world.timestep);
  });

  useFrame((_, delta) => {
    const c = controller.current;
    const rb = body.current;
    if (!c || !rb) return;

    const t = rb.translation();
    const r = rb.rotation();
    chassis.position.set(t.x, t.y, t.z);
    chassis.quaternion.set(r.x, r.y, r.z, r.w);

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
    const gy = heightAt(t.x, t.z);
    const inBasin = isInsideBlock(t.x, t.z) &&
      blockTypeAt(useGame.getState().seed, Math.floor(t.x / CELL), Math.floor(t.z / CELL)) === 'canal';
    if (!inBasin && (t.y < gy - 0.4 || flipped.current > 1.5)) {
      const yaw = Math.atan2(-fwd.x, -fwd.z);
      rb.setTranslation({ x: t.x, y: gy + 0.6, z: t.z }, true);
      rb.setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), true);
      rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
      rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
      flipped.current = 0;
    }

    playerPos.x = t.x; playerPos.y = t.y; playerPos.z = t.z;
    playerPos.heading = Math.atan2(-fwd.x, -fwd.z);

    const back = 10.5 - Math.min(3.5, Math.abs(speed) / 8);
    goal.set(t.x - fwd.x * back, 0, t.z - fwd.z * back);
    goal.y = Math.max(heightAt(goal.x, goal.z), t.y - 1) + 4.6;
    camPos.current.lerp(goal, 1 - Math.pow(0.0015, delta));
    camera.position.copy(camPos.current);
    camera.lookAt(t.x + fwd.x * 5, t.y + 1.2, t.z + fwd.z * 5);

    setHud({ speed: Math.round(Math.abs(speed) * 3.6) });
  });

  return (
    <>
      <RigidBody
        ref={body}
        colliders={false}
        position={[0, heightAt(0, 0) + 1, 0]}
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
