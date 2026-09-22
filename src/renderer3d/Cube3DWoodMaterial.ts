import * as THREE from 'three';

/** Reuse the 2D board's real grain, excluding its baked frame and edge lighting. */
export const createCube3DWoodMaterial = (
  onTextureReady: () => void,
  maxAnisotropy: number,
): THREE.MeshStandardMaterial => {
  let disposed = false;
  const texture = new THREE.TextureLoader().load('/assets/board/cube.jpg', () => {
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
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    roughness: 0.72,
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
        // Object-space triplanar projection blends across rounded edges without
        // stretching the grain. Sample only the unframed interior of cube.jpg.
        // Hardware mipmaps and anisotropic filtering suppress grazing-angle aliasing.
        vec3 p = clamp(woodPosition * 0.5 + 0.5, 0.0, 1.0);
        vec3 weights = pow(abs(normalize(woodNormal)), vec3(8.0));
        weights /= weights.x + weights.y + weights.z;
        vec3 grainX = texture2D(map, vec2(0.10) + p.zy * 0.80).rgb;
        vec3 grainY = texture2D(map, vec2(0.10) + p.xz * 0.80).rgb;
        vec3 grainZ = texture2D(map, vec2(0.10) + p.xy * 0.80).rgb;
        diffuseColor.rgb *= grainX * weights.x + grainY * weights.y + grainZ * weights.z;
      `);
  };
  material.customProgramCacheKey = () => 'cube-board-wood-triplanar-v2';
  return material;
};
