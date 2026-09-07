# Modelos glTF

## Props de calle (ya integrados)

En `props/` están la farola y el semáforo que usa la ciudad:

| Archivo | Origen | Escala aplicada |
| --- | --- | --- |
| `props/street-lamp.glb` | Kenney *City Kit Roads*, `light-curved` | ×9.04 → 6.10 m de alto, brazo de 1.81 m |
| `props/traffic-light.glb` | Kenney *City Kit Roads*, `traffic-light` | ×10 → 5.15 m de alto |

Los dos son CC0 (ver `props/KENNEY-LICENSE.txt`, crédito a
[Kenney](https://kenney.nl/assets/city-kit-roads)). Comparten el atlas
`props/Textures/colormap.png`, que el `.glb` referencia con ruta relativa: si
mueves los modelos, mueve también esa carpeta.

`src/game/props.ts` los carga una sola vez, les hornea la escala y el giro (los
dos quedan mirando hacia `-Z`, igual que los vehículos) y los deja en una caché
que `generateChunk` lee de forma síncrona. `City` se suspende hasta que llegan,
así que ninguna manzana se dibuja con los props provisionales.

Las tres luces del semáforo siguen siendo mallas propias, colocadas sobre las
lentes del modelo (`SIGNAL_LENS_Y`), porque hay que encenderlas y apagarlas por
separado según `signalState`.

## Vehículos

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
