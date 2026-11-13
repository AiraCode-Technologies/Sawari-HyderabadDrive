import * as THREE from 'three';

// Time of day: sun, sky, fog and exposure, plus everything that lights up after
// dark — street lamps (with glow and pools of light on the road), lit windows,
// the player's headlights and the lamps of the traffic around.
export const TIMES = {
  morning: { label: 'Morning', clock: 8.25, sun: [-0.72, 0.42, 0.3], sunColor: '#ffdcae', sunI: 2.5, hemi: ['#e3e8ee', '#7a705a', 0.85], top: '#6c9fd0', horizon: '#efdcc4', ground: '#7d7356', fog: ['#e6dccd', 240, 1050], exposure: 1.0, lamps: 0, windows: 0 },
  noon: { label: 'Midday', clock: 12.5, sun: [-0.55, 0.78, 0.42], sunColor: '#fff0d4', sunI: 2.9, hemi: ['#dfe9f2', '#7f7458', 0.95], top: '#5d97cf', horizon: '#d9e3e8', ground: '#7d7356', fog: ['#d9e3e8', 260, 1100], exposure: 1.05, lamps: 0, windows: 0 },
  evening: { label: 'Evening', clock: 18.4, sun: [0.82, 0.2, -0.25], sunColor: '#ffa860', sunI: 1.7, hemi: ['#f0c8a6', '#4f4436', 0.55], top: '#35558a', horizon: '#f39b62', ground: '#4d4334', fog: ['#c98d6c', 200, 950], exposure: 1.08, lamps: 0.75, windows: 0.55 },
  night: { label: 'Night', clock: 21.5, sun: [0.3, 0.75, 0.35], sunColor: '#9fb4dc', sunI: 0.28, hemi: ['#4a5878', '#1a1a20', 0.32], top: '#04060d', horizon: '#1c2536', ground: '#0f0f12', fog: ['#121824', 90, 650], exposure: 1.15, lamps: 1, windows: 1 },
};

function glowTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
}

export class Lighting {
  constructor(game, tod) {
    this.game = game;
    this.t = TIMES[tod] || TIMES.noon;
    this.dark = this.t.lamps > 0;
    this.headlights = this.dark;
    const { scene, sun, sky, worldGroup, renderer } = game;
    const t = this.t;
    sun.color.set(t.sunColor);
    sun.intensity = t.sunI;
    game.sunDir.set(...t.sun).normalize();
    this.hemi = game.hemi;
    this.hemi.color.set(t.hemi[0]);
    this.hemi.groundColor.set(t.hemi[1]);
    this.hemi.intensity = t.hemi[2];
    for (const s of [sky, game.envDome]) {
      if (!s) continue;
      s.material.uniforms.top.value.set(t.top);
      s.material.uniforms.horizon.value.set(t.horizon);
      s.material.uniforms.ground.value.set(t.ground);
    }
    scene.fog.color.set(t.fog[0]);
    scene.fog.near = t.fog[1];
    scene.fog.far = t.fog[2];
    renderer.toneMappingExposure = t.exposure;

    // windows and street lamps
    for (const m of worldGroup.userData.nightWindows || []) m.emissiveIntensity = t.windows * 0.9;
    const lampMat = worldGroup.userData.lampMat;
    if (lampMat && this.dark) {
      lampMat.emissive.set('#ffd9a0');
      lampMat.emissiveIntensity = 2.2;
    }
    const tex = this.dark ? glowTexture() : null;
    const lamps = worldGroup.userData.lamps || [];
    if (this.dark && lamps.length) {
      // halos round each lamp head
      const pos = new Float32Array(lamps.length * 3);
      lamps.forEach((l, i) => pos.set([l[0], l[2] - 0.15, -l[1]], i * 3));
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const halo = new THREE.Points(g, new THREE.PointsMaterial({ size: 5, map: tex, color: '#ffcf8a', transparent: true, opacity: 0.85 * t.lamps, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      halo.frustumCulled = false;
      scene.add(halo);
      // warm pools of light on the street below each lamp
      const pool = new THREE.InstancedMesh(
        new THREE.PlaneGeometry(15, 15).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color('#ffb85c').multiplyScalar(0.42 * t.lamps), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8 }),
        lamps.length,
      );
      const m = new THREE.Matrix4();
      lamps.forEach((l, i) => {
        const h = game.index.standAt(l[0], l[1]);
        m.makeTranslation(l[0], h + 0.06, -l[1]);
        pool.setMatrixAt(i, m);
      });
      pool.frustumCulled = false;
      scene.add(pool);
      this.extra = [halo, pool];
    }

    // the player's headlights: two spot lamps (kept, with intensity 0 when off)
    if (this.dark) {
      this.beams = [];
      for (const s of [-1, 1]) {
        const spot = new THREE.SpotLight('#fff3dc', 0, 70, 0.42, 0.55, 1.4);
        spot.position.set(s * 0.62, 0.72, -2.0);
        spot.target.position.set(s * 0.9, 0, -22);
        game.car.root.add(spot, spot.target);
        this.beams.push(spot);
      }
      // traffic lamps: white pairs in front, red pairs behind
      this.maxLamps = 400;
      const mk = (color, size) => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.maxLamps * 3), 3));
        g.setDrawRange(0, 0);
        const p = new THREE.Points(g, new THREE.PointsMaterial({ size, map: tex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
        p.frustumCulled = false;
        scene.add(p);
        return p;
      };
      this.front = mk('#fff1d6', 1.6);
      this.rear = mk('#ff3020', 0.9);
    }
    this.setHeadlights(this.headlights);
  }

  setHeadlights(on) {
    this.headlights = on;
    const c = this.game.car.lights;
    c.headMat.emissive.set(on ? '#fff6e0' : '#c9d4de');
    c.headMat.emissiveIntensity = on ? 2.2 : 0.6;
    for (const b of this.beams || []) b.intensity = on ? 90 : 0;
  }

  update() {
    if (!this.front) return;
    const vs = this.game.traffic.vehicles;
    const fp = this.front.geometry.attributes.position.array, rp = this.rear.geometry.attributes.position.array;
    let nf = 0, nr = 0;
    for (const v of vs) {
      if (nf + 2 > this.maxLamps) break;
      const fx = Math.sin(v.visHeading ?? v.heading), fy = Math.cos(v.visHeading ?? v.heading), rx = fy, ry = -fx;
      const L = (v.length || 2) / 2, W = v.bike ? 0 : (v.width || 1.7) / 2 - 0.25, h = v.h + (v.bike ? 0.95 : 0.7);
      for (const s of v.bike ? [0] : [-1, 1]) {
        fp.set([v.x + fx * L + rx * W * s, h, -(v.y + fy * L + ry * W * s)], nf++ * 3);
        rp.set([v.x - fx * L + rx * W * s, h + 0.1, -(v.y - fy * L + ry * W * s)], nr++ * 3);
      }
    }
    this.front.geometry.setDrawRange(0, nf);
    this.rear.geometry.setDrawRange(0, nr);
    this.front.geometry.attributes.position.needsUpdate = true;
    this.rear.geometry.attributes.position.needsUpdate = true;
  }
}
