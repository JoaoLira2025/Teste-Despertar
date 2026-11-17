import * as THREE from "three";
import type { Hand } from "../tracking/handTracker";

type P = { x: number; y: number };

const MAX_VERTS = 640;
const MAX_INDICES = MAX_VERTS * 4;
const REGEN_EVERY = 2; // recalcula o zigue-zague a cada N frames

type LayerCfg = { width: number; color: [number, number, number]; alpha: number; power: number };

// Três camadas da mesma geometria: halo largo, corpo e núcleo branco.
// width em pixels; power controla o quão "macia" é a borda (maior = mais suave); cores >1 alimentam o bloom.
const LAYERS: LayerCfg[] = [
  { width: 44, color: [0.15, 0.4, 1.1], alpha: 0.55, power: 2.5 },
  { width: 13, color: [0.45, 0.7, 1.4], alpha: 0.9, power: 1.4 },
  { width: 4.5, color: [1.2, 1.3, 1.5], alpha: 1.0, power: 0.7 },
];

/* ------------------------------- Shaders ------------------------------- */

const ribbonVertex = /* glsl */ `
  attribute vec2 aNormal;
  attribute float aSide;
  attribute float aTaper;
  uniform float uWidth;
  varying float vSide;
  void main() {
    vSide = aSide;
    vec3 p = position + vec3(aNormal * aSide * uWidth * aTaper * 0.5, 0.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const ribbonFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAlpha;
  uniform float uPower;
  varying float vSide;
  void main() {
    float f = 1.0 - abs(vSide);          // 1 no centro da fita, 0 nas bordas
    float a = pow(max(f, 0.0), uPower);
    gl_FragColor = vec4(uColor, a * uAlpha);
  }
`;

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
    gl_FragColor = vec4(vec3(0.6, 0.8, 1.6), g * uAlpha);
  }
`;

/* --------------------------- Geração do raio --------------------------- */

/** Linha em zigue-zague entre a e b (deslocamento aleatório que some nas pontas). */
function boltPoints(a: P, b: P, jitter: number): P[] {
  const len = Math.max(Math.hypot(b.x - a.x, b.y - a.y), 1);
  const n = Math.min(60, Math.max(6, Math.floor(len / 14)));
  const nx = -(b.y - a.y) / len;
  const ny = (b.x - a.x) / len;

  const pts: P[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const taper = Math.sin(Math.PI * t);
    const off = (Math.random() - 0.5) * 2 * jitter * taper;
    pts.push({
      x: a.x + (b.x - a.x) * t + nx * off,
      y: a.y + (b.y - a.y) * t + ny * off,
    });
  }
  return pts;
}

/* -------------------------------- Efeito -------------------------------- */

export class LightningGL {
  private level = 0;
  private a: P = { x: 0, y: 0 }; // ponta do polegar
  private b: P = { x: 0, y: 0 }; // ponta do indicador
  private frame = 0;
  private flicker = 1;

  private readonly pos = new Float32Array(MAX_VERTS * 3);
  private readonly nrm = new Float32Array(MAX_VERTS * 2);
  private readonly side = new Float32Array(MAX_VERTS);
  private readonly taper = new Float32Array(MAX_VERTS);
  private readonly idx = new Uint16Array(MAX_INDICES);
  private vCount = 0;
  private iCount = 0;

  private readonly geo = new THREE.BufferGeometry();
  private readonly aPos: THREE.BufferAttribute;
  private readonly aNrm: THREE.BufferAttribute;
  private readonly aSide: THREE.BufferAttribute;
  private readonly aTaper: THREE.BufferAttribute;
  private readonly index: THREE.BufferAttribute;
  private readonly meshes: THREE.Mesh[] = [];
  private readonly mats: THREE.ShaderMaterial[] = [];

  private readonly glowPos = new Float32Array(6);
  private readonly glowAttr: THREE.BufferAttribute;
  private readonly glowMat: THREE.ShaderMaterial;
  private readonly glowPoints: THREE.Points;

  constructor(scene: THREE.Scene) {
    this.aPos = new THREE.BufferAttribute(this.pos, 3);
    this.aNrm = new THREE.BufferAttribute(this.nrm, 2);
    this.aSide = new THREE.BufferAttribute(this.side, 1);
    this.aTaper = new THREE.BufferAttribute(this.taper, 1);
    this.index = new THREE.BufferAttribute(this.idx, 1);
    this.geo.setAttribute("position", this.aPos);
    this.geo.setAttribute("aNormal", this.aNrm);
    this.geo.setAttribute("aSide", this.aSide);
    this.geo.setAttribute("aTaper", this.aTaper);
    this.geo.setIndex(this.index);
    this.geo.setDrawRange(0, 0);

    for (const L of LAYERS) {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uWidth: { value: L.width },
          uColor: { value: new THREE.Color(L.color[0], L.color[1], L.color[2]) },
          uAlpha: { value: 0 },
          uPower: { value: L.power },
        },
        vertexShader: ribbonVertex,
        fragmentShader: ribbonFragment,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide, // a câmera tem o eixo Y invertido
      });
      const mesh = new THREE.Mesh(this.geo, mat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      scene.add(mesh);
      this.meshes.push(mesh);
      this.mats.push(mat);
    }

    // Brilho nas pontas dos dedos
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

  update(hand: Hand | null, active: boolean, w: number, h: number): void {
    if (hand) {
      this.a = { x: hand[4].x * w, y: hand[4].y * h }; // polegar
      this.b = { x: hand[8].x * w, y: hand[8].y * h }; // indicador
    }

    this.level = active ? Math.min(1, this.level + 0.2) : Math.max(0, this.level - 0.15);

    const len = Math.hypot(this.b.x - this.a.x, this.b.y - this.a.y);
    const visible = this.level > 0.01 && len >= 12;
    for (const m of this.meshes) m.visible = visible;
    this.glowPoints.visible = visible;
    if (!visible) return;

    if (this.frame++ % REGEN_EVERY === 0) {
      this.flicker = 0.7 + 0.3 * Math.random();
      this.rebuild(len);
    }

    LAYERS.forEach((L, i) => {
      this.mats[i].uniforms.uAlpha.value = L.alpha * this.level * this.flicker;
    });

    this.glowPos[0] = this.a.x; this.glowPos[1] = this.a.y; this.glowPos[2] = 0;
    this.glowPos[3] = this.b.x; this.glowPos[4] = this.b.y; this.glowPos[5] = 0;
    this.glowAttr.needsUpdate = true;
    this.glowMat.uniforms.uSize.value = 60 * (0.8 + 0.4 * this.flicker);
    this.glowMat.uniforms.uAlpha.value = this.level * this.flicker;
  }

  private rebuild(len: number): void {
    this.vCount = 0;
    this.iCount = 0;

    const jitter = Math.min(30, len * 0.15);
    const main = boltPoints(this.a, this.b, jitter);
    this.writeStrand(main, (t) => 0.35 + 0.65 * Math.sin(Math.PI * t));

    // 0 a 3 ramos saindo do meio, afinando até a ponta
    const branches = Math.floor(Math.random() * 4);
    for (let k = 0; k < branches; k++) {
      const from = main[Math.floor(main.length * (0.2 + Math.random() * 0.6))];
      const ang = Math.atan2(this.b.y - this.a.y, this.b.x - this.a.x) + (Math.random() - 0.5) * 2.2;
      const bl = len * (0.15 + Math.random() * 0.25);
      const to = { x: from.x + Math.cos(ang) * bl, y: from.y + Math.sin(ang) * bl };
      this.writeStrand(boltPoints(from, to, jitter * 0.6), (t) => 0.7 * (1 - t));
    }

    this.aPos.needsUpdate = true;
    this.aNrm.needsUpdate = true;
    this.aSide.needsUpdate = true;
    this.aTaper.needsUpdate = true;
    this.index.needsUpdate = true;
    this.geo.setDrawRange(0, this.iCount);
  }

  /** Converte uma polilinha em uma fita (2 vértices por ponto) e adiciona ao buffer. */
  private writeStrand(pts: P[], taperFn: (t: number) => number): void {
    const k = pts.length;
    if (this.vCount + k * 2 > MAX_VERTS) return;
    const base = this.vCount;

    for (let i = 0; i < k; i++) {
      const p0 = pts[Math.max(0, i - 1)];
      const p1 = pts[Math.min(k - 1, i + 1)];
      let tx = p1.x - p0.x;
      let ty = p1.y - p0.y;
      const tl = Math.hypot(tx, ty) || 1;
      tx /= tl;
      ty /= tl;
      const tp = taperFn(i / (k - 1));

      for (let s = 0; s < 2; s++) {
        const v = base + i * 2 + s;
        this.pos[v * 3] = pts[i].x;
        this.pos[v * 3 + 1] = pts[i].y;
        this.pos[v * 3 + 2] = 0;
        this.nrm[v * 2] = -ty;
        this.nrm[v * 2 + 1] = tx;
        this.side[v] = s === 0 ? -1 : 1;
        this.taper[v] = tp;
      }
    }

    for (let i = 0; i < k - 1; i++) {
      const v = base + i * 2;
      this.idx[this.iCount++] = v;
      this.idx[this.iCount++] = v + 1;
      this.idx[this.iCount++] = v + 2;
      this.idx[this.iCount++] = v + 1;
      this.idx[this.iCount++] = v + 3;
      this.idx[this.iCount++] = v + 2;
    }
    this.vCount += k * 2;
  }
}