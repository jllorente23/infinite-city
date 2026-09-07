'use client';

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { CuboidCollider, RapierRigidBody, RigidBody, useBeforePhysicsStep, useRapier } from '@react-three/rapier';
import { makeChassis, makeWheel } from './vehicles';
import { controls, playerPos, useGame } from './store';
import { heightAt } from './rng';

const ENGINE = 3400;
const BRAKE_FORCE = 110;
const MAX_STEER = 0.55;

/**
 * A real raycast vehicle: Rapier casts one ray per wheel and applies suspension
 * and tyre forces to the chassis body, so kerbs, ramps, slopes and shunts all
 * come out of the simulation instead of being faked.
 */
export function Car() {
  const body = useRef<RapierRigidBody>(null);
  const { world } = useRapier();
  const { camera } = useThree();
  const setHud = useGame((s) => s.setHud);

  const { chassis, spec, wheels } = useMemo(() => {
    const g = makeChassis('jeep', 0x6f7f4a);
    const s = g.spec!;
    const w = [0, 1, 2, 3].map(() => {
      const mesh = makeWheel(s.wr, s.wr * 0.62, false);
      g.add(mesh);
      return mesh;
    });
    g.traverse((o: any) => { if (o.isMesh) o.castShadow = true; });
    return { chassis: g, spec: s, wheels: w };
  }, []);

  const controller = useRef<any>(null);
  const camPos = useRef(new THREE.Vector3(0, 8, 14));
  const fwd = useMemo(() => new THREE.Vector3(), []);
  const goal = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    if (!body.current) return;
    const c = world.createVehicleController(body.current);
    const zF = spec.arches[0].x - spec.L / 2;
    const zR = spec.arches[1].x - spec.L / 2;
    const ht = spec.W / 2 - spec.wr * 0.32;
    const points = [
      { x: -ht, y: 0.15, z: zF },
      { x: ht, y: 0.15, z: zF },
      { x: -ht, y: 0.15, z: zR },
      { x: ht, y: 0.15, z: zR }
    ];
    for (const p of points) {
      c.addWheel(p, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, 0.34, spec.wr);
    }
    for (let i = 0; i < 4; i++) {
      c.setWheelSuspensionStiffness(i, 26);
      c.setWheelMaxSuspensionTravel(i, 0.3);
      c.setWheelSuspensionCompression(i, 1.1);
      c.setWheelSuspensionRelaxation(i, 1.5);
      c.setWheelFrictionSlip(i, 2.4);
      c.setWheelSideFrictionStiffness(i, i < 2 ? 0.9 : 0.62);
      c.setWheelMaxSuspensionForce(i, 26000);
    }
    controller.current = c;
    return () => { controller.current = null; };
  }, [world, spec]);

  useBeforePhysicsStep(() => {
    const c = controller.current;
    if (!c) return;
    const speed = c.currentVehicleSpeed();
    const steerLimit = MAX_STEER * (1 - Math.min(0.55, Math.abs(speed) / 42));
    const steer = controls.steer * steerLimit;
    c.setWheelSteering(0, steer);
    c.setWheelSteering(1, steer);

    // the brake pedal doubles as reverse once the car has stopped
    const reversing = controls.brake > 0 && speed < 0.8;
    const engine = controls.throttle * ENGINE - (reversing ? ENGINE * 0.5 : 0);
    c.setWheelEngineForce(2, engine);
    c.setWheelEngineForce(3, engine);
    const brake = controls.brake > 0 && !reversing ? BRAKE_FORCE : controls.throttle > 0 ? 0 : 8;
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

    for (let i = 0; i < 4; i++) {
      const conn = c.wheelChassisConnectionPointCs(i);
      if (!conn) continue;
      const len = c.wheelSuspensionLength(i) ?? 0;
      const rot = c.wheelRotation(i) ?? 0;
      const st = c.wheelSteering(i) ?? 0;
      wheels[i].position.set(conn.x, conn.y - len, conn.z);
      wheels[i].rotation.set(rot, i < 2 ? st : 0, 0, 'YXZ');
    }

    // safety net if the car ever ends up under the world
    if (t.y < heightAt(t.x, t.z) - 16) {
      rb.setTranslation({ x: t.x, y: heightAt(t.x, t.z) + 3, z: t.z }, true);
      rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
      rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }

    fwd.set(0, 0, -1).applyQuaternion(chassis.quaternion);
    playerPos.x = t.x; playerPos.y = t.y; playerPos.z = t.z;
    playerPos.heading = Math.atan2(-fwd.x, -fwd.z);

    const speed = Math.abs(c.currentVehicleSpeed());
    const back = 10.5 - Math.min(3.5, speed / 8);
    goal.set(t.x - fwd.x * back, 0, t.z - fwd.z * back);
    goal.y = Math.max(heightAt(goal.x, goal.z), t.y - 1) + 4.6;
    camPos.current.lerp(goal, 1 - Math.pow(0.0015, delta));
    camera.position.copy(camPos.current);
    camera.lookAt(t.x + fwd.x * 5, t.y + 1.2, t.z + fwd.z * 5);

    setHud({ speed: Math.round(speed * 3.6) });
  });

  return (
    <>
      <RigidBody
        ref={body}
        colliders={false}
        position={[0, heightAt(0, 0) + 2.5, 0]}
        mass={1150}
        linearDamping={0.05}
        angularDamping={0.6}
        canSleep={false}
        ccd
      >
        <CuboidCollider
          args={[spec.W / 2, 0.5, (spec.L * 0.92) / 2]}
          position={[0, 0.75, 0]}
          friction={0.6}
          restitution={0.05}
        />
      </RigidBody>
      <primitive object={chassis} />
    </>
  );
}
