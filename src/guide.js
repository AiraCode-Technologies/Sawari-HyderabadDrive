import * as THREE from 'three';
import { CAR } from './car/carModel.js';

// Translucent band painted along the keep-left drive line. Fades out behind the
// car and far ahead; chevrons drift forward to show the direction of travel.
export function createRouteBand(nav) {
  const pts = nav.pts;
  const pos = [], along = [], sides = [], idx = [];
  const hw = 1.05;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1];
    const l = Math.hypot(tx, ty) || 1;
    tx /= l; ty /= l;
    const nx = -ty, ny = tx;
    const p = pts[i];
    pos.push(p[0] + nx * hw, p[2] + 0.11, -(p[1] + ny * hw), p[0] - nx * hw, p[2] + 0.11, -(p[1] - ny * hw));
    along.push(nav.cum[i], nav.cum[i]);
    sides.push(0, 1);
    if (i > 0) {
      const k = i * 2;
      idx.push(k - 2, k - 1, k, k - 1, k + 1, k);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('along', new THREE.Float32BufferAttribute(along, 1));
  g.setAttribute('side', new THREE.Float32BufferAttribute(sides, 1));
  g.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    uniforms: { progress: { value: 0 }, time: { value: 0 }, color: { value: new THREE.Color('#3d8bff') } },
    vertexShader: `
      attribute float along;
      attribute float side;
      varying float vAlong;
      varying float vSide;
      void main() {
        vAlong = along;
        vSide = side;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform float progress;
      uniform float time;
      uniform vec3 color;
      varying float vAlong;
      varying float vSide;
      void main() {
        float ahead = vAlong - progress;
        float a = smoothstep(-4.0, 6.0, ahead) * (1.0 - smoothstep(220.0, 380.0, ahead));
        float edge = 1.0 - smoothstep(0.32, 0.5, abs(vSide - 0.5));
        float chevron = fract((vAlong - abs(vSide - 0.5) * 3.0) / 7.0 - time * 0.25);
        float stripe = smoothstep(0.0, 0.08, chevron) * (1.0 - smoothstep(0.32, 0.4, chevron));
        gl_FragColor = vec4(mix(color, vec3(1.0), stripe * 0.45), a * (0.32 + 0.25 * stripe) * (0.55 + 0.45 * edge));
      }`,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -8,
    polygonOffsetUnits: -8,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.renderOrder = 2;
  return mesh;
}

// Where the car will go with its current steering: two wheel tracks projected
// about 2.5 s ahead. White normally, amber when it leaves the road, red when it
// meets a wall.
export function createSteeringGuide() {
  const N = 26;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 2 * 2 * 3), 3));
  const idx = [];
  for (let t = 0; t < 2; t++)
    for (let i = 1; i < N; i++) {
      const k = t * N * 2 + i * 2;
      idx.push(k - 2, k - 1, k, k - 1, k + 1, k);
    }
  g.setIndex(idx);
  const mat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -9, polygonOffsetUnits: -9 });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;

  const COLORS = { ok: new THREE.Color('#ffffff'), close: new THREE.Color('#ffb020'), contact: new THREE.Color('#ff3b2f') };

  return {
    mesh,
    update(car, index) {
      const p = g.attributes.position.array;
      const speed = Math.max(Math.abs(car.v), 2.5);
      const horizon = Math.min(2.6, 30 / speed);
      const dt = horizon / (N - 1);
      let x = car.x, y = car.y, hd = car.heading, h = car.h;
      const dir = car.gear === 'R' ? -1 : 1;
      const yaw = (dir * speed / CAR.wheelbase) * Math.tan(car.steer);
      let state = 'ok';
      for (let i = 0; i < N; i++) {
        if (i > 0) {
          hd += yaw * dt;
          x += Math.sin(hd) * dir * speed * dt;
          y += Math.cos(hd) * dir * speed * dt;
          const s = index.surface(x, y, h);
          if (s) h = s.h;
          if (i > 3 && state === 'ok' && (!s || s.d > s.seg.w / 2 - 0.4)) state = 'close';
          if (i > 3 && state !== 'contact' && h < 1 && index.inBuilding(x, y)) state = 'contact';
        }
        const rx = Math.cos(hd), ry = -Math.sin(hd);
        for (let t = 0; t < 2; t++) {
          const side = t === 0 ? -0.76 : 0.76;
          const cx = x + rx * side, cy = y + ry * side;
          const k = (t * N * 2 + i * 2) * 3;
          const w = 0.09;
          p[k] = cx - rx * w; p[k + 1] = h + 0.13; p[k + 2] = -(cy - ry * w);
          p[k + 3] = cx + rx * w; p[k + 4] = h + 0.13; p[k + 5] = -(cy + ry * w);
        }
      }
      g.attributes.position.needsUpdate = true;
      mat.color.copy(COLORS[state]);
      return state;
    },
  };
}
