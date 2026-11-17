import * as THREE from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import type { Hand } from "../tracking/handTracker";
import { handScale } from "../gestures/gestures";

const GEO_DETAIL = 1;             // refinamento da esfera: 2 = ~90 nós (mais aberta), 3 = ~160 nós
const CHORDS = 24;                // estruturas internas atravessando o globo
const SIZE_SCALE = 0.30;          // tamanho mínimo em múltiplos do tamanho da mão
const MAX_HEIGHT_FRACTION = 0.2;  // teto do raio: fração da altura da tela
const BASE_SPIN = 0.003;          // giro constante (radianos por frame)

/* ------------------------------ Geometria geodésica ------------------------------ */

function mulberry32(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Esfera geodésica irregular: nós (vértices) e arestas, em uma esfera de raio 1. */
function buildGeodesic(): { nodes: Float32Array; edges: Float32Array } {
  const rand = mulberry32(7);
  const ico = new THREE.IcosahedronGeometry(1, GEO_DETAIL);
  const pos = ico.getAttribute("position");

  // Remove vértices duplicados e monta a lista de triângulos
  const lookup = new Map<string, number>();
  const verts: THREE.Vector3[] = [];
  const tri: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const key = `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
    let idx = lookup.get(key);
    if (idx === undefined) {
      idx = verts.length;
      verts.push(new THREE.Vector3(x, y, z));
      lookup.set(key, idx);
    }
    tri.push(idx);
  }
  ico.dispose();

  // Irregularidade orgânica, como na foto: desloca cada nó um pouco
  for (const v of verts) {
    v.add(new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(0.07));
    v.normalize().multiplyScalar(1 + (rand() - 0.5) * 0.05);
  }

  // Arestas únicas
  const seen = new Set<string>();
  const segs: number[] = [];
  const addEdge = (a: number, b: number): void => {
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    if (seen.has(key)) return;
    seen.add(key);
    segs.push(verts[a].x, verts[a].y, verts[a].z, verts[b].x, verts[b].y, verts[b].z);
  };
  for (let t = 0; t < tri.length; t += 3) {
    addEdge(tri[t], tri[t + 1]);
    addEdge(tri[t + 1], tri[t + 2]);
    addEdge(tri[t + 2], tri[t]);
  }

  // Estruturas internas: cordas ligando nós distantes (atravessam o globo)
  let added = 0;
  let guard = 0;
  while (added < CHORDS && guard++ < 2000) {
    const a = Math.floor(rand() * verts.length);
    const b = Math.floor(rand() * verts.length);
    if (a === b) continue;
    const d = verts[a].distanceTo(verts[b]);
    if (d < 0.8 || d > 1.5) continue;
    const before = segs.length;
    addEdge(a, b);
    if (segs.length > before) added++;
  }

  const nodes = new Float32Array(verts.length * 3);
  verts.forEach((v, i) => {
    nodes[i * 3] = v.x;
    nodes[i * 3 + 1] = v.y;
    nodes[i * 3 + 2] = v.z;
  });
  return { nodes, edges: new Float32Array(segs) };
}

/* --------------------------------- Shader dos nós --------------------------------- */

const nodeVertex = /* glsl */ `
  attribute float aSize;
  attribute float aPhase;
  uniform float uTime;
  uniform float uRadius;
  uniform float uSizeScale;
  varying float vBright;
  void main() {
    // Profundidade: nós da frente mais brilhantes que os do fundo
    vec4 wp = modelMatrix * vec4(position, 1.0);
    float zr = clamp(wp.z / max(uRadius, 1.0), -1.0, 1.0);
    float depth = 0.65 + 0.35 * zr;

    float twinkle = 0.75 + 0.25 * sin(uTime * 2.0 + aPhase);
    // Onda de luz subindo pelo globo
    float wave = pow(max(0.0, sin(position.y * 3.0 - uTime * 1.6)), 8.0);

    vBright = depth * twinkle + wave * 1.2;
    gl_PointSize = aSize * uSizeScale * (0.85 + 0.3 * depth) * (1.0 + wave * 0.8);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const nodeFragment = /* glsl */ `
  uniform float uLevel;
  varying float vBright;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float g = exp(-d * d * 5.0);
    float core = exp(-d * d * 30.0);
    vec3 col = mix(vec3(1.0, 0.65, 0.2), vec3(1.0, 0.95, 0.75), core);
    gl_FragColor = vec4(col * vBright * 1.6, g * uLevel);
  }
`;

/* ------------------------- Shader do brilho (aura e chão) ------------------------- */

const glowVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const GLOW_R = 0.62; // raio da esfera dentro do quadrado da aura

const glowFragment = /* glsl */ `
  uniform float uLevel;
  uniform float uMode; // 0 = aura em volta da esfera, 1 = brilho no chão
  varying vec2 vUv;
  void main() {
    vec2 p = (vUv - 0.5) * 2.0;
    float d = length(p);
    float g;
    if (uMode < 0.5) {
      float R = ${GLOW_R.toFixed(2)};
      float rim = exp(-pow((d - R) * 9.0, 2.0)) * 0.002;           // anel de luz na silhueta
      float outer = exp(-max(d - R, 0.0) * 6.0) * 0.15 * step(R, d);
      float inner = (1.0 - smoothstep(0.0, R, d)) * 0.03;         // luz suave dentro
      g = rim + outer + inner;
    } else {
      g = exp(-d * d * 3.5) * 0.7;
    }

    // Some em círculo antes da borda do quadrado, então não aparece "caixa" de luz
    g *= 1.0 - smoothstep(0.7, 1.0, d);

    gl_FragColor = vec4(vec3(1.0, 0.6, 0.18) * g * 1.4, uLevel);
  }
`;

function makeGlowMaterial(mode: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uLevel: { value: 0 }, uMode: { value: mode } },
    vertexShader: glowVertex,
    fragmentShader: glowFragment,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide, // a câmera tem o eixo Y invertido
  });
}

/** Entrada com "pulinho": passa um pouco de 1.0 e assenta. */
function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/* ------------------------------------ Efeito ------------------------------------ */

const plane = new THREE.PlaneGeometry(2, 2);

/**
 * Globo geodésico dourado (polegar + indicador + médio esticados).
 * O tamanho segue a abertura dos dedos e o giro reage ao movimento lateral da mão.
 */
export class GeodesicGlobeGL {
  private level = 0;
  private cx = 0;
  private cy = 0;
  private radius = 0;
  private rotY = 0;
  private spin = 0;

  private readonly root = new THREE.Group();   // posição do globo (sem rotação)
  private readonly globe = new THREE.Group();  // escala e rotação 3D
  private readonly aura: THREE.Mesh;
  private readonly ground: THREE.Mesh;
  private readonly auraMat: THREE.ShaderMaterial;
  private readonly groundMat: THREE.ShaderMaterial;
  private readonly lineGlow: LineMaterial;
  private readonly lineCore: LineMaterial;
  private readonly nodeMat: THREE.ShaderMaterial;

  constructor(scene: THREE.Scene, width: number, height: number) {
    const { nodes, edges } = buildGeodesic();

    // Linhas: duas camadas (halo laranja largo + núcleo dourado fino), linhas grossas em pixels
    const lineGeo = new LineSegmentsGeometry();
    lineGeo.setPositions(edges);
    const lineParams = {
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    };
    this.lineGlow = new LineMaterial({ linewidth: 7, ...lineParams });
    this.lineGlow.color.setRGB(0.6, 0.3, 0.06); 
    this.lineGlow.resolution.set(width, height);
    this.lineCore = new LineMaterial({ linewidth: 2, ...lineParams });
    this.lineCore.color.setRGB(1.0, 0.7, 0.25); 
    this.lineCore.resolution.set(width, height);

    const glowLines = new LineSegments2(lineGeo, this.lineGlow);
    const coreLines = new LineSegments2(lineGeo, this.lineCore);
    glowLines.frustumCulled = false;
    coreLines.frustumCulled = false;

    // Nós: pontos brilhantes com tamanho e fase de cintilação próprios
    const count = nodes.length / 3;
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);
    const rand = mulberry32(21);
    for (let i = 0; i < count; i++) {
      sizes[i] = 14 + rand() * 12;
      phases[i] = rand() * Math.PI * 2;
    }
    const nodeGeo = new THREE.BufferGeometry();
    nodeGeo.setAttribute("position", new THREE.BufferAttribute(nodes, 3));
    nodeGeo.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    nodeGeo.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
    this.nodeMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uRadius: { value: 100 },
        uSizeScale: { value: 1 },
        uLevel: { value: 0 },
      },
      vertexShader: nodeVertex,
      fragmentShader: nodeFragment,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });
    const points = new THREE.Points(nodeGeo, this.nodeMat);
    points.frustumCulled = false;

    this.globe.add(glowLines, coreLines, points);

    // Aura em volta e brilho no chão
    this.auraMat = makeGlowMaterial(0);
    this.groundMat = makeGlowMaterial(1);
    this.aura = new THREE.Mesh(plane, this.auraMat);
    this.ground = new THREE.Mesh(plane, this.groundMat);

    this.root.add(this.ground, this.aura, this.globe);
    this.root.visible = false;
    scene.add(this.root);
  }

  update(hand: Hand | null, active: boolean, now: number, aspect: number, w: number, h: number): void {
    if (hand) {
      // O globo nasce no meio das pontas do polegar, do indicador e do dedo do meio
      const ax = hand[4].x * w;
      const ay = hand[4].y * h;
      const bx = hand[8].x * w;
      const by = hand[8].y * h;
      const mx = hand[12].x * w;
      const my = hand[12].y * h;
      const tx = (ax + bx + mx) / 3;
      const ty = (ay + by + my) / 3;

      // O tamanho segue a abertura dos dedos
      const spread = Math.max(Math.hypot(ax - bx, ay - by), Math.hypot(ax - mx, ay - my), Math.hypot(bx - mx, by - my));
      const tr = Math.min(Math.max(handScale(hand, aspect) * h * SIZE_SCALE, spread * 0.7), h * MAX_HEIGHT_FRACTION);

      if (this.level === 0) {
        this.cx = tx; this.cy = ty; this.radius = tr;
        this.spin = 0;
      } else {
        const oldX = this.cx;
        this.cx += (tx - this.cx) * 0.4;
        this.cy += (ty - this.cy) * 0.4;
        this.radius += (tr - this.radius) * 0.3;
        // O movimento lateral da mão empurra o giro do globo
        this.spin += (this.cx - oldX) * 0.003;
      }
    }

    this.level = active ? Math.min(1, this.level + 0.08) : Math.max(0, this.level - 0.07);
    this.root.visible = this.level > 0.01;
    if (!this.root.visible) return;

    const L = this.level;
    const R = this.radius * easeOutBack(L) * (1 + 0.025 * Math.sin(now / 300));

    // Giro: constante + impulso da mão (que vai se dissipando)
    this.spin = Math.max(-0.12, Math.min(0.12, this.spin * 0.94));
    this.rotY += BASE_SPIN + this.spin;

    this.root.position.set(this.cx, this.cy, 0);
    this.globe.scale.set(R, R, R);
    this.globe.rotation.set(0.4 + 0.06 * Math.sin(now / 1700), this.rotY, 0);

    // Aura (esfera ocupa 62% do quadrado) e brilho no chão, abaixo do globo
    const auraHalf = R / GLOW_R;
    this.aura.scale.set(auraHalf, auraHalf, 1);
    //this.ground.position.set(0, R * 1.1, 0);
   // this.ground.scale.set(R * 1.5, R * 0.26, 1);
    this.auraMat.uniforms.uLevel.value = L;
   // this.groundMat.uniforms.uLevel.value = L * 0.8;

    this.lineGlow.opacity = L * 0.3;
    this.lineCore.opacity = L * (0.85 + 0.15 * Math.sin(now / 400));

    this.nodeMat.uniforms.uTime.value = now / 1000;
    this.nodeMat.uniforms.uRadius.value = R;
    this.nodeMat.uniforms.uSizeScale.value = Math.max(0.6, Math.min(1.6, R / 150));
    this.nodeMat.uniforms.uLevel.value = L;
  }
}