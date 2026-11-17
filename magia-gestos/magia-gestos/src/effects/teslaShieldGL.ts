import * as THREE from "three";
import type { Hand } from "../tracking/handTracker";
import { handScale } from "../gestures/gestures";
import { getRuneTextures } from "./runeTextures";
import { getDivineTextures } from "./divineTextures";
import { BoltBatch, boltPoints, type LayerCfg, type P } from "./boltBatch";

type RGB = [number, number, number];

const PALM = [0, 5, 9, 13, 17];
const SHIELD_SIZE = 1.0;      // mesmo tamanho do escudo normal
const REGEN_EVERY = 2;        // recalcula os raios a cada N frames
const CHARGE_RATE = 0.012;    // por frame: 1/0.012 ≈ 83 frames ≈ 1,4 s até a descarga
const BURST_FRAMES = 10;      // duração dos raios da descarga

// Raios azul-elétrico e branco
const TESLA_LAYERS: LayerCfg[] = [
  { width: 34, color: [0.15, 0.45, 1.3], alpha: 0.5, power: 2.5 },
  { width: 10, color: [0.5, 0.85, 1.6], alpha: 0.9, power: 1.4 },
  { width: 3.5, color: [1.3, 1.5, 1.7], alpha: 1.0, power: 0.7 },
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

function place(mesh: THREE.Mesh, scale: number, opacity: number, rotation = 0): void {
  mesh.scale.set(scale, scale, 1);
  mesh.rotation.z = rotation;
  (mesh.material as THREE.MeshBasicMaterial).opacity = opacity;
}

/* ----------------------------- Brilho nas pontas dos dedos ----------------------------- */

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
    gl_FragColor = vec4(vec3(0.6, 0.9, 1.7), g * uAlpha);
  }
`;

/* ------------------------------------- Efeito ------------------------------------- */

/**
 * Escudo Tesla (palma aberta + "L"): o escudo é eletrizado pelos dedos do "L".
 * Carrega, descarrega em onda de choque e raios radiais, e recomeça.
 */
export class TeslaShieldGL {
  private level = 0;
  private wasActive = false;

  // Escudo (mão em palma aberta)
  private cx = 0;
  private cy = 0;
  private radius = 0;
  private angle = 0;
  private flatness = 1;

  // Pontas dos dedos do "L"
  private tipT: P = { x: 0, y: 0 }; // polegar
  private tipI: P = { x: 0, y: 0 }; // indicador

  // Ciclo de carga e descarga
  private charge = 0;
  private burst = 0;
  private burstAngles: number[] = [];
  private shock = -1; // progresso da onda de choque (0..1); -1 = inativa
  private flash = 0;

  private frame = 0;
  private flicker = 1;
  private drawR = 0;

  private readonly pivot = new THREE.Group();
  private readonly glass: THREE.Mesh;
  private readonly ring: THREE.Mesh;
  private readonly inner: THREE.Mesh;
  private readonly flare: THREE.Mesh;
  private readonly shockMesh: THREE.Mesh;
  private readonly bolts: BoltBatch;

  private readonly glowPos = new Float32Array(6);
  private readonly glowAttr: THREE.BufferAttribute;
  private readonly glowMat: THREE.ShaderMaterial;
  private readonly glowPoints: THREE.Points;

  constructor(scene: THREE.Scene) {
    const rune = getRuneTextures();
    const div = getDivineTextures();

    this.glass = makeLayer(rune.glass, [0.1, 0.45, 1.0]);
    this.ring = makeLayer(rune.ring, [0.5, 1.1, 1.8]);
    this.inner = makeLayer(rune.inner, [0.4, 0.9, 1.6]);
    this.flare = makeLayer(div.flare, [0.6, 1.2, 2.0]);
    this.shockMesh = makeLayer(div.halo, [0.6, 1.2, 2.0]);
    this.shockMesh.visible = false;
    this.pivot.add(this.glass, this.ring, this.inner, this.flare, this.shockMesh);
    this.pivot.visible = false;
    scene.add(this.pivot);

    this.bolts = new BoltBatch(scene, TESLA_LAYERS, 1536);

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

  /** Local do escudo (já com perspectiva e rotação) para pixels da tela. */
  private toWorld(p: P): P {
    const rot = this.angle - Math.PI / 2;
    const x = p.x * this.flatness;
    const y = p.y;
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    return { x: this.cx + x * c - y * s, y: this.cy + x * s + y * c };
  }

  /** Pixels da tela para o espaço local do escudo (inverso do toWorld). */
  private toLocal(p: P): P {
    const rot = this.angle - Math.PI / 2;
    const dx = p.x - this.cx;
    const dy = p.y - this.cy;
    const c = Math.cos(-rot);
    const s = Math.sin(-rot);
    return { x: (dx * c - dy * s) / Math.max(this.flatness, 0.2), y: dx * s + dy * c };
  }

  update(
    palm: Hand | null,
    spark: Hand | null,
    active: boolean,
    now: number,
    aspect: number,
    w: number,
    h: number,
  ): void {
    if (palm) {
      let sx = 0;
      let sy = 0;
      for (const i of PALM) {
        sx += palm[i].x;
        sy += palm[i].y;
      }
      const tx = (sx / PALM.length) * w;
      const ty = (sy / PALM.length) * h;
      const tr = handScale(palm, aspect) * h * SHIELD_SIZE;
      if (this.level === 0) {
        this.cx = tx; this.cy = ty; this.radius = tr;
      } else {
        this.cx += (tx - this.cx) * 0.4;
        this.cy += (ty - this.cy) * 0.4;
        this.radius += (tr - this.radius) * 0.4;
      }
      // Perspectiva, igual ao escudo normal
      this.angle = Math.atan2(palm[9].y - palm[0].y, (palm[9].x - palm[0].x) * aspect);
      const width = Math.hypot((palm[5].x - palm[17].x) * aspect, palm[5].y - palm[17].y);
      const expected = handScale(palm, aspect) * 1.2;
      this.flatness = Math.max(0.2, Math.min(1, width / Math.max(expected, 0.0001)));
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
      this.charge = 0;
      this.burst = 0;
      this.shock = -1;
      this.flash = 0;
      return;
    }

    // Estalo inicial quando os dedos encostam no escudo
    if (active && !this.wasActive) {
      this.shock = 0;
      this.flash = 0.8;
      this.charge = 0.3;
    }
    this.wasActive = active;

    // Carga e descarga
    if (active) {
      this.charge = Math.min(1, this.charge + CHARGE_RATE);
      if (this.charge >= 1 && this.burst <= 0) {
        this.burst = BURST_FRAMES;
        this.shock = 0;
        this.flash = 1;
        this.charge = 0.25;
        const n = 5 + Math.floor(Math.random() * 3);
        this.burstAngles = Array.from({ length: n }, (_, k) => (k / n) * Math.PI * 2 + Math.random() * 0.6);
      }
    }
    if (this.burst > 0) this.burst--;
    this.flash *= 0.85;
    if (this.shock >= 0) {
      this.shock += 0.045;
      if (this.shock > 1) this.shock = -1;
    }

    const L = this.level;
    const r = this.radius * (0.7 + 0.3 * L) * (1 + 0.04 * Math.sin(now / 130)) * (1 + 0.1 * this.flash);
    this.drawR = r;

    // Corpo do escudo (com perspectiva) e onda de choque
    this.pivot.position.set(this.cx, this.cy, 0);
    this.pivot.rotation.z = this.angle - Math.PI / 2;
    this.pivot.scale.set(this.flatness, 1, 1);

    const flickerBody = 0.85 + 0.15 * Math.sin(now / 200);
    place(this.glass, r, L * 0.9);
    place(this.ring, r * 1.08, L * flickerBody, now / 2500);
    place(this.inner, r, L * 0.9, -now / 1800);
    place(this.flare, r * (0.5 + 0.5 * this.charge + 0.4 * this.flash), L * (0.5 + 0.5 * this.charge), now / 4000);

    if (this.shock >= 0) {
      const p = this.shock;
      this.shockMesh.visible = true;
      place(this.shockMesh, (r * (1 + 1.8 * p)) / 0.78, L * (1 - p) * 0.9);
    } else {
      this.shockMesh.visible = false;
    }

    // Raios (arcos na borda, circuito com os dedos, descarga radial)
    if (this.frame++ % REGEN_EVERY === 0) {
      this.flicker = 0.8 + 0.2 * Math.random();
      this.rebuild(now);
    }
    this.bolts.setAlpha(L * this.flicker);

    // Brilho nas pontas dos dedos
    this.glowPos[0] = this.tipT.x; this.glowPos[1] = this.tipT.y; this.glowPos[2] = 0;
    this.glowPos[3] = this.tipI.x; this.glowPos[4] = this.tipI.y; this.glowPos[5] = 0;
    this.glowAttr.needsUpdate = true;
    this.glowMat.uniforms.uSize.value = 55 + 25 * this.flash;
    this.glowMat.uniforms.uAlpha.value = L * (0.7 + 0.3 * this.flash);
  }

  private rebuild(now: number): void {
    const r = this.drawR;
    const charge = this.charge;
    this.bolts.begin();

    // 1. Arcos correndo pela borda do escudo (ficam mais fortes com a carga)
    const arcGain = 0.45 + 0.7 * charge + 0.8 * this.flash;
    const jitter = r * (0.04 + 0.04 * charge);
    for (let k = 0; k < 6; k++) {
      const span = 0.7 + Math.random() * 0.4;
      const start = now / 700 + (k * Math.PI * 2) / 6 + Math.random() * 0.3;
      const steps = Math.max(6, Math.round(span / 0.07));
      const pts: P[] = [];
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const a = start + span * t;
        const rr = r * 1.02 + (Math.random() - 0.5) * 2 * jitter * Math.sin(Math.PI * t);
        pts.push(this.toWorld({ x: Math.cos(a) * rr, y: Math.sin(a) * rr }));
      }
      this.bolts.addStrand(pts, (t) => 0.4 + 0.6 * Math.sin(Math.PI * t), arcGain);
    }

    // 2. Circuito: da borda do escudo até cada ponta de dedo do "L"
    for (const tip of [this.tipT, this.tipI]) {
      const loc = this.toLocal(tip);
      const th = Math.atan2(loc.y, loc.x);
      const rim = this.toWorld({ x: Math.cos(th) * r, y: Math.sin(th) * r });
      const len = Math.hypot(tip.x - rim.x, tip.y - rim.y);
      if (len < 6) continue;

      const jit = Math.min(26, len * 0.14);
      const main = boltPoints(rim, tip, jit, 14, 40);
      this.bolts.addStrand(main, (t) => 0.55 + 0.45 * Math.sin(Math.PI * t), 1.3 + 0.5 * this.flash);

      const baseAng = Math.atan2(tip.y - rim.y, tip.x - rim.x);
      const branches = Math.floor(Math.random() * 3);
      for (let b = 0; b < branches; b++) {
        const from = main[Math.floor(main.length * (0.25 + Math.random() * 0.5))];
        const ang = baseAng + (Math.random() < 0.5 ? -1 : 1) * (0.6 + Math.random() * 0.7);
        const bl = len * (0.15 + Math.random() * 0.15);
        const to = { x: from.x + Math.cos(ang) * bl, y: from.y + Math.sin(ang) * bl };
        this.bolts.addStrand(boltPoints(from, to, jit * 0.6, 14, 25), (t) => 0.8 * (1 - t), 0.9);
      }
    }

    // 3. O raio do "L" entre o polegar e o indicador
    const lenL = Math.hypot(this.tipI.x - this.tipT.x, this.tipI.y - this.tipT.y);
    if (lenL >= 12) {
      this.bolts.addStrand(
        boltPoints(this.tipT, this.tipI, Math.min(20, lenL * 0.15), 14, 40),
        (t) => 0.4 + 0.4 * Math.sin(Math.PI * t),
        0.9,
      );
    }

    // 4. Descarga: raios disparados para fora, em todas as direções
    if (this.burst > 0) {
      const fade = this.burst / BURST_FRAMES;
      for (const a of this.burstAngles) {
        const reach = 1.9 + Math.random() * 0.8;
        const p0 = this.toWorld({ x: Math.cos(a) * r, y: Math.sin(a) * r });
        const p1 = this.toWorld({ x: Math.cos(a) * r * reach, y: Math.sin(a) * r * reach });
        this.bolts.addStrand(
          boltPoints(p0, p1, Math.min(24, r * 0.15), 14, 30),
          (t) => 0.5 + 0.5 * Math.sin(Math.PI * t),
          1.5 * fade,
        );
      }
    }

    this.bolts.end();
  }
}