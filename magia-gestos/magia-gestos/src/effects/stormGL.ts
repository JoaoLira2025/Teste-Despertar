import * as THREE from "three";
import type { Hand } from "../tracking/handTracker";
import { BoltBatch, boltPoints, type LayerCfg, type P } from "./boltBatch";

const GRID = 12;        // a janela é uma malha 12x12 deformada pelos 4 cantos
const REGEN_EVERY = 2;  // recalcula os arcos a cada N frames
const STRIKE_FRAMES = 9;

// Paleta violeta-elétrica (o raio individual é azul; este é diferente de propósito)
const STORM_LAYERS: LayerCfg[] = [
  { width: 40, color: [0.45, 0.2, 1.2], alpha: 0.5, power: 2.5 },
  { width: 12, color: [0.7, 0.55, 1.5], alpha: 0.9, power: 1.4 },
  { width: 4, color: [1.3, 1.2, 1.5], alpha: 1.0, power: 0.7 },
];

/* ------------------------- Shader da janela (nuvens) ------------------------- */

const windowVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const windowFragment = /* glsl */ `
  uniform float uTime;
  uniform float uLevel;
  uniform float uFlash;
  varying vec2 vUv;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * noise(p);
      p = p * 2.0 + vec2(17.0, 5.0);
      a *= 0.5;
    }
    return v;
  }

  void main() {
    float t = uTime;
    vec2 p = vUv * vec2(3.0, 2.4);

    // Duas camadas de nuvens andando em direções diferentes
    float c1 = fbm(p + vec2(t * 0.08, t * 0.03));
    float c2 = fbm(p * 1.7 - vec2(t * 0.12, -t * 0.05) + c1 * 1.5);
    float clouds = smoothstep(0.35, 0.85, c2);

    // Veias elétricas (ruído "ridged"): filamentos que correm dentro da nuvem
    float ridge = 1.0 - abs(2.0 * fbm(p * 2.2 + vec2(t * 0.15, -t * 0.1)) - 1.0);
    float vein = pow(ridge, 10.0);

    vec3 deep = vec3(0.05, 0.02, 0.18);
    vec3 mid  = vec3(0.35, 0.15, 0.75);
    vec3 lit  = vec3(0.85, 0.75, 1.5);

    vec3 rgb = mix(deep, mid, clouds) * (0.35 + 0.65 * clouds);
    rgb += lit * clouds * uFlash * (0.4 + 0.6 * c1);                    // nuvens acendem no clarão
    rgb += vec3(0.8, 0.6, 1.6) * vein * (0.35 + 1.2 * uFlash);          // veias acendem também

    // Some suavemente nas bordas da moldura
    vec2 e = min(vUv, 1.0 - vUv);
    float edge = smoothstep(0.0, 0.16, min(e.x, e.y));

    gl_FragColor = vec4(rgb * edge * uLevel, 1.0);
  }
`;

/* ------------------------ Brilhos (cantos + impacto) ------------------------ */

const glowVertex = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  varying float vAlpha;
  void main() {
    vAlpha = aAlpha;
    gl_PointSize = aSize;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const glowFragment = /* glsl */ `
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float g = exp(-d * d * 4.0) * (1.0 - smoothstep(0.8, 1.0, d));
    gl_FragColor = vec4(vec3(0.75, 0.65, 1.6), g * vAlpha);
  }
`;

/* ------------------------------- Utilidades ------------------------------- */

function lerp(a: P, b: P, t: number): P {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function ccw(a: P, b: P, c: P): boolean {
  return (c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x);
}

function segmentsCross(a: P, b: P, c: P, d: P): boolean {
  return ccw(a, c, d) !== ccw(b, c, d) && ccw(a, b, c) !== ccw(a, b, d);
}

/* --------------------------------- Efeito --------------------------------- */

export class StormGL {
  private level = 0;
  private wasActive = false;
  private corners: P[] = [
    { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 },
  ];
  private frame = 0;
  private flash = 0;
  private flicker = 1;
  private nextStrike = 0;
  private strikeFrames = 0;
  private strikePair = 0;
  private strikeS = 0.5;
  private strikeS2 = 0.5;

  private readonly bolts: BoltBatch;
  private readonly win: THREE.Mesh;
  private readonly winMat: THREE.ShaderMaterial;
  private readonly winPos = new Float32Array((GRID + 1) * (GRID + 1) * 3);
  private readonly winAttr: THREE.BufferAttribute;

  private readonly glowPos = new Float32Array(5 * 3);   // 4 cantos + 1 impacto
  private readonly glowSize = new Float32Array(5);
  private readonly glowAlpha = new Float32Array(5);
  private readonly glowAttrs: THREE.BufferAttribute[];
  private readonly glowPoints: THREE.Points;

  constructor(scene: THREE.Scene) {
    this.bolts = new BoltBatch(scene, STORM_LAYERS, 1024);

    // Malha da janela: posições mudam todo frame, UVs e índices são fixos
    const geo = new THREE.BufferGeometry();
    this.winAttr = new THREE.BufferAttribute(this.winPos, 3);
    const uv = new Float32Array((GRID + 1) * (GRID + 1) * 2);
    const index: number[] = [];
    for (let j = 0; j <= GRID; j++) {
      for (let i = 0; i <= GRID; i++) {
        const v = j * (GRID + 1) + i;
        uv[v * 2] = i / GRID;
        uv[v * 2 + 1] = j / GRID;
      }
    }
    for (let j = 0; j < GRID; j++) {
      for (let i = 0; i < GRID; i++) {
        const a = j * (GRID + 1) + i;
        const b = a + 1;
        const c = a + GRID + 1;
        const d = c + 1;
        index.push(a, b, c, b, d, c);
      }
    }
    geo.setAttribute("position", this.winAttr);
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geo.setIndex(index);

    this.winMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uLevel: { value: 0 }, uFlash: { value: 0 } },
      vertexShader: windowVertex,
      fragmentShader: windowFragment,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.win = new THREE.Mesh(geo, this.winMat);
    this.win.frustumCulled = false;
    this.win.visible = false;
    scene.add(this.win);

    // Brilhos
    const glowGeo = new THREE.BufferGeometry();
    const gPos = new THREE.BufferAttribute(this.glowPos, 3);
    const gSize = new THREE.BufferAttribute(this.glowSize, 1);
    const gAlpha = new THREE.BufferAttribute(this.glowAlpha, 1);
    this.glowAttrs = [gPos, gSize, gAlpha];
    glowGeo.setAttribute("position", gPos);
    glowGeo.setAttribute("aSize", gSize);
    glowGeo.setAttribute("aAlpha", gAlpha);
    this.glowPoints = new THREE.Points(
      glowGeo,
      new THREE.ShaderMaterial({
        vertexShader: glowVertex,
        fragmentShader: glowFragment,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.glowPoints.frustumCulled = false;
    this.glowPoints.visible = false;
    scene.add(this.glowPoints);
  }

  update(
    handA: Hand | null,
    handB: Hand | null,
    active: boolean,
    now: number,
    w: number,
    h: number,
  ): void {
    // 1. Os 4 cantos da moldura: polegar e indicador de cada mão
    if (handA && handB) {
      const ta = { x: handA[4].x * w, y: handA[4].y * h };
      const ia = { x: handA[8].x * w, y: handA[8].y * h };
      const tb = { x: handB[4].x * w, y: handB[4].y * h };
      const ib = { x: handB[8].x * w, y: handB[8].y * h };
      // Escolhe a ordem dos cantos que não forma uma "gravata borboleta"
      const crossed = segmentsCross(ta, ia, ib, tb) || segmentsCross(ia, ib, tb, ta);
      this.corners = crossed ? [ta, ia, tb, ib] : [ta, ia, ib, tb];
    }

    // 2. Fade in/out
    this.level = active ? Math.min(1, this.level + 0.1) : Math.max(0, this.level - 0.08);
    const visible = this.level > 0.01;
    this.win.visible = visible;
    this.glowPoints.visible = visible;
    this.bolts.setVisible(visible);
    if (!visible) {
      this.wasActive = false;
      this.strikeFrames = 0;
      this.flash = 0;
      return;
    }

    // 3. Relâmpagos: o primeiro vem logo após a invocação, os outros em intervalos aleatórios
    if (active && !this.wasActive) this.nextStrike = now + 200;
    this.wasActive = active;

    if (active && this.strikeFrames <= 0 && now >= this.nextStrike) {
      this.strikePair = Math.random() < 0.5 ? 0 : 1;
      this.strikeS = 0.2 + Math.random() * 0.6;
      this.strikeS2 = Math.min(0.9, Math.max(0.1, this.strikeS + (Math.random() - 0.5) * 0.5));
      this.strikeFrames = STRIKE_FRAMES;
      this.flash = 1;
      this.nextStrike = now + 500 + Math.random() * 1100;
    }

    this.flash *= 0.84;
    if (this.strikeFrames > 0) {
      // O relâmpago "pisca" duas ou três vezes antes de apagar
      if (this.frame % 2 === 0) this.flash = Math.max(this.flash, 0.55 + 0.45 * Math.random());
      this.strikeFrames--;
    }

    // 4. Reconstrói os arcos (bordas, diagonal ocasional e o relâmpago)
    if (this.frame++ % REGEN_EVERY === 0) {
      this.flicker = 0.8 + 0.2 * Math.random();
      this.rebuildBolts();
    }
    this.bolts.setAlpha(this.level * this.flicker);

    // 5. Janela (malha deformada pelos 4 cantos) e brilhos
    this.updateWindow();
    this.winMat.uniforms.uTime.value = now / 1000;
    this.winMat.uniforms.uLevel.value = this.level;
    this.winMat.uniforms.uFlash.value = Math.min(1.3, this.flash);
    this.updateGlows();
  }

  private strikePoints(): [P, P] {
    const [c0, c1, c2, c3] = this.corners;
    // Par 0: da aresta c0-c1 para a oposta c3-c2. Par 1: de c1-c2 para c0-c3.
    const [p0, p1, p2, p3] = this.strikePair === 0 ? [c0, c1, c2, c3] : [c1, c2, c3, c0];
    return [lerp(p0, p1, this.strikeS), lerp(p3, p2, this.strikeS2)];
  }

  private rebuildBolts(): void {
    const c = this.corners;
    this.bolts.begin();

    // Moldura crepitando
    for (let k = 0; k < 4; k++) {
      const a = c[k];
      const b = c[(k + 1) % 4];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      this.bolts.addStrand(
        boltPoints(a, b, Math.min(14, len * 0.07), 18, 40),
        (t) => 0.35 + 0.35 * Math.sin(Math.PI * t),
        0.6,
      );
    }

    // Faísca diagonal ocasional
    if (Math.random() < 0.35) {
      const k = Math.random() < 0.5 ? 0 : 1;
      const a = c[k];
      const b = c[k + 2];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      this.bolts.addStrand(
        boltPoints(a, b, Math.min(20, len * 0.08), 18, 40),
        (t) => 0.3 + 0.3 * Math.sin(Math.PI * t),
        0.45,
      );
    }

    // O relâmpago principal, com ramificações
    if (this.strikeFrames > 0) {
      const fade = this.strikeFrames / STRIKE_FRAMES;
      const [s, e] = this.strikePoints();
      const len = Math.hypot(e.x - s.x, e.y - s.y);
      const jitter = Math.min(34, len * 0.14);
      const main = boltPoints(s, e, jitter, 14, 60);
      this.bolts.addStrand(main, (t) => 0.55 + 0.45 * Math.sin(Math.PI * t), 1.6 * (0.4 + 0.6 * fade));

      const branches = 3 + Math.floor(Math.random() * 3);
      const baseAng = Math.atan2(e.y - s.y, e.x - s.x);
      for (let k = 0; k < branches; k++) {
        const from = main[Math.floor(main.length * (0.15 + Math.random() * 0.7))];
        const ang = baseAng + (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.9);
        const bl = len * (0.15 + Math.random() * 0.2);
        const to = { x: from.x + Math.cos(ang) * bl, y: from.y + Math.sin(ang) * bl };
        this.bolts.addStrand(boltPoints(from, to, jitter * 0.6, 14, 30), (t) => 0.8 * (1 - t), fade);
      }
    }
    this.bolts.end();
  }

  private updateWindow(): void {
    const [c0, c1, c2, c3] = this.corners;
    for (let j = 0; j <= GRID; j++) {
      const v = j / GRID;
      for (let i = 0; i <= GRID; i++) {
        const u = i / GRID;
        const k = (j * (GRID + 1) + i) * 3;
        // Interpolação bilinear entre os 4 cantos
        this.winPos[k] = (1 - v) * ((1 - u) * c0.x + u * c1.x) + v * ((1 - u) * c3.x + u * c2.x);
        this.winPos[k + 1] = (1 - v) * ((1 - u) * c0.y + u * c1.y) + v * ((1 - u) * c3.y + u * c2.y);
        this.winPos[k + 2] = 0;
      }
    }
    this.winAttr.needsUpdate = true;
  }

  private updateGlows(): void {
    for (let k = 0; k < 4; k++) {
      this.glowPos[k * 3] = this.corners[k].x;
      this.glowPos[k * 3 + 1] = this.corners[k].y;
      this.glowSize[k] = 50 + 30 * this.flash;
      this.glowAlpha[k] = this.level * (0.6 + 0.4 * this.flash);
    }
    // Clarão no ponto de impacto do relâmpago
    if (this.strikeFrames > 0) {
      const [, e] = this.strikePoints();
      this.glowPos[12] = e.x;
      this.glowPos[13] = e.y;
      this.glowSize[4] = 40 + 160 * this.flash;
      this.glowAlpha[4] = this.level * this.flash;
    } else {
      this.glowSize[4] = 0;
      this.glowAlpha[4] = 0;
    }
    for (const a of this.glowAttrs) a.needsUpdate = true;
  }
}