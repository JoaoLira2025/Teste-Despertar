import * as THREE from "three";
import type { Hand } from "../tracking/handTracker";
import { handScale } from "../gestures/gestures";
import { getDivineTextures } from "./divineTextures";
import { BoltBatch, boltPoints, type LayerCfg, type P } from "./boltBatch";

type RGB = [number, number, number];

const GLOBE_SCALE = 0.55;     // tamanho do globo em relação à mão (o orbe normal usa 0.35)
const GLOBE_UV = 0.4;         // raio da esfera dentro do quadrado do shader
const REGEN_EVERY = 2;        // recalcula os raios a cada N frames
const STRIKE_FRAMES = 10;     // duração do raio que cai do céu
const STRIKE_MIN_MS = 1800;   // intervalo entre julgamentos: de 1,8 s...
const STRIKE_RANGE_MS = 1400; // ...até 3,2 s
const MOTES = 8;

// Raios dourados com núcleo branco
const JUDGEMENT_LAYERS: LayerCfg[] = [
  { width: 36, color: [1.3, 0.7, 0.15], alpha: 0.5, power: 2.5 },
  { width: 11, color: [1.7, 1.25, 0.5], alpha: 0.9, power: 1.4 },
  { width: 4, color: [1.8, 1.75, 1.55], alpha: 1.0, power: 0.7 },
];

const plane = new THREE.PlaneGeometry(2, 2);

function makeLayer(map: THREE.Texture, rgb: RGB): THREE.Mesh {
  const material = new THREE.MeshBasicMaterial({
    map,
    color: new THREE.Color(rgb[0], rgb[1], rgb[2]),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide, // a câmera tem o eixo Y invertido
  });
  return new THREE.Mesh(plane, material);
}

function place(mesh: THREE.Mesh, x: number, y: number, sx: number, sy: number, opacity: number, rotation = 0): void {
  mesh.position.set(x, y, 0);
  mesh.scale.set(sx, sy, 1);
  mesh.rotation.z = rotation;
  (mesh.material as THREE.MeshBasicMaterial).opacity = opacity;
}

/* --------------------------------- Shader do globo --------------------------------- */

const globeVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const globeFragment = /* glsl */ `
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
    for (int i = 0; i < 4; i++) {
      v += a * noise(p);
      p = p * 2.0 + vec2(17.0, 5.0);
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec2 p = (vUv - 0.5) * 2.0;
    float d = length(p);
    float R = ${GLOBE_UV.toFixed(2)};
    float t = uTime;

    // Esfera
    vec2 q = p / R;
    float r2 = min(dot(q, q), 1.0);
    float z = sqrt(1.0 - r2);

    // Interior: névoa dourada girando devagar, com núcleo branco
    float cs = cos(t * 0.4);
    float sn = sin(t * 0.4);
    vec2 w = mat2(cs, -sn, sn, cs) * q * 1.6;
    float n = fbm(w + vec2(t * 0.2, -t * 0.15));
    float core = pow(z, 2.2);
    vec3 gold = vec3(1.0, 0.8, 0.35);
    vec3 white = vec3(1.0, 0.97, 0.85);
    vec3 col = mix(gold, white, core) * (0.25 + 0.75 * n) * (0.5 + 0.9 * core);

    // Vidro: aro brilhante nas bordas (fresnel)
    float rim = pow(1.0 - z, 3.0);
    col += vec3(1.0, 0.85, 0.5) * rim * (0.9 + 1.2 * uFlash);

    float inside = 1.0 - smoothstep(R * 0.97, R, d);

    // Aura em volta
    float outside = max(d - R, 0.0) / (1.0 - R);
    float aura = pow(clamp(1.0 - outside, 0.0, 1.0), 3.0) * 0.45 * (1.0 - inside);

    vec3 rgb = col * inside + vec3(1.0, 0.8, 0.4) * aura * (0.8 + 1.5 * uFlash);
    rgb += vec3(1.0, 0.95, 0.8) * uFlash * 0.5 * inside; // clarão do julgamento

    gl_FragColor = vec4(rgb, uLevel);
  }
`;

/* --------------------------- Brilho nas pontas dos dedos --------------------------- */

const glowVertex = /* glsl */ `
  uniform float uSize;
  void main() {
    gl_PointSize = uSize;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const glowFragment = /* glsl */ `
  uniform float uAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float g = exp(-d * d * 4.0) * (1.0 - smoothstep(0.8, 1.0, d));
    gl_FragColor = vec4(vec3(1.7, 1.4, 0.8), g * uAlpha);
  }
`;

/* ------------------------------ Estrelinhas orbitando ------------------------------ */

const moteVertex = /* glsl */ `
  attribute float aSize;
  void main() {
    gl_PointSize = aSize;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const moteFragment = /* glsl */ `
  uniform float uAlpha;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float arm = max(
      exp(-abs(c.x) * 50.0 - abs(c.y) * 6.0),
      exp(-abs(c.y) * 50.0 - abs(c.x) * 6.0)
    );
    float core = exp(-length(c) * 12.0);
    gl_FragColor = vec4(vec3(1.0, 0.9, 0.6) * 1.4, (arm + core) * uAlpha);
  }
`;

/* ----------------------------------- Efeito ----------------------------------- */

/**
 * Globo do Julgamento (pinça + "L"): o orbe angelical vira um globo de plasma dourado.
 * Os dedos do "L" atraem os filamentos e, de tempos em tempos, um raio cai do céu sobre o globo.
 */
export class JudgementGlobeGL {
  private level = 0;
  private wasActive = false;

  private cx = 0;
  private cy = 0;
  private r = 0;
  private drawR = 0;
  private tipT: P = { x: 0, y: 0 }; // polegar do "L"
  private tipI: P = { x: 0, y: 0 }; // indicador do "L"

  private strike = 0;
  private strikeX = 0;
  private nextStrike = 0;
  private shock = -1; // progresso da onda de choque (0..1); -1 = inativa
  private flash = 0;

  private frame = 0;
  private flicker = 1;

  private readonly pivot = new THREE.Group();
  private readonly globe: THREE.Mesh;
  private readonly globeMat: THREE.ShaderMaterial;
  private readonly sunburst: THREE.Mesh;
  private readonly halo: THREE.Mesh;
  private readonly shockMesh: THREE.Mesh;
  private readonly bolts: BoltBatch;

  private readonly motePos = new Float32Array(MOTES * 3);
  private readonly moteSize = new Float32Array(MOTES);
  private readonly moteAttrPos: THREE.BufferAttribute;
  private readonly moteAttrSize: THREE.BufferAttribute;
  private readonly moteMat: THREE.ShaderMaterial;

  private readonly glowPos = new Float32Array(6);
  private readonly glowAttr: THREE.BufferAttribute;
  private readonly glowMat: THREE.ShaderMaterial;
  private readonly glowPoints: THREE.Points;

  constructor(scene: THREE.Scene) {
    const div = getDivineTextures();

    this.globeMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uLevel: { value: 0 }, uFlash: { value: 0 } },
      vertexShader: globeVertex,
      fragmentShader: globeFragment,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.globe = new THREE.Mesh(plane, this.globeMat);
    this.sunburst = makeLayer(div.sunburst, [1.0, 0.75, 0.25]);
    this.halo = makeLayer(div.halo, [1.8, 1.4, 0.5]);
    this.shockMesh = makeLayer(div.halo, [1.7, 1.3, 0.6]);
    this.shockMesh.visible = false;

    // Estrelinhas: filhas do pivot, herdam a posição do globo
    const moteGeo = new THREE.BufferGeometry();
    this.moteAttrPos = new THREE.BufferAttribute(this.motePos, 3);
    this.moteAttrSize = new THREE.BufferAttribute(this.moteSize, 1);
    moteGeo.setAttribute("position", this.moteAttrPos);
    moteGeo.setAttribute("aSize", this.moteAttrSize);
    this.moteMat = new THREE.ShaderMaterial({
      uniforms: { uAlpha: { value: 0 } },
      vertexShader: moteVertex,
      fragmentShader: moteFragment,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });
    const motes = new THREE.Points(moteGeo, this.moteMat);
    motes.frustumCulled = false;

    this.pivot.add(this.sunburst, this.globe, this.halo, this.shockMesh, motes);
    this.pivot.visible = false;
    scene.add(this.pivot);

    this.bolts = new BoltBatch(scene, JUDGEMENT_LAYERS, 1536);

    const glowGeo = new THREE.BufferGeometry();
    this.glowAttr = new THREE.BufferAttribute(this.glowPos, 3);
    glowGeo.setAttribute("position", this.glowAttr);
    this.glowMat = new THREE.ShaderMaterial({
      uniforms: { uSize: { value: 60 }, uAlpha: { value: 0 } },
      vertexShader: glowVertex,
      fragmentShader: glowFragment,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });
    this.glowPoints = new THREE.Points(glowGeo, this.glowMat);
    this.glowPoints.frustumCulled = false;
    this.glowPoints.visible = false;
    scene.add(this.glowPoints);
  }

  update(
    pinch: Hand | null,
    spark: Hand | null,
    active: boolean,
    now: number,
    aspect: number,
    w: number,
    h: number,
  ): void {
    if (pinch) {
      // O globo nasce entre as pontas do polegar e do indicador da mão em pinça
      const tx = ((pinch[4].x + pinch[8].x) / 2) * w;
      const ty = ((pinch[4].y + pinch[8].y) / 2) * h;
      const tr = handScale(pinch, aspect) * h * GLOBE_SCALE;
      if (this.level === 0) {
        this.cx = tx; this.cy = ty; this.r = tr;
      } else {
        this.cx += (tx - this.cx) * 0.5;
        this.cy += (ty - this.cy) * 0.5;
        this.r += (tr - this.r) * 0.5;
      }
    }
    if (spark) {
      this.tipT = { x: spark[4].x * w, y: spark[4].y * h };
      this.tipI = { x: spark[8].x * w, y: spark[8].y * h };
    }

    this.level = active ? Math.min(1, this.level + 0.1) : Math.max(0, this.level - 0.08);
    const visible = this.level > 0.01;
    this.pivot.visible = visible;
    this.bolts.setVisible(visible);
    this.glowPoints.visible = visible;
    if (!visible) {
      this.wasActive = false;
      this.strike = 0;
      this.shock = -1;
      this.flash = 0;
      return;
    }

    // Ao montar a fusão: clarão + onda de choque, e o primeiro julgamento logo em seguida
    if (active && !this.wasActive) {
      this.flash = 0.8;
      this.shock = 0;
      this.nextStrike = now + 350;
    }
    this.wasActive = active;

    // O julgamento: um raio cai do topo da tela sobre o globo
    if (active && this.strike <= 0 && now >= this.nextStrike) {
      this.strike = STRIKE_FRAMES;
      this.strikeX = Math.min(w, Math.max(0, this.cx + (Math.random() - 0.5) * 220));
      this.flash = 1;
      this.shock = 0;
      this.nextStrike = now + STRIKE_MIN_MS + Math.random() * STRIKE_RANGE_MS;
    }
    this.flash *= 0.85;
    if (this.shock >= 0) {
      this.shock += 0.04;
      if (this.shock > 1) this.shock = -1;
    }

    const L = this.level;
    const r = this.r * (0.75 + 0.25 * L) * (1 + 0.05 * Math.sin(now / 200)) * (1 + 0.15 * this.flash);
    this.drawR = r;

    // Globo, sol de raios, auréola e onda de choque
    this.pivot.position.set(this.cx, this.cy, 0);
    const half = r / GLOBE_UV;
    this.globe.scale.set(half, half, 1);
    this.globeMat.uniforms.uTime.value = now / 1000;
    this.globeMat.uniforms.uLevel.value = L;
    this.globeMat.uniforms.uFlash.value = Math.min(1.3, this.flash);

    place(this.sunburst, 0, 0, r * 3.2, r * 3.2, L * 0.35 * (0.8 + 0.2 * Math.sin(now / 400)), now / 9000);
    place(this.halo, 0, -r * 2.0, r * 1.1, r * 0.3, L * (0.7 + 0.25 * Math.sin(now / 350)));

    if (this.shock >= 0) {
      const p = this.shock;
      this.shockMesh.visible = true;
      const s = (r * (1.2 + 3.0 * p)) / 0.78;
      place(this.shockMesh, 0, 0, s, s, L * (1 - p) * 0.9);
    } else {
      this.shockMesh.visible = false;
    }

    // Estrelinhas orbitando
    const orbit = r * 1.6;
    for (let k = 0; k < MOTES; k++) {
      const ang = now / 1700 + (k * Math.PI * 2) / MOTES;
      this.motePos[k * 3] = Math.cos(ang) * orbit;
      this.motePos[k * 3 + 1] = Math.sin(ang) * orbit;
      this.motePos[k * 3 + 2] = 0;
      this.moteSize[k] = 14 + 8 * Math.sin(now / 300 + k * 1.7);
    }
    this.moteAttrPos.needsUpdate = true;
    this.moteAttrSize.needsUpdate = true;
    this.moteMat.uniforms.uAlpha.value = L;

    // Raios (filamentos, arcos para os dedos, julgamento)
    if (this.frame++ % REGEN_EVERY === 0) {
      this.flicker = 0.8 + 0.2 * Math.random();
      this.rebuild();
    }
    if (this.strike > 0) this.strike--;
    this.bolts.setAlpha(L * this.flicker);

    // Brilho nas pontas dos dedos
    this.glowPos[0] = this.tipT.x; this.glowPos[1] = this.tipT.y; this.glowPos[2] = 0;
    this.glowPos[3] = this.tipI.x; this.glowPos[4] = this.tipI.y; this.glowPos[5] = 0;
    this.glowAttr.needsUpdate = true;
    this.glowMat.uniforms.uSize.value = 55 + 25 * this.flash;
    this.glowMat.uniforms.uAlpha.value = L * (0.7 + 0.3 * this.flash);
  }

  private rebuild(): void {
    const r = this.drawR;
    const C: P = { x: this.cx, y: this.cy };
    this.bolts.begin();

    // 1. Filamentos de plasma do núcleo até o vidro. Metade deles é "atraída" pelos dedos do "L".
    const toward = (tip: P): number => Math.atan2(tip.y - C.y, tip.x - C.x) + (Math.random() - 0.5) * 0.7;
    for (let k = 0; k < 9; k++) {
      const a = k < 3 ? toward(this.tipT) : k < 6 ? toward(this.tipI) : Math.random() * Math.PI * 2;
      const len = r * (0.85 + Math.random() * 0.15);
      const end = { x: C.x + Math.cos(a) * len, y: C.y + Math.sin(a) * len };
      this.bolts.addStrand(
        boltPoints(C, end, r * 0.16, 8, 14),
        (t) => 0.4 + 0.3 * Math.sin(Math.PI * t),
        0.6 + 0.5 * this.flash,
      );
    }

    // 2. Arcos grossos: do núcleo, atravessando o vidro, até as pontas dos dedos
    for (const tip of [this.tipT, this.tipI]) {
      const len = Math.hypot(tip.x - C.x, tip.y - C.y);
      if (len < r * 1.05) continue; // a ponta do dedo está dentro do globo
      const jit = Math.min(24, len * 0.12);
      const main = boltPoints(C, tip, jit, 12, 40);
      this.bolts.addStrand(main, (t) => 0.55 + 0.45 * Math.sin(Math.PI * t), 1.6 + 0.6 * this.flash);

      const baseAng = Math.atan2(tip.y - C.y, tip.x - C.x);
      const branches = Math.floor(Math.random() * 3);
      for (let b = 0; b < branches; b++) {
        const from = main[Math.floor(main.length * (0.4 + Math.random() * 0.45))];
        const ang = baseAng + (Math.random() < 0.5 ? -1 : 1) * (0.6 + Math.random() * 0.7);
        const bl = len * (0.12 + Math.random() * 0.15);
        const to = { x: from.x + Math.cos(ang) * bl, y: from.y + Math.sin(ang) * bl };
        this.bolts.addStrand(boltPoints(from, to, jit * 0.6, 12, 25), (t) => 0.8 * (1 - t), 0.9);
      }
    }

    // 3. O raio do "L", fraco, entre as pontas dos dedos
    const lenL = Math.hypot(this.tipI.x - this.tipT.x, this.tipI.y - this.tipT.y);
    if (lenL >= 12) {
      this.bolts.addStrand(
        boltPoints(this.tipT, this.tipI, Math.min(20, lenL * 0.15), 14, 40),
        (t) => 0.4 + 0.4 * Math.sin(Math.PI * t),
        0.7,
      );
    }

    // 4. O Julgamento: raio grosso caindo do topo da tela sobre o globo
    if (this.strike > 0) {
      const fade = this.strike / STRIKE_FRAMES;
      const s = { x: this.strikeX, y: -20 };
      const e = { x: C.x, y: C.y - r * 0.3 };
      const len = Math.hypot(e.x - s.x, e.y - s.y);
      const jitter = Math.min(48, len * 0.07);
      const main = boltPoints(s, e, jitter, 15, 60);
      this.bolts.addStrand(main, (t) => 0.8 + 0.4 * Math.sin(Math.PI * t), 2.2 * (0.4 + 0.6 * fade));

      const baseAng = Math.atan2(e.y - s.y, e.x - s.x);
      const branches = 3 + Math.floor(Math.random() * 3);
      for (let b = 0; b < branches; b++) {
        const from = main[Math.floor(main.length * (0.35 + Math.random() * 0.55))];
        const ang = baseAng + (Math.random() < 0.5 ? -1 : 1) * (0.4 + Math.random() * 0.8);
        const bl = len * (0.08 + Math.random() * 0.12);
        const to = { x: from.x + Math.cos(ang) * bl, y: from.y + Math.sin(ang) * bl };
        this.bolts.addStrand(boltPoints(from, to, jitter * 0.6, 14, 30), (t) => 0.8 * (1 - t), 1.2 * fade);
      }
    }

    this.bolts.end();
  }
}