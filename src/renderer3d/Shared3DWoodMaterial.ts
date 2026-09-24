import * as THREE from 'three';

const WOOD_TEXTURE_READY_FALLBACK_MS = 3000;

const configureWoodTexture = (
  texture: THREE.Texture,
  maxAnisotropy: number,
): void => {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = Math.min(16, maxAnisotropy);
};

const createWoodFallbackTexture = (maxAnisotropy: number): THREE.DataTexture => {
  const pixels = new Uint8Array([
    166, 107, 55, 255,
    160, 101, 50, 255,
    171, 112, 59, 255,
    164, 104, 52, 255,
  ]);
  const texture = new THREE.DataTexture(pixels, 2, 2, THREE.RGBAFormat);
  configureWoodTexture(texture, maxAnisotropy);
  texture.needsUpdate = true;
  return texture;
};

/** Shared walnut board material with a satin finish and stable triplanar grain. */
export const createShared3DWoodMaterial = (
  onTextureReady: () => void,
  maxAnisotropy: number,
): THREE.MeshPhysicalMaterial => {
  let disposed = false;
  let readinessReported = false;
  let readinessTimer: number | null = null;
  const fallbackTexture = createWoodFallbackTexture(maxAnisotropy);
  const material = new THREE.MeshPhysicalMaterial({
    map: fallbackTexture,
    roughness: 0.46,
    clearcoat: 0.28,
    clearcoatRoughness: 0.32,
    specularIntensity: 0.75,
    metalness: 0,
  });

  const reportReady = (): void => {
    if (disposed || readinessReported) return;
    readinessReported = true;
    if (readinessTimer !== null) {
      window.clearTimeout(readinessTimer);
      readinessTimer = null;
    }
    onTextureReady();
  };

  // TextureLoader can occasionally emit neither load nor error in headless WebGL.
  // Keep the renderable DataTexture fallback, but do not publish readiness early:
  // normal cold-loading still waits for the walnut asset. The bounded fallback only
  // prevents an otherwise permanent transition lock when the loader becomes silent.
  readinessTimer = window.setTimeout(reportReady, WOOD_TEXTURE_READY_FALLBACK_MS);

  let walnutTexture: THREE.Texture | null = null;
  walnutTexture = new THREE.TextureLoader().load(
    '/assets/board/cube-walnut.png',
    (loadedTexture) => {
      configureWoodTexture(loadedTexture, maxAnisotropy);
      if (disposed) {
        loadedTexture.dispose();
        return;
      }
      material.map = loadedTexture;
      material.needsUpdate = true;
      fallbackTexture.dispose();
      reportReady();
    },
    undefined,
    () => {
      // The DataTexture is already a complete renderable fallback, so an explicit
      // asset failure can safely unlock the first textured frame immediately.
      reportReady();
    },
  );

  material.addEventListener('dispose', () => {
    disposed = true;
    if (readinessTimer !== null) {
      window.clearTimeout(readinessTimer);
      readinessTimer = null;
    }
    fallbackTexture.dispose();
    walnutTexture?.dispose();
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n        varying vec3 woodPosition;\n        varying vec3 woodNormal;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n        woodPosition = position;\n        woodNormal = normal;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n        varying vec3 woodPosition;\n        varying vec3 woodNormal;`)
      .replace('#include <map_pars_fragment>', `#include <map_pars_fragment>\n        vec3 balancedWood(vec2 uv, vec3 grain) {\n          vec3 localMean = textureLod(map, uv, 6.0).rgb;\n          vec3 luma = vec3(0.2126, 0.7152, 0.0722);\n          float detail = dot(grain, luma) / max(dot(localMean, luma), 0.001);\n          float softDetail = mix(1.0, clamp(detail, 0.55, 1.6), 0.55);\n          return vec3(0.285, 0.118, 0.041) * softDetail;\n        }`)
      .replace('#include <map_fragment>', `\n        vec3 p = clamp(woodPosition * 0.5 + 0.5, 0.0, 1.0);\n        vec3 weights = pow(abs(normalize(woodNormal)), vec3(8.0));\n        weights /= weights.x + weights.y + weights.z;\n        vec2 uvX = woodNormal.x >= 0.0 ? p.zy * 0.88 : (1.0 - p.yz) * 0.88 + 0.12;\n        vec2 uvY = woodNormal.y >= 0.0 ? p.zx * 0.90 + vec2(0.08, 0.02) : (1.0 - p.xz) * 0.86 + vec2(0.03, 0.12);\n        vec2 uvZ = woodNormal.z >= 0.0 ? p.xy * 0.94 + 0.03 : vec2(p.y, 1.0 - p.x) * 0.88 + vec2(0.10, 0.02);\n        vec3 grainX = texture2D(map, uvX).rgb;\n        vec3 grainY = texture2D(map, uvY).rgb;\n        vec3 grainZ = texture2D(map, uvZ).rgb;\n        vec3 woodGrain = grainX * weights.x + grainY * weights.y + grainZ * weights.z;\n        diffuseColor.rgb *= balancedWood(uvX, grainX) * weights.x\n          + balancedWood(uvY, grainY) * weights.y\n          + balancedWood(uvZ, grainZ) * weights.z;\n      `)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n        float grainLuminance = dot(woodGrain, vec3(0.2126, 0.7152, 0.0722));\n        roughnessFactor = clamp(roughnessFactor + (0.18 - grainLuminance) * 0.3, 0.38, 0.54);\n      `);
  };
  material.customProgramCacheKey = () => 'shared-walnut-balanced-v4';

  return material;
};