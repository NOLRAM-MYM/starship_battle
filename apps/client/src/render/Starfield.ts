import * as THREE from 'three/webgpu';

/**
 * Skybox procedural com 8000 estrelas distribuídas em uma esfera.
 * Sem texturas externas — totalmente gerado em GPU via points.
 */
export function createStarfield(count = 8000, radius = 5_000): THREE.Points {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);

  // Seed determinístico p/ reprodutibilidade
  let seed = 0x1234_5678;
  const rand = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffff_ffff;
  };

  for (let i = 0; i < count; i++) {
    // Distribuição em esfera com leve bias para disco galáctico
    const u = rand();
    const v = rand();
    const theta = 2 * Math.PI * u;
    const phi = Math.acos(2 * v - 1);
    const r = radius * (0.6 + 0.4 * rand());

    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta) * 0.3; // achata
    positions[i * 3 + 2] = r * Math.cos(phi);

    // Cor: branco → azul → amarelo → vermelho (classe espectral)
    const t = rand();
    const r1 = 0.7 + t * 0.3;
    const g = 0.7 + (1 - Math.abs(t - 0.5)) * 0.3;
    const b = 1 - t * 0.3;
    colors[i * 3] = r1;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;

    sizes[i] = 0.5 + rand() * 1.5;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

  const mat = new THREE.PointsMaterial({
    size: 1.5,
    vertexColors: true,
    sizeAttenuation: false,
    transparent: true,
    depthWrite: false,
  });

  return new THREE.Points(geo, mat);
}
