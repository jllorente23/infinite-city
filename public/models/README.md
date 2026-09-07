# Modelos glTF

Los vehículos actuales se generan por código (`src/game/vehicles.ts`). Para subir
el nivel visual, reemplázalos por modelos glTF.

## De dónde sacarlos (licencia libre)

- Kenney, "Car Kit" y "City Kit": https://kenney.nl/assets (CC0)
- Quaternius, "Ultimate Modular Vehicles": https://quaternius.com (CC0)

## Cómo montarlos

1. Deja los `.glb` en esta carpeta, por ejemplo `public/models/jeep.glb`.
2. Comprime antes de subir a producción:
   ```bash
   npx gltf-transform optimize jeep.glb jeep.opt.glb --compress draco --texture-compress webp
   ```
3. En `src/game/Car.tsx`, cambia el modelo por el glTF y deja la física igual:
   ```tsx
   import { useGLTF } from '@react-three/drei';
   const { scene } = useGLTF('/models/jeep.opt.glb');
   ```
   El chasis visual y el colisionador son independientes, así que solo cambias el
   objeto que se dibuja. Ajusta la escala para que el largo coincida con `spec.L`.
4. Para las ruedas, separa los nodos del modelo o usa las generadas por código:
   la posición te la sigue dando `wheelChassisConnectionPointCs` de Rapier.

Precarga los que uses siempre:

```tsx
useGLTF.preload('/models/jeep.opt.glb');
```
