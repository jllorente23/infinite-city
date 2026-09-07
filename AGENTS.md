# Instrucciones para el agente — Ciudad infinita

Léelo al empezar. Actualízalo cuando cambie una convención o un fallo conocido.

## Flujo obligatorio

1. Implementa el cambio y verifícalo (build; en UI, el navegador si está disponible).
2. **Cada cambio se commitea y se sube al branch actual.** No dejes trabajo solo en el working tree. El usuario juega contra Vercel (`https://infinite-city-sigma.vercel.app`), que publica desde `main`. Si no subes, “le sigue saliendo igual”.
3. Branch por defecto: `main` → `origin/main` (`git@github.com:jllorente23/infinite-city.git`).
4. Mensajes de commit en español, 1–2 frases, el **porqué** (no el listado de archivos). Estilo: `Quitar los rastros del SSR y abrir autopistas de doble carril`.
5. Tras el push, di la URL del commit y que recargue fuerte la app desplegada.

## Qué es este proyecto

Juego de conducir en una ciudad procedural infinita: Next.js 14, React 18, Three / R3F, Rapier, Zustand. La ciudad se genera por manzanas (`CELL = 50`) alrededor del jeep. Misma semilla = misma ciudad.

Entrada: `src/components/Game.tsx`. Núcleo en `src/game/`.

## Archivos que tocas casi siempre

| Archivo | Rol |
| --- | --- |
| `src/game/city.ts` | Tipos de manzana, vegetación, calzada, colisionadores |
| `src/game/config.ts` | `BLOCK`, `STREET`, `CELL`, autopista (`HW_*`), `QUALITY` |
| `src/game/Car.tsx` | Jeep del jugador, cámara, faros, red de seguridad |
| `src/game/Traffic.tsx` | IA cinemática, carriles, semáforos, autopista |
| `src/game/DayNight.tsx` | Cielo, farolas, exposición |
| `src/game/textures.ts` | Asfalto, marcas, materiales (sin SSR) |
| `src/game/nature.ts` / `buildings.ts` / `carModels.ts` / `props.ts` | GLB horneados |
| `src/game/signs.ts` | Señales STOP / CEDA / velocidad |
| `src/game/Sparks.tsx` | Chispas al chocar tráfico |

## Convenciones que no rompas

- `setTerrainSeed(seed)` **antes** de generar manzanas o física. Si va en un `useEffect`, el jeep vibra y se cae al vacío.
- Vegetación: nunca sobre calzada. Usa `onDriveable` y el radio real de la copa (XZ del bounding box), no solo el tronco. En aceras solo `KERB_KINDS` (sin arbustos anchos). Avenida y autopista no plantan sobre el asfalto.
- **No vuelvas a poner SSR / EffectComposer.** El temporal resolve deja rastros al andar. El asfalto es `MeshStandardMaterial` mate, no `MeshPhysical` con envMap/clearcoat.
- Faroles: no “se prenden al llegar”. Reasigna luces con fade, no un snap de intensidad.
- Tráfico: no recicles un auto que el jugador todavía ve. En solape, frena; no teletransportes.
- Semáforos: lentes redondas, ciclo largo (verde / ámbar / todo rojo). **Un cruce, un dueño** (`hasSignals` en la esquina SE de la manzana). No 4 postes por esquina. Autopista y canal no llevan semáforo; el resto usa STOP/CEDA.
- Andenes: losa redondeada (`roundedSlab`) y falda oscura debajo para que no se vea el cielo en pendientes.
- Controles táctiles solo en touch. En desktop, teclado. Calidad por defecto: `high` también en móvil.
- Reloj estilo GTA en `Hud` (el día dura `DAY_SECONDS`).
- Estacionamiento: autos alineados a `LOT_COLS` × `LOT_ROWS`, misma grilla que `lotTexture`.
- LOD lejano: siluetas neutras (`mats.distant`), no grilla de ventanas que desaparece al acercarte.
- GLB: al convertir, el JSON del GLB se rellena con **espacios**, nunca null bytes (`JSON.parse` revienta).
- Kit Kenney de autos: quita mallas cuyo nombre incluye `wheel`; las ruedas las pone Rapier. El jeep lleva la de repuesto a mano.

## Tipos de manzana

`canal` | `highway` | `avenue` | `mall` | `parking` | `works` | `tower` | `build` | `park` | `plaza` | `low`

- Autopista **gana** al canal: el agua pasa por debajo y el tablero sigue. Canal solo = cauce + puente a mitad de manzana. El tráfico de autopista no debe flotar sobre el agua.
- Semilla `18`: autopista norte-sur al nacer. Semilla `7` (default): la más cercana ~125 m al oeste.

## Fallos que el usuario ya reportó

Noche oscura / faros apagados, luces que parpadean, árboles blancos o en el pavimento, autos que se atraviesan o flotan en pendiente, jeep que cae infinito, llantas con parche blanco, semáforos cuadrados o en RGB sin pausa, LOD de edificios que “cambia de modelo”, SSR con fantasmas, arbustos a mitad de calle, vibración en móvil, autopista cortada por “espejos” de agua, semáforos de más, luz por debajo del andén, parkings que no coinciden con los autos.

Antes de dar por cerrado un look, conduce de verdad: de día y de noche, cuesta, cruce, autopista.

## Cómo verificar

```bash
npx tsc --noEmit && npm run build
```

Si el navegador embebido no llega a `localhost`, dilo y no finjas que jugaste. El usuario valida en Vercel o en `npm run dev`.
