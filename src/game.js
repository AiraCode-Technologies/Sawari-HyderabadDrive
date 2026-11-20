import * as THREE from 'three';
import { buildWorld, paintSignalHead } from './world/build.js';
import { RoadIndex } from './world/roadIndex.js';
import { Terrain } from './world/terrain.js';
import { createCarModel, CAR } from './car/carModel.js';
import { CarPhysics } from './car/physics.js';
import { Input } from './input.js';
import { TouchControls } from './touch.js';
import { scoreCard, shareCard, shareLink, challengeLink, verdict, socialRow, copyText } from './share.js';
import { CameraRig } from './cameraRig.js';
import { Navigator, TURN_TEXT } from './nav.js';
import { createRouteBand, createSteeringGuide } from './guide.js';
import { Traffic } from './traffic.js';
import { Pedestrians } from './pedestrians.js';
import { Rules } from './rules.js';
import { signalState } from './signals.js';
import { Hud } from './hud.js';
import { Audio } from './audio.js';
import { fmtTime, clamp, angleDiff, cullTiles } from './util.js';
import { Lighting, TIMES } from './lighting.js';

const STEP = 1 / 120;
if (import.meta.env.DEV) window.__THREE = THREE; // for automated browser tests

function skyDome(t = TIMES.noon) {
  const geo = new THREE.SphereGeometry(4000, 24, 12);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { top: { value: new THREE.Color(t.top) }, horizon: { value: new THREE.Color(t.horizon) }, ground: { value: new THREE.Color(t.ground) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader:
      'uniform vec3 top; uniform vec3 horizon; uniform vec3 ground; varying vec3 vP; void main(){ float y = vP.y; vec3 c = y > 0.0 ? mix(horizon, top, pow(y, 0.55)) : mix(horizon, ground, clamp(-y * 5.0, 0.0, 1.0)); gl_FragColor = vec4(c, 1.0); }',
  });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = -1;
  return m;
}

export class Game {
  constructor(root, world, settings, onExit) {
    this.root = root;
    this.world = world;
    this.settings = settings;
    this.onExit = onExit;
    this.quality = { shadows: settings.quality === 'high' };

    // renderer
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }));
    // full resolution normally; lowered a little only if this computer cannot keep up (see loop)
    this.maxRatio = Math.min(devicePixelRatio, settings.touch ? 1 : settings.quality === 'high' ? 1.75 : 1.25); // phones: 1x (their 3x screens would be far too heavy)
    this.ratio = this.maxRatio;
    this.perf = { t: 0, n: 0 };
    r.setPixelRatio(this.ratio);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = this.quality.shadows;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.quality.aniso = Math.min(8, r.capabilities.getMaxAnisotropy());
    r.domElement.className = 'view';
    r.domElement.tabIndex = 0;
    root.appendChild(r.domElement);

    // scene, sky, light
    const scene = (this.scene = new THREE.Scene());
    const tod = (this.tod = TIMES[settings.time] || TIMES.noon);
    scene.fog = new THREE.Fog(tod.fog[0], tod.fog[1], tod.fog[2]);
    this.sky = skyDome(tod);
    scene.add(this.sky);
    // sky reflections for the car's paint and glass (PBR materials only)
    const pmrem = new THREE.PMREMGenerator(r);
    const envScene = new THREE.Scene();
    const envDome = (this.envDome = skyDome(tod));
    envDome.scale.setScalar(0.01); // keep it inside the cube camera's far plane
    envScene.add(envDome);
    scene.environment = pmrem.fromScene(envScene, 0.02).texture;
    pmrem.dispose();
    // softer fill so the sun's shadows read clearly
    this.hemi = new THREE.HemisphereLight('#dfe9f2', '#7f7458', 0.95);
    scene.add(this.hemi);
    // late-morning sun from the south-east: long, defined shadows across the streets
    const sun = (this.sun = new THREE.DirectionalLight('#fff0d4', 2.9));
    this.sunDir = new THREE.Vector3(-0.55, 0.78, 0.42).normalize();
    sun.castShadow = this.quality.shadows;
    const res = settings.quality === 'high' ? 4096 : 2048;
    sun.shadow.mapSize.set(res, res);
    const sc = sun.shadow.camera;
    this.shadowSpan = 110;
    sc.left = sc.bottom = -this.shadowSpan;
    sc.right = sc.top = this.shadowSpan;
    sc.near = 1;
    sc.far = 500;
    this.shadowTexel = (this.shadowSpan * 2) / res;
    sun.shadow.bias = -0.00025;
    sun.shadow.normalBias = 0.35;
    scene.add(sun, sun.target);

    this.camera = new THREE.PerspectiveCamera(60, 1, 0.3, 4500);

    // world
    this.terrain = new Terrain(world.terrain);
    this.index = new RoadIndex(world, this.terrain);
    const built = buildWorld(world, this.quality, this.terrain, this.index);
    scene.add(built.group);
    this.worldGroup = built.group;
    // the world never moves: skip per-frame matrix updates for its static meshes
    built.group.updateMatrixWorld(true);
    this.signalHeads = built.signalHeads;

    // route + guides
    this.nav = new Navigator(world.route);
    this.band = createRouteBand(this.nav);
    this.band.visible = settings.guides !== 'off';
    scene.add(this.band);
    this.steerGuide = createSteeringGuide();
    this.steerGuide.mesh.visible = settings.guides !== 'off';
    scene.add(this.steerGuide.mesh);

    // car
    this.car = createCarModel(settings.color);
    scene.add(this.car.root);
    this.phys = new CarPhysics(this.index);
    const st = world.route.start;
    const d0 = world.route.drive;
    const heading = Math.atan2(d0[1][0] - d0[0][0], d0[1][1] - d0[0][1]);
    this.phys.place(st.x, st.y, st.h, heading);

    this.traffic = new Traffic(world, scene, settings.traffic, world.signals, this.index);
    this.people = new Pedestrians(world, scene, settings.traffic, this.terrain, this.index);
    this.rules = new Rules(this.nav, world.signals);
    this.input = new Input(r.domElement);
    // phones and tablets drive with on-screen controls
    if (settings.touch) this.touchUi = new TouchControls(root, this.input, { wheel: settings.wheel });
    this.portrait = matchMedia('(orientation: portrait)');
    this.rig = new CameraRig(this.camera);
    if (settings.camera === 'cockpit') this.rig.toggle();
    this.hud = new Hud(root, world);
    this.audio = new Audio();
    // phones only allow sound after a tap: wake it on the first touch of the controls
    this.unlockAudio = () => {
      if (this.audio.ctx?.state === 'suspended' && (this.state === 'driving' || this.state === 'countdown')) this.audio.quiet(false);
    };
    root.addEventListener('pointerdown', this.unlockAudio);
    this.audio.voiceOn = settings.voice !== 'off';

    this.lighting = new Lighting(this, settings.time);
    this.hazard = false;
    this.honkTimer = 4;

    this.indicators = { left: false, right: false, peak: 0 };
    this.time = 0;
    this.clock = 0;
    this.acc = 0;
    this.state = 'countdown';
    this.countdown = 3;
    this.spoken = new Set();
    this.last = performance.now();
    this.overlay = null;

    this.onHide = () => {
      if (document.visibilityState !== 'hidden') return;
      if (this.state === 'driving' || this.state === 'countdown') this.pause();
      this.audio.horn(false);
      this.audio.quiet(true);
      if ('speechSynthesis' in window) speechSynthesis.cancel();
    };
    this.onLeave = () => this.audio.stop();
    document.addEventListener('visibilitychange', this.onHide);
    addEventListener('pagehide', this.onLeave);
    this.onResize = () => this.resize();
    addEventListener('resize', this.onResize);
    this.resize();
    this.syncCar(0);
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
    r.domElement.focus();
  }

  start() {
    this.audio.start();
  }

  resize() {
    const w = this.root.clientWidth, h = this.root.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  loop(now) {
    this.raf = requestAnimationFrame(this.loop);
    const raw = (now - this.last) / 1000;
    const dt = Math.min(0.1, raw);
    this.last = now;
    this.adaptResolution(raw);
    this.frame(dt, now);
    this.renderer.render(this.scene, this.camera);
    this.input.endFrame();
  }

  // Dynamic resolution: if frames average slower than ~42 fps for two seconds,
  // render slightly fewer pixels; when there is headroom again, go back up.
  adaptResolution(raw) {
    if (raw > 0.25 || this.state === 'paused') return; // tab switches and pauses are not slowness
    const p = this.perf;
    p.t += raw;
    p.n++;
    if (p.t < 2) return;
    const avg = p.t / p.n;
    p.t = p.n = 0;
    const floor = avg > 0.034 ? 0.75 : Math.min(1, this.maxRatio);
    let next = this.ratio;
    if (avg > 0.024 && this.ratio > floor) next = Math.max(floor, this.ratio - 0.15);
    else if (avg < 0.0175 && this.ratio < this.maxRatio) next = Math.min(this.maxRatio, this.ratio + 0.1);
    if (Math.abs(next - this.ratio) > 1e-3) {
      this.ratio = next;
      this.renderer.setPixelRatio(next);
      this.resize();
    }
  }

  frame(dt, now) {
    const input = this.input;
    input.update(dt, Math.abs(this.phys.v));

    // global keys
    // phones drive held sideways only: turned upright mid-drive, the game pauses
    if (this.touchUi && this.portrait.matches && (this.state === 'driving' || this.state === 'countdown')) this.pause();
    if (input.took('Escape')) this.state === 'paused' ? this.resume() : this.state === 'driving' || this.state === 'countdown' ? this.pause() : null;
    if (input.took('Tab')) this.toggleHelp();
    if (input.took('KeyC')) this.toast(this.rig.toggle() === 'cockpit' ? 'Driver’s view' : 'Chase view', 'info', 1200);
    if (input.took('KeyL')) {
      this.lighting.setHeadlights(!this.lighting.headlights);
      this.toast(this.lighting.headlights ? 'Headlights on' : 'Headlights off', 'info', 1100);
    }
    if (input.took('KeyX')) {
      this.hazard = !this.hazard;
      this.toast(this.hazard ? 'Hazard lights on' : 'Hazard lights off', 'info', 1100);
    }
    this.audio.horn(input.down('KeyH') && this.state !== 'paused');
    if (input.down('KeyH')) this.horned = this.clock;
    if (input.took('KeyM')) {
      this.audio.setMuted(!this.audio.muted);
      this.toast(this.audio.muted ? 'Sound off' : 'Sound on', 'info', 1200);
    }

    const active = this.state === 'driving' || this.state === 'countdown';
    if (active) {
      this.clock += dt;
      if (this.state === 'countdown') {
        this.countdown -= dt;
        const n = Math.ceil(this.countdown);
        this.hud.banner(n > 0 ? `Ready in ${n}…  Keep left and follow the blue band` : null);
        if (this.countdown <= 0) {
          this.state = 'driving';
          this.hud.banner(null);
          // like a navigation app: the compass direction to set off in
          const d0 = this.world.route.drive, k = Math.min(d0.length - 1, 8);
          const dir = Math.atan2(d0[k][0] - d0[0][0], d0[k][1] - d0[0][1]);
          const compass = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][((Math.round(dir / (Math.PI / 4)) % 8) + 8) % 8];
          this.audio.say(`Head ${compass}. Keep left and follow the blue line.`);
        }
      }
      this.handleIndicators(input);
      const driving = this.state === 'driving';
      // during the countdown hold the handbrake (holding the brake would select reverse)
      const ctl = driving ? input : { throttle: 0, brake: 0, steer: input.steer, handbrake: true };
      if (input.took('KeyR') && driving) this.resetToRoute();

      this.acc += dt;
      let events = [];
      let steps = 0;
      while (this.acc >= STEP && steps++ < 12) {
        // remember the pose before each step so drawing can blend between steps
        const ph = this.phys, pb = ph.body;
        this.prevPose = { x: ph.x, y: ph.y, h: ph.h, heading: ph.heading, pitch: ph.pitch + pb.pitch, roll: -ph.roll + pb.roll, heave: pb.heave };
        events = events.concat(this.phys.step(STEP, ctl));
        this.acc -= STEP;
      }
      if (this.acc > STEP) this.acc = STEP; // never fall behind after a long frame
      if (driving) {
        this.time += dt;
        // vehicles see the people, and the people see the vehicles
        events = events.concat(this.traffic.update(dt, this.phys, this.clock, this.people.people));
        events = events.concat(this.people.update(dt, this.phys, this.clock, this.traffic.vehicles));
        this.nav.update(this.phys.x, this.phys.y, this.phys.h, dt);
        this.rules.update(dt, this.clock, this.phys, this.indicators, events,
          (f) => { this.toast(f.what); this.audio.bump(2); },
          (w) => this.toast(w, 'warn'));
        for (const e of events) {
          if (e.type === 'collision' || e.type === 'bump') this.audio.bump(e.type === 'bump' ? e.speed * 0.4 : e.speed);
          // other drivers: a bang from a crash nearby, a honk when you are in their way
          else if (e.type === 'npc-crash' && e.d < 70) this.audio.bump(e.speed * 0.5 * (1 - e.d / 70));
          else if (e.type === 'honk' && e.d < 60) this.audio.distantHonk(Math.min(1, e.d / 60) * 0.6);
        }
        this.voice();
        // Hyderabad traffic is never quiet: an occasional honk somewhere nearby
        this.honkTimer -= dt;
        if (this.honkTimer <= 0) {
          const busy = this.traffic.vehicles.length;
          this.honkTimer = busy > 20 ? 2 + Math.random() * 6 : 6 + Math.random() * 12;
          if (busy > 4) this.audio.distantHonk(Math.random());
        }
        // heading against the route: suggest a U-turn at the next median opening
        const a = this.nav.pointAt(this.nav.progress), b = this.nav.pointAt(this.nav.progress + 6);
        const routeDir = Math.atan2(b.x - a.x, b.y - a.y);
        const against = this.nav.offset < 25 && Math.abs(this.phys.v) > 2 && Math.abs(angleDiff(this.phys.heading, routeDir)) > 2.2;
        this.wrongWayTime = against ? (this.wrongWayTime || 0) + dt : 0;
        this.hud.banner(
          this.wrongWayTime > 2 ? 'Wrong direction — make a U-turn at the next median opening (look for the blue U-turn sign)'
          : this.nav.offRoute ? `Off route — head back to the blue band, or ${this.settings.touch ? 'tap ↺' : 'press R'} to return to it` : null,
        );
        if (this.nav.arrived) this.finish();
      } else {
        this.traffic.update(dt, this.phys, this.clock, this.people.people);
        this.people.update(dt, this.phys, this.clock, this.traffic.vehicles);
      }
    }

    this.syncCar(dt, now);
    this.car.setCockpit(this.rig.mode === 'cockpit');
    this.rig.update(dt, this.car, this.phys, input.look);
    this.band.material.uniforms.progress.value = this.nav.progress;
    this.band.material.uniforms.time.value = this.clock;
    if (this.steerGuide.mesh.visible) this.steerGuide.update(this.phys, this.index);

    for (const head of this.signalHeads) {
      const dx = head.signal.x - this.phys.x, dy = head.signal.y - this.phys.y;
      if (dx * dx + dy * dy < 400 * 400) paintSignalHead(head, signalState(head.signal, head.dir, this.clock));
    }

    // keep the sun's shadow box centred on the car and the sky around the camera
    const p = this.car.root.position;
    // follow the car, snapped to whole shadow-map texels so edges do not shimmer
    const q = this.shadowTexel;
    const sx = Math.round(p.x / q) * q, sz = Math.round(p.z / q) * q;
    this.sun.target.position.set(sx, p.y, sz);
    this.sun.position.set(sx, p.y, sz).addScaledVector(this.sunDir, 220);
    this.sky.position.copy(this.camera.position);
    // hide distant clutter tiles a few times a second; drift the lake ripples
    this.cullTimer = (this.cullTimer || 0) - dt;
    if (this.cullTimer <= 0) {
      this.cullTimer = 0.25;
      cullTiles(this.worldGroup, this.camera.position, this.scene.fog.far);
    }
    const wm = this.worldGroup.userData.waterMap;
    if (wm) wm.offset.set((this.clock * 0.004) % 1, (this.clock * 0.0025) % 1);

    const kmh = Math.abs(this.phys.v) * 3.6;
    const blinkOn = Math.floor(this.clock * 2.6) % 2 === 0;
    const blink = { left: (this.indicators.left || this.hazard) && blinkOn, right: (this.indicators.right || this.hazard) && blinkOn };
    if ((this.indicators.left || this.indicators.right || this.hazard) && blinkOn !== this.lastBlink) this.audio.tick(blinkOn);
    this.lastBlink = blinkOn;
    this.car.lights.indMat.left.emissive.set(blink.left ? '#ff9a00' : '#000000');
    this.car.lights.indMat.right.emissive.set(blink.right ? '#ff9a00' : '#000000');
    this.car.lights.indMat.left.emissiveIntensity = this.car.lights.indMat.right.emissiveIntensity = 2.4;
    this.car.lights.tailMat.emissive.set(this.phys.braking ? '#ff1a1a' : this.lighting.headlights ? '#b00808' : '#5a0303');
    this.car.lights.tailMat.emissiveIntensity = this.phys.braking ? 2.2 : 1;
    this.lighting.update();
    this.car.lights.revMat.emissive.set(this.phys.gear === 'R' ? '#ffffff' : '#000000');
    this.car.interior.gauges.draw({ kmh, rpm: this.phys.rpm, gear: this.phys.displayGear(), blinkLeft: blink.left, blinkRight: blink.right }, now || 0);
    if (this.rig.mode === 'cockpit') this.car.interior.display.draw(this.screenState(), now || 0);
    const ph = this.phys, driving = this.state === 'driving';
    this.audio.update({
      rpm: ph.rpm, throttle: driving ? (ph.gear === 'R' ? input.brake : input.throttle) : 0, speed: Math.abs(ph.v), slip: ph.slip,
      brake: driving ? ph.brakeAmt || 0 : 0, latAcc: ph.latAcc || 0, shifting: ph.shiftTimer > 0.12, handbrake: driving && !!ph.handbrakeOn,
      inside: this.rig.mode === 'cockpit', reverse: ph.gear === 'R',
    });
    this.hud.update({
      kmh, limit: this.phys.surface?.road.s ?? this.rules.limit ?? 30, gear: this.phys.gear === 'R' ? 'R' : 'D', time: this.time,
      remaining: this.nav.remaining, progress: this.nav.progress, progressPct: (this.nav.progress / this.nav.length) * 100,
      faults: this.rules.faults.length, next: this.nav.next(), blinkLeft: blink.left, blinkRight: blink.right,
      rpm: this.phys.rpm, gearNum: this.phys.autoGear || 1, throttle: this.state === 'driving' ? input.throttle : 0,
      lights: this.lighting.headlights, hazard: this.hazard, handbrake: this.state === 'driving' && input.handbrake,
    });
  }

  // What the car's centre screen shows: clock, weather, radio and the trip so far.
  screenState() {
    const mins = this.tod.clock * 60 + this.time / 60 * 1; // the clock runs in real time
    const hh = Math.floor(mins / 60) % 24, mm = Math.floor(mins % 60);
    const temp = { morning: 26, noon: 33, evening: 30, night: 25 }[this.settings.time] ?? 31;
    const stations = [['92.7', 'Telugu film songs'], ['94.3', 'Traffic update · Hyderabad'], ['98.3', 'Evening request show'], ['104.8', 'Classic Hindi hits']];
    const st = stations[Math.floor(this.time / 180) % stations.length];
    const avg = this.time > 5 ? (this.rules.distance / this.time) * 3.6 : 0;
    return {
      clock: `${hh % 12 || 12}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`, temp,
      station: st[0], track: st[1], lights: this.lighting.headlights,
      trip: `${(this.rules.distance / 1000).toFixed(1)} km`, avg: `${Math.round(avg)} km/h`, time: fmtTime(this.time),
    };
  }

  handleIndicators(input) {
    const ind = this.indicators;
    if (input.took('KeyQ')) { ind.left = !ind.left; ind.right = false; ind.peak = 0; }
    if (input.took('KeyE')) { ind.right = !ind.right; ind.left = false; ind.peak = 0; }
    // self-cancel once a turn in that direction has been made and the wheel straightens
    const s = this.phys.steer / 0.6;
    if (ind.left) { ind.peak = Math.max(ind.peak, -s); if (ind.peak > 0.35 && s > -0.06) ind.left = false; }
    if (ind.right) { ind.peak = Math.max(ind.peak, s); if (ind.peak > 0.35 && s < 0.06) ind.right = false; }
    this.touchUi?.update(ind);
  }

  // Spoken directions, worded and timed the way navigation apps do it:
  //   a long stretch ahead  "Continue on HITEC City Road for 1.2 kilometres."
  //   about 500 m out       "In 500 metres, turn left onto Inorbit Mall Road." (at speed only)
  //   about 200 m out       "In 200 metres, turn left onto Inorbit Mall Road."
  //   at the turn           "Turn left onto Inorbit Mall Road, then turn right."
  // Distances are rounded as the apps round them, and the last call comes a few seconds
  // before the turn, sooner the faster the car is going.
  voice() {
    const n = this.nav.next();
    if (!n) return;
    const list = this.nav.instructions, i = list.indexOf(n);
    const d = n.at - this.nav.progress;
    const v = Math.abs(this.phys.v);
    const key = `${n.at}`;
    const turn = (s) => `${TURN_TEXT[s.type].toLowerCase()}${s.street ? ` onto ${s.street}` : ''}`;
    const dist = (m) => {
      if (m >= 950) {
        const km = Math.round(m / 100) / 10;
        return km === 1 ? '1 kilometre' : `${km} kilometres`;
      }
      return `${m >= 300 ? Math.round(m / 100) * 100 : Math.max(50, Math.round(m / 50) * 50)} metres`;
    };
    const say = (tag, text) => { if (!this.spoken.has(key + tag)) { this.spoken.add(key + tag); this.audio.say(text); } };
    if (n.type === 'arrive') {
      if (d < 215 && d > 60) say('prep', `In ${dist(d)}, you will reach your destination.`);
      return;
    }
    // just after a turn, with a long way to the next one: how long to keep going
    const prev = list[i - 1];
    if (prev?.street && d > 900 && this.nav.progress - prev.at > 20) say('cont', `Continue on ${prev.street} for ${dist(d)}.`);
    if (d < 520 && d > 430 && v > 11) say('far', `In ${dist(d)}, ${turn(n)}.`);
    else if (d < 215 && d > Math.max(70, v * 6)) say('prep', `In ${dist(d)}, ${turn(n)}.`);
    // the last call: a few seconds out; a second turn close behind gets a "then"
    const after = list[i + 1];
    const then = after && after.type !== 'arrive' && after.at - n.at < 130 ? `, then ${TURN_TEXT[after.type].toLowerCase()}` : '';
    if (d < Math.max(30, v * 3.2)) {
      say('now', `${TURN_TEXT[n.type]}${n.street ? ` onto ${n.street}` : ''}${then}.`);
      if (then) this.spoken.add(`${after.at}prep`); // already announced: at it, just "Turn right"
    }
  }

  syncCar(dt) {
    const p = this.phys, c = this.car;
    const b = p.body;
    // draw the car between the last two physics steps: smooth at any frame rate
    const k = Math.min(1, (this.acc || 0) / STEP);
    // ground slope plus the sprung body's own pitch, roll and bounce
    const pitch = p.pitch + b.pitch, roll = -p.roll + b.roll;
    const pp = this.prevPose || { x: p.x, y: p.y, h: p.h, heading: p.heading, pitch, roll, heave: b.heave };
    const ix = pp.x + (p.x - pp.x) * k, iy = pp.y + (p.y - pp.y) * k, ih = pp.h + (p.h - pp.h) * k;
    const iheading = pp.heading + angleDiff(pp.heading, p.heading) * k;
    c.root.position.set(ix, ih + pp.heave + (b.heave - pp.heave) * k, -iy);
    c.root.rotation.y = -iheading;
    c.body.rotation.x = pp.pitch + (pitch - pp.pitch) * k;
    c.body.rotation.z = pp.roll + (roll - pp.roll) * k;
    c.wheels.forEach((w, i) => {
      if (w.front) w.steer.rotation.y = -p.steer;
      w.spin.rotation.x = -p.wheelSpin;
      // each wheel follows the ground under it (kerbs, humps, cross-slope)
      w.steer.position.y = CAR.wheelR + clamp(p.wheelZ[i] - b.heave, -0.12, 0.14);
    });
    c.interior.wheelSpin.rotation.z = -(p.steer / 0.6) * 2.6;
  }

  resetToRoute() {
    const pose = this.nav.resetPose();
    this.phys.place(pose.x, pose.y, pose.h, pose.heading);
    // clear any vehicle standing where the car is put back
    for (const v of this.traffic.vehicles) if (Math.hypot(v.x - pose.x, v.y - pose.y) < 8 + v.length / 2) v.dead = true;
    this.prevPose = null; // don't blend from where the car was before the jump
    this.rig.first = true;
    this.toast('Back on the route', 'info', 1500);
  }

  toast(text, kind = 'bad', ms) { this.hud.toast(text, kind, ms); }

  // ---------- overlays ----------
  showOverlay(html, bind) {
    this.closeOverlay();
    const o = document.createElement('div');
    o.className = 'overlay';
    o.innerHTML = `<div class="dialog">${html}</div>`;
    this.root.appendChild(o);
    this.overlay = o;
    bind?.(o);
  }
  closeOverlay() {
    this.overlay?.remove();
    this.overlay = null;
    this.helpOpen = false;
  }

  pause() {
    this.prevState = this.state;
    this.state = 'paused';
    this.audio.horn(false);
    this.audio.quiet(true); // engine, tyres and traffic go silent while paused
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    this.showOverlay(
      `<h2>Paused</h2><p class="sub">${this.world.name} · ${fmtTime(this.time)} · ${this.rules.faults.length} faults so far</p>
       <div class="actions"><button class="primary" data-a="resume">Resume</button><button class="secondary" data-a="restart">Restart</button><button class="secondary" data-a="exit">Choose another route</button></div>`,
      (o) => o.addEventListener('click', (e) => {
        const a = e.target.closest('button')?.dataset.a;
        if (a === 'resume') this.resume();
        if (a === 'restart') this.onExit('restart');
        if (a === 'exit') this.onExit('menu');
      }),
    );
  }

  resume() {
    this.closeOverlay();
    this.state = this.prevState === 'countdown' ? 'countdown' : 'driving';
    this.audio.quiet(false);
    this.last = performance.now();
    this.renderer.domElement.focus();
  }

  toggleHelp() {
    if (this.helpOpen) {
      this.closeOverlay();
      if (this.state === 'paused' && this.pausedForHelp) this.resume();
      return;
    }
    const wasDriving = this.state === 'driving' || this.state === 'countdown';
    if (wasDriving) { this.prevState = this.state; this.state = 'paused'; }
    this.pausedForHelp = wasDriving;
    const k = (s) => s.split(' ').map((x) => `<kbd>${x}</kbd>`).join(' ');
    this.showOverlay(
      `<h2>Controls</h2><p class="sub">The car is an automatic. Hold brake at a standstill to engage reverse.</p>
       <div class="help-grid">
         <div>${k('↑ W')}</div><div>Accelerate</div>
         <div>${k('↓ S')}</div><div>Brake · hold when stopped for reverse</div>
         <div>${k('← →')} ${k('A D')}</div><div>Steer</div>
         <div>${k('Space')}</div><div>Handbrake</div>
         <div>${k('Q')} ${k('E')}</div><div>Left / right indicator (cancels itself after the turn)</div>
         <div>${k('H')}</div><div>Horn (hold)</div>
         <div>${k('L')}</div><div>Headlights on / off</div>
         <div>${k('X')}</div><div>Hazard lights</div>
         <div>${k('C')}</div><div>Switch between chase and driver’s view</div>
         <div>Mouse drag</div><div>Look around · double-click to recentre</div>
         <div>${k('R')}</div><div>Return to the route</div>
         <div>${k('M')}</div><div>Sound on / off</div>
         <div>${k('Esc')}</div><div>Pause</div>
         <div>Gamepad</div><div>Left stick steer · RT / LT throttle and brake · LB / RB indicators · Y camera</div>
       </div>
       <p class="sub" style="margin-top:16px">Blue band: your lane on the route. White wheel tracks: where your steering is taking you; amber means you will leave the road, red means you will hit something.</p>
       <div class="actions"><button class="primary" data-a="close">Back to driving</button></div>`,
      (o) => o.querySelector('[data-a="close"]').addEventListener('click', () => this.toggleHelp()),
    );
    this.helpOpen = true;
  }

  finish() {
    if (this.state === 'finished') return;
    this.state = 'finished';
    this.phys.v = 0;
    this.audio.horn(false);
    this.audio.quiet(true);
    this.hud.banner(null);
    this.audio.say('You have arrived at your destination.');
    // a picture of the moment of arrival for the score card (read straight after drawing,
    // while the frame is still in the canvas)
    let shot = null;
    try {
      this.renderer.render(this.scene, this.camera);
      const src = this.renderer.domElement;
      shot = document.createElement('canvas');
      shot.width = src.width;
      shot.height = src.height;
      shot.getContext('2d').drawImage(src, 0, 0);
    } catch {
      shot = null;
    }
    const score = this.rules.score();
    const stars = score >= 95 ? 5 : score >= 85 ? 4 : score >= 70 ? 3 : score >= 50 ? 2 : 1;
    const avg = this.time > 0 ? (this.rules.distance / this.time) * 3.6 : 0;
    const faults = this.rules.faults;
    // personal best for this route, kept in this browser
    let best = null, isBest = false;
    try {
      const all = JSON.parse(localStorage.getItem('hyd-drive-best') || '{}');
      best = all[this.world.id] || null;
      isBest = !best || score > best.score || (score === best.score && this.time < best.time);
      if (isBest) {
        all[this.world.id] = { score, time: Math.round(this.time), date: new Date().toISOString().slice(0, 10) };
        localStorage.setItem('hyd-drive-best', JSON.stringify(all));
      }
    } catch {
      /* storage unavailable: no personal bests this visit */
    }
    const bestLine = isBest
      ? `<p class="best new">New personal best on this route${best ? ` (was ${best.score} in ${fmtTime(best.time)})` : ''}</p>`
      : `<p class="best">Your best here: ${best.score} in ${fmtTime(best.time)}</p>`;
    const list = faults.length
      ? `<ul class="fault-list">${faults.map((f) => `<li><span class="t">${fmtTime(f.t - 3)}</span><div><div class="what">${f.what}</div><div class="advice">${f.advice}</div></div></li>`).join('')}</ul>`
      : '<p class="sub">No faults. A clean drive — try a harder route or turn the traffic up.</p>';
    // a challenge from a friend's link, for this route
    const ch = this.settings.challenge?.route === this.world.id ? this.settings.challenge : null;
    const result = verdict(ch, score, this.time);
    let myName = '';
    try {
      myName = localStorage.getItem('sawari-name') || '';
    } catch {
      /* no storage */
    }
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    this.showOverlay(
      `<h2>You made it</h2><p class="sub">${this.world.name} · ${this.world.area}</p>
       <div class="score"><span class="num">${score}</span><span class="stars">${'★'.repeat(stars)}${'☆'.repeat(5 - stars)}</span></div>
       ${result ? `<p class="versus ${result.won ? 'won' : ''}">${esc(result.text)}</p>` : ''}
       ${bestLine}
       <div class="stat-grid">
         <div class="stat"><div class="k">Time</div><div class="v">${fmtTime(this.time)}</div></div>
         <div class="stat"><div class="k">Distance</div><div class="v">${(this.rules.distance / 1000).toFixed(2)} km</div></div>
         <div class="stat"><div class="k">Average</div><div class="v">${Math.round(avg)} km/h</div></div>
       </div>
       <div class="share-drive">
         <label class="share-name">Your name for the card and challenge <span>(optional)</span><input data-name maxlength="24" autocomplete="nickname" value="${esc(myName)}" placeholder="e.g. Kiran" /></label>
         <div class="actions"><button class="primary" data-a="card">Share score card</button><button class="secondary" data-a="challenge">Challenge a friend</button></div>
         <div class="share-panel" hidden></div>
         <p class="share-msg" role="status" aria-live="polite"></p>
       </div>
       ${list}
       <div class="actions"><button class="primary" data-a="restart">Drive it again</button><button class="secondary" data-a="exit">Choose another route</button></div>`,
      (o) => {
        const msg = o.querySelector('.share-msg'), nameIn = o.querySelector('[data-name]');
        const name = () => {
          const n = nameIn.value.replace(/[<>&"]/g, '').trim().slice(0, 24);
          try {
            localStorage.setItem('sawari-name', n);
          } catch {
            /* no storage */
          }
          return n;
        };
        const link = (n) => challengeLink({ route: this.world.id, time: this.settings.time, traffic: this.settings.traffic, score, secs: this.time, name: n });
        const words = () =>
          result?.won
            ? `I beat ${result.who} on ${this.world.name} in Sawari: ${score} against ${result.theirs}! It's the free driving simulator on real Hyderabad roads. Your turn:`
            : `I scored ${score}/100 ${'★'.repeat(stars)} on ${this.world.name} in Sawari, the free driving simulator on real Hyderabad roads. Can you beat me?`;
        o.addEventListener('click', async (e) => {
          const b = e.target.closest('button');
          const a = b?.dataset.a;
          if (a === 'restart' || a === 'exit') return this.onExit(a === 'restart' ? 'restart' : 'menu');
          if (a === 'card') {
            b.disabled = true;
            msg.textContent = 'Making your score card…';
            const n = name();
            const blob = await scoreCard({ shot, route: this.world.name, area: this.world.area, score, stars, secs: this.time, km: this.rules.distance / 1000, faults: faults.length, name: n, result });
            const how = await shareCard(blob, `${words()} ${link(n)}`);
            msg.textContent = {
              shared: 'Shared. Your friends can tap the link to take you on.',
              cancelled: '',
              'downloaded-copied': 'Score card saved to your downloads, and the challenge message is copied: paste it with the picture.',
              downloaded: 'Score card saved to your downloads.',
            }[how];
            b.disabled = false;
          }
          // "Challenge a friend" opens the share row (like the website footer); it is built
          // when opened, so it carries the name as it is typed now
          if (a === 'challenge') {
            const panel = o.querySelector('.share-panel');
            const opening = panel.hidden;
            if (opening) {
              const n = name();
              panel.innerHTML = `<p class="share-hint">Send ${n ? 'your' : 'the'} challenge to a friend:</p>${socialRow(words(), link(n))}`;
            }
            panel.hidden = !opening;
            b.setAttribute('aria-expanded', String(opening));
            msg.textContent = '';
          }
          const s = e.target.closest('[data-share]')?.dataset.share;
          if (s) {
            const n = name(), url = link(n);
            if (s === 'copy') msg.textContent = (await copyText(url)) ? 'Challenge link copied: paste it in a chat.' : `Copy this link: ${url}`;
            if (s === 'instagram') msg.textContent = (await copyText(`${words()} ${url}`)) ? 'Caption copied: share your score card to Instagram and paste it there.' : '';
            if (s === 'more') {
              const how = await shareLink(words(), url);
              msg.textContent = how === 'shared' ? 'Challenge sent.' : '';
            }
          }
        });
      },
    );
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    removeEventListener('resize', this.onResize);
    document.removeEventListener('visibilitychange', this.onHide);
    removeEventListener('pagehide', this.onLeave);
    this.input.dispose();
    this.touchUi?.dispose();
    this.root.removeEventListener('pointerdown', this.unlockAudio);
    this.audio.horn(false);
    this.audio.stop();
    this.hud.dispose();
    this.closeOverlay();
    this.traffic.clear();
    this.people.clear();
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) for (const m of [].concat(o.material)) { m.map?.dispose(); m.dispose(); }
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
