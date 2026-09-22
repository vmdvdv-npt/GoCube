import * as THREE from 'three';

/** Solid object-space grain: continuous across all six faces and rounded seams. */
export const createCube3DWoodMaterial = (): THREE.MeshStandardMaterial => {
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.72,
    metalness: 0,
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 woodPosition;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nwoodPosition = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 woodPosition;
        float woodHash(vec3 p) {
          return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
        }
        float woodNoise(vec3 p) {
          vec3 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(woodHash(i), woodHash(i + vec3(1,0,0)), f.x),
                         mix(woodHash(i + vec3(0,1,0)), woodHash(i + vec3(1,1,0)), f.x), f.y),
                     mix(mix(woodHash(i + vec3(0,0,1)), woodHash(i + vec3(1,0,1)), f.x),
                         mix(woodHash(i + vec3(0,1,1)), woodHash(i + vec3(1,1,1)), f.x), f.y), f.z);
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 p = woodPosition;
        float drift = woodNoise(p * vec3(3.0, 0.65, 3.0));
        float rings = length(p.xz + vec2(2.6, 1.8)) * 43.0 + drift * 4.0;
        float grain = 0.5 + 0.5 * sin(rings);
        float fine = woodNoise(p * vec3(145.0, 5.0, 145.0));
        float broad = woodNoise(p * vec3(6.0, 0.8, 6.0));
        float tone = clamp(0.52 + broad * 0.28 + grain * 0.12 + fine * 0.08, 0.0, 1.0);
        diffuseColor.rgb *= mix(vec3(0.075, 0.018, 0.006), vec3(0.34, 0.115, 0.032), tone);
      `);
  };
  material.customProgramCacheKey = () => 'cube-solid-wood-v1';
  return material;
};
