'use client';

import { EffectComposer, SSR } from '@react-three/postprocessing';

/** Screen-space reflections are reserved for high quality. The road roughness
 * map keeps them on wet asphalt while matte sidewalks stay unaffected. */
export function PostFX() {
  return (
    <EffectComposer multisampling={0} resolutionScale={0.65}>
      <SSR
        temporalResolve
        temporalResolveMix={0.82}
        temporalResolveCorrectionMix={0.35}
        maxSamples={8}
        ENABLE_BLUR
        blurMix={0.58}
        blurKernelSize={3}
        intensity={0.55}
        maxRoughness={0.62}
        rayStep={0.45}
        MAX_STEPS={14}
        NUM_BINARY_SEARCH_STEPS={4}
        maxDepthDifference={7}
        thickness={4}
        ior={1.45}
        USE_ROUGHNESSMAP
        USE_NORMALMAP
      />
    </EffectComposer>
  );
}
