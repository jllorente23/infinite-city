# Ciudad infinita

Ciudad procedural infinita en Next.js, con física de vehículo real (Rapier) y
generación por manzanas alrededor del jugador.

## Arrancar

```bash
npm install
npm run dev
```

Abre http://localhost:3000. Compilado y verificado con Node 22, Next 14 y React 18.

Controles: flechas o WASD en teclado. En móvil, el slider de abajo a la izquierda
es la dirección (analógico) y los dos pedales de la derecha son gas y freno. El
freno también es reversa cuando el carro ya está detenido.

## Qué hay dentro

| Archivo | Qué hace |
| --- | --- |
| `src/game/rng.ts` | Semilla, hash por coordenada y campo de alturas del terreno |
| `src/game/city.ts` | Generador de manzanas: tipo de bloque, geometría y cajas de colisión |
| `src/game/City.tsx` | Streaming de manzanas por cercanía y tres niveles de detalle |
| `src/game/vehicles.ts` | Modelos de vehículos por perfil lateral extruido |
| `src/game/Car.tsx` | Vehículo del jugador sobre `DynamicRayCastVehicleController` de Rapier |
| `src/game/Traffic.tsx` | Tráfico como cuerpos rígidos dinámicos que respetan semáforos |
| `src/game/DayNight.tsx` | Ciclo día y noche, cielo, sol, estrellas, luces de ventana |
| `src/game/signals.ts` | Estado de cada semáforo, derivado de su posición y del reloj |

Todo es determinista: la misma semilla reconstruye exactamente la misma ciudad,
porque cada manzana genera su contenido desde `hash(semilla, i, j)` y nunca desde
un contador global.

## Lo que cambió respecto al prototipo de un solo archivo

1. **Física real.** El carro es un cuerpo rígido con cuatro rayos de suspensión.
   Los andenes, las rampas, los choques y los volcamientos salen del solver, no
   de una aproximación escrita a mano.
2. **Tráfico con masa.** Los otros vehículos son cuerpos dinámicos: si los
   embistes, se desplazan de verdad y el bus pesa ocho veces más que un sedán.
3. **Colisionadores por manzana.** Solo las manzanas en el radio de detalle
   crean colisionadores, así que el costo de física no crece con la distancia
   de visión.

## Siguientes pasos, en orden de impacto

1. **Modelos glTF.** Ver `public/models/README.md`. Es el salto visual más grande
   por hora invertida.
2. **Post proceso.** `@react-three/postprocessing` ya está instalado. Un
   `EffectComposer` con SSAO suave y bloom bajo cambia mucho la percepción de
   volumen. Actívalo solo en calidad alta.
3. **Generación en Web Worker.** `generateChunk` es una función pura: se puede
   mover a un worker y transferir los buffers para que no haya tirones al cargar.
4. **Ruido de verdad.** El terreno es una suma de senos. Cambiarlo por Simplex
   más Worley para distritos da variedad a más escalas sin tocar nada más.
5. **WebGPU.** Three ya trae `three/webgpu` con fallback automático a WebGL 2.
   Vale la pena cuando el cuello sea el número de draw calls.

## Ajustes rápidos

- Distancia de visión y densidad de tráfico: `src/game/config.ts`, objeto `QUALITY`.
- Comportamiento del carro: constantes `ENGINE`, `BRAKE_FORCE`, `MAX_STEER` y los
  `setWheel*` en `src/game/Car.tsx`.
- Mezcla de la ciudad (canales, avenidas, parqueaderos, malls): función
  `blockTypeAt` en `src/game/city.ts`.
- Duración del día: `DAY_SECONDS` en `src/game/config.ts`.
