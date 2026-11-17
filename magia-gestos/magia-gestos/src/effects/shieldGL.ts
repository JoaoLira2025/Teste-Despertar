import * as THREE from "three";
import type { Hand } from "../tracking/handTracker";
import { handScale } from "../gestures/gestures";
import { getRuneTextures } from "./runeTextures";

type RGB = [number, number, number];

const PALM = [0, 5, 9, 13, 17]; // pulso + base dos dedos = centro da palma
const SHIELD_SIZE = 1.0;        // tamanho do escudo em relação à mão

const plane = new THREE.PlaneGeometry(2, 2);

/** Camada = quadrado com textura, em blending aditivo. Cores acima de 1.0 alimentam o bloom. */
function makeLayer(map: THREE.Texture, rgb: RGB): THREE.Mesh {
  const material = new THREE.MeshBasicMaterial({
    map,
    color: new THREE.Color(rgb[0], rgb[1], rgb[2]),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide, // a câmera tem o eixo Y invertido, então desligamos o culling
  });
  return new THREE.Mesh(plane, material);
}

function setLayer(mesh: THREE.Mesh, scale: number, opacity: number, rotation?: number): void {
  mesh.scale.set(scale, scale, 1);
  (mesh.material as THREE.MeshBasicMaterial).opacity = opacity;
  if (rotation !== undefined) mesh.rotation.z = rotation;
}

/** Centro da palma em pixels. */
function palmCenter(hand: Hand, w: number, h: number): { x: number; y: number } {
  let sx = 0;
  let sy = 0;
  for (const i of PALM) {
    sx += hand[i].x;
    sy += hand[i].y;
  }
  return { x: (sx / PALM.length) * w, y: (sy / PALM.length) * h };
}

/* ------------------------------ Escudo de uma mão ------------------------------ */

export class ShieldGL {
  private level = 0;
  private cx = 0;
  private cy = 0;
  private radius = 0;
  private angle = 0;
  private flatness = 1; // 1 = de frente, 0.2 = de lado

  private readonly pivot = new THREE.Group();
  private readonly glass: THREE.Mesh;
  private readonly ring: THREE.Mesh;
  private readonly inner: THREE.Mesh;

  constructor(scene: THREE.Scene) {
    const tex = getRuneTextures();
    this.glass = makeLayer(tex.glass, [0.15, 0.7, 0.9]);
    this.ring = makeLayer(tex.ring, [0.3, 1.0, 1.3]);
    this.inner = makeLayer(tex.inner, [0.25, 0.8, 1.1]);
    this.pivot.add(this.glass, this.ring, this.inner);
    this.pivot.visible = false;
    scene.add(this.pivot);
  }

  update(hand: Hand | null, active: boolean, now: number, aspect: number, w: number, h: number): void {
    if (hand) {
      const c = palmCenter(hand, w, h);
      const tr = handScale(hand, aspect) * h * SHIELD_SIZE;

      if (this.level === 0) {
        this.cx = c.x; this.cy = c.y; this.radius = tr;
      } else {
        this.cx += (c.x - this.cx) * 0.4;
        this.cy += (c.y - this.cy) * 0.4;
        this.radius += (tr - this.radius) * 0.4;
      }

      // Perspectiva: ângulo da mão e achatamento conforme ela vira de lado
      this.angle = Math.atan2(hand[9].y - hand[0].y, (hand[9].x - hand[0].x) * aspect);
      const width = Math.hypot((hand[5].x - hand[17].x) * aspect, hand[5].y - hand[17].y);
      const expected = handScale(hand, aspect) * 1.2;
      this.flatness = Math.max(0.2, Math.min(1, width / Math.max(expected, 0.0001)));
    }

    this.level = active ? Math.min(1, this.level + 0.08) : Math.max(0, this.level - 0.06);
    this.pivot.visible = this.level > 0.01;
    if (!this.pivot.visible) return;

    const L = this.level;
    const r = this.radius * (0.6 + 0.4 * L) * (1 + 0.04 * Math.sin(now / 140));
    const flicker = 0.85 + 0.15 * Math.sin(now / 300);

    this.pivot.position.set(this.cx, this.cy, 0);
    this.pivot.rotation.z = this.angle - Math.PI / 2;
    this.pivot.scale.set(this.flatness, 1, 1);

    setLayer(this.glass, r, L);
    setLayer(this.ring, r * 1.08, L * flicker, now / 4000);
    setLayer(this.inner, r, L * 0.9, -now / 3000);
  }

  /** Usado no main.ts para detectar a fusão (colisão entre escudos). */
  getCenter(): { x: number; y: number; radius: number; level: number } {
    return { x: this.cx, y: this.cy, radius: this.radius, level: this.level };
  }
}

/* ---------------------- Escudos combinados (duas mãos) ---------------------- */

type CombinedConfig = {
  // Tamanho: raio = max(distância entre as mãos * distFactor, tamanho da mão * minScale)
  distFactor: number;
  minScale: number;
  /** Teto do raio como fração da altura da tela (Infinity = sem limite). */
  maxHeightFraction: number;
  // Cores das 5 camadas (valores acima de 1.0 alimentam o bloom)
  glass: RGB;
  ringA: RGB;
  ringB: RGB;
  innerA: RGB;
  innerB: RGB;
  // Escala de cada camada em relação ao raio
  scaleRingA: number;
  scaleRingB: number;
  scaleInnerA: number;
  scaleInnerB: number;
  /** Opacidade do anel B. */
  ringBOpacity: number;
  /** Divisores de rotação (ringA, ringB, innerA, innerB). Menor = mais rápido; negativo = sentido contrário. */
  spin: [number, number, number, number];
  pulseAmp: number;
  pulseSpeed: number;   // divisor do tempo
  flickerSpeed: number; // divisor do tempo
};

/** Roxo e azul, entre as duas palmas. */
const SUPER_SHIELD: CombinedConfig = {
  distFactor: 0.8,
  minScale: 1.5,
  maxHeightFraction: Infinity,
  glass: [0.35, 0.25, 0.8],
  ringA: [0.75, 0.6, 1.5],
  ringB: [0.3, 0.7, 1.4],
  innerA: [0.6, 0.5, 1.4],
  innerB: [0.35, 0.7, 1.3],
  scaleRingA: 1.1,
  scaleRingB: 1.3,
  scaleInnerA: 0.85,
  scaleInnerB: 0.6,
  ringBOpacity: 0.45,
  spin: [2500, -3500, -1800, 1800],
  pulseAmp: 0.05,
  pulseSpeed: 100,
  flickerSpeed: 250,
};

/** Dourado, ciano e branco: fusão do escudo com a luz angelical. */


/** Base dos escudos que nascem no ponto médio entre as duas mãos. */
class CombinedShield {
  private level = 0;
  private cx = 0;
  private cy = 0;
  private radius = 0;
  private readonly pivot = new THREE.Group();
  private readonly glass: THREE.Mesh;
  private readonly ringA: THREE.Mesh;
  private readonly ringB: THREE.Mesh;
  private readonly innerA: THREE.Mesh;
  private readonly innerB: THREE.Mesh;

  constructor(scene: THREE.Scene, private readonly cfg: CombinedConfig) {
    const tex = getRuneTextures();
    this.glass = makeLayer(tex.glass, cfg.glass);
    this.ringA = makeLayer(tex.ring, cfg.ringA);
    this.ringB = makeLayer(tex.ring, cfg.ringB);
    this.innerA = makeLayer(tex.inner, cfg.innerA);
    this.innerB = makeLayer(tex.inner, cfg.innerB);
    this.pivot.add(this.glass, this.ringB, this.ringA, this.innerB, this.innerA);
    this.pivot.visible = false;
    scene.add(this.pivot);
  }

  update(
    handA: Hand | null,
    handB: Hand | null,
    active: boolean,
    now: number,
    aspect: number,
    w: number,
    h: number,
  ): void {
    const cfg = this.cfg;

    if (handA && handB) {
      // Ponto médio entre as palmas
      const a = palmCenter(handA, w, h);
      const b = palmCenter(handB, w, h);
      const tx = (a.x + b.x) / 2;
      const ty = (a.y + b.y) / 2;

      const dist = Math.hypot((handA[9].x - handB[9].x) * w, (handA[9].y - handB[9].y) * h);
      const base = (handScale(handA, aspect) + handScale(handB, aspect)) / 2;
      const tr = Math.min(
        Math.max(dist * cfg.distFactor, base * h * cfg.minScale),
        h * cfg.maxHeightFraction,
      );

      if (this.level === 0) {
        this.cx = tx; this.cy = ty; this.radius = tr;
      } else {
        this.cx += (tx - this.cx) * 0.4;
        this.cy += (ty - this.cy) * 0.4;
        this.radius += (tr - this.radius) * 0.3;
      }
    }

    this.level = active ? Math.min(1, this.level + 0.1) : Math.max(0, this.level - 0.06);
    this.pivot.visible = this.level > 0.01;
    if (!this.pivot.visible) return;

    const L = this.level;
    const pulse = 1 + cfg.pulseAmp * Math.sin(now / cfg.pulseSpeed);
    const r = this.radius * pulse * (0.5 + 0.5 * L);
    const flicker = 0.85 + 0.15 * Math.sin(now / cfg.flickerSpeed);
    const [sA, sB, sIA, sIB] = cfg.spin;

    this.pivot.position.set(this.cx, this.cy, 0);

    setLayer(this.glass, r, L);
    setLayer(this.ringA, r * cfg.scaleRingA, L * flicker, now / sA);
    setLayer(this.ringB, r * cfg.scaleRingB, L * cfg.ringBOpacity, now / sB);
    setLayer(this.innerA, r * cfg.scaleInnerA, L, now / sIA);
    setLayer(this.innerB, r * cfg.scaleInnerB, L * 0.8, now / sIB + Math.PI / 6);
  }
}

/** Super escudo: aparece entre as duas mãos, maior, roxo/azul, com camadas extras girando. */
export class SuperShieldGL extends CombinedShield {
  constructor(scene: THREE.Scene) {
    super(scene, SUPER_SHIELD);
  }
}

/** Escudo Divino: a fusão do Escudo com a Luz Angelical. Dourado, ciano e imponente. */
