import * as THREE from 'three';

/** User-selected walnut, with six stable face variations and a satin finish. */
export const createCube3DWoodMaterial = (
  onTextureReady: () => void,
  maxAnisotropy: number,
): THREE.MeshPhysicalMaterial => {
  let disposed = false;
  const texture = new THREE.TextureLoader().load('/assets/board/cube-walnut.png', () => {
    if (disposed) {
      texture.dispose();
      return;
    }
    onTextureReady();
  });
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = Math.min(16, maxAnisotropy);
  const material = new THREE.MeshPhysicalMaterial({
    map: texture,
    roughness: 0.46,
    clearcoat: 0.28,
    clearcoatRoughness: 0.32,
    specularIntensity: 0.75,
    metalness: 0,
  });
  material.addEventListener('dispose', () => {
    disposed = true;
    texture.dispose();
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 woodPosition;
        varying vec3 woodNormal;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        woodPosition = position;
        woodNormal = normal;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 woodPosition;
        varying vec3 woodNormal;`)
      .replace('#include <map_fragment>', `
        // Each opposite face gets a different, non-repeating crop/orientation.
        // Smooth triplanar weights preserve the finish across rounded edges.
        // Mipmaps and anisotropy filter the actual texture, including grain detail.
        vec3 p = clamp(woodPosition * 0.5 + 0.5, 0.0, 1.0);
        vec3 weights = pow(abs(normalize(woodNormal)), vec3(8.0));
        weights /= weights.x + weights.y + weights.z;
        vec2 uvX = woodNormal.x >= 0.0 ? p.zy * 0.88 : (1.0 - p.yz) * 0.88 + 0.12;
        vec2 uvY = woodNormal.y >= 0.0 ? p.zx * 0.90 + vec2(0.08, 0.02) : (1.0 - p.xz) * 0.86 + vec2(0.03, 0.12);
        vec2 uvZ = woodNormal.z >= 0.0 ? p.xy * 0.94 + 0.03 : vec2(p.y, 1.0 - p.x) * 0.88 + vec2(0.10, 0.02);
        vec3 grainX = texture2D(map, uvX).rgb;
        vec3 grainY = texture2D(map, uvY).rgb;
        vec3 grainZ = texture2D(map, uvZ).rgb;
        vec3 woodGrain = grainX * weights.x + grainY * weights.y + grainZ * weights.z;
        diffuseColor.rgb *= woodGrain;
      `)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        // Subtle pore variation breaks up the highlight without noisy bump normals.
        float grainLuminance = dot(woodGrain, vec3(0.2126, 0.7152, 0.0722));
        roughnessFactor = clamp(roughnessFactor + (0.18 - grainLuminance) * 0.3, 0.38, 0.54);
      `);
  };
  material.customProgramCacheKey = () => 'cube-walnut-satin-v3';
  return material;
};
