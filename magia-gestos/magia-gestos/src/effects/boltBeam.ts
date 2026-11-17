import * as THREE from "three";
import { BoltBatch, boltPoints, type LayerCfg, type P } from "./boltBatch";

const BEAM_FRAMES = 14; // duração do raio (~0,23 s)

const BEAM_LAYERS: LayerCfg[] = [
  { width: 46, color: [0.15, 0.4, 1.2], alpha: 0.5, power: 2.5 },
  { width: 14, color: [0.5, 0.8, 1.5], alpha: 0.9, power: 1.4 },
  { width: 5, color: [1.3, 1.4, 1.7], alpha: 1.0, power: 0.7 },
];

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
    gl_FragColor = vec4(vec3(0.6, 0.8, 1.7), g * uAlpha);
  }
`;

/** Raio instantâneo: um relâmpago que sai da mão e vai até a borda da tela, com clarão nas pontas. */
export class BoltBeam {
  private frames = 0;
  private tick = 0;
  private flicker = 1;
  private origin: P = { x: 0, y: 0 };
  private end: P = { x: 0, y: 0 };

  private readonly bolts: BoltBatch;
  private readonly glowPos = new Float32Array(6);
  private readonly glowAttr: THREE.BufferAttribute;
  private readonly glowMat: THREE.ShaderMaterial;
  private readonly glowPoints: THREE.Points;

  constructor(
    scene: THREE.Scene,
    private readonly w: number,
    private readonly h: number,
  ) {
    this.bolts = new BoltBatch(scene, BEAM_LAYERS, 1536);

    const geo = new THREE.BufferGeometry();
    this.glowAttr = new THREE.BufferAttribute(this.glowPos, 3);
    geo.setAttribute("position", this.glowAttr);
    this.glowMat = new THREE.ShaderMaterial({
      uniforms: { uSize: { value: 100 }, uAlpha: { value: 0 } },
      vertexShader: glowVertex,
      fragmentShader: glowFragment,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });
    this.glowPoints = new THREE.Points(geo, this.glowMat);
    this.glowPoints.frustumCulled = false;
    this.glowPoints.visible = false;
    scene.add(this.glowPoints);
  }

  /** Dispara o raio de `origin` na direção `dir` (vetor unitário), até a borda da tela. */
  fire(origin: P, dir: P): void {
    const tx = dir.x > 0 ? (this.w - origin.x) / dir.x : dir.x < 0 ? -origin.x / dir.x : Infinity;
    const ty = dir.y > 0 ? (this.h - origin.y) / dir.y : dir.y < 0 ? -origin.y / dir.y : Infinity;
    const len = Math.max(80, Math.min(tx, ty, 1500));
    this.origin = origin;
    this.end = { x: origin.x + dir.x * len, y: origin.y + dir.y * len };
    this.frames = BEAM_FRAMES;
    this.tick = 0;
  }

  update(): void {
    const visible = this.frames > 0;
    this.bolts.setVisible(visible);
    this.glowPoints.visible = visible;
    if (!visible) return;

    const fade = this.frames / BEAM_FRAMES;
    if (this.tick++ % 2 === 0) {
      this.flicker = 0.8 + 0.2 * Math.random();
      this.rebuild(fade);
    }
    this.bolts.setAlpha(Math.min(1, fade * 1.4) * this.flicker);

    // Clarão na saída (mão) e no impacto
    this.glowPos[0] = this.origin.x; this.glowPos[1] = this.origin.y; this.glowPos[2] = 0;
    this.glowPos[3] = this.end.x; this.glowPos[4] = this.end.y; this.glowPos[5] = 0;
    this.glowAttr.needsUpdate = true;
    this.glowMat.uniforms.uSize.value = 70 + 60 * fade;
    this.glowMat.uniforms.uAlpha.value = fade;

    this.frames--;
  }

  private rebuild(fade: number): void {
    const { origin, end } = this;
    const len = Math.hypot(end.x - origin.x, end.y - origin.y);
    const jitter = Math.min(40, len * 0.06);
    this.bolts.begin();

    const main = boltPoints(origin, end, jitter, 14, 60);
    this.bolts.addStrand(main, (t) => 0.6 + 0.5 * Math.sin(Math.PI * t), 2 * (0.4 + 0.6 * fade));

    const baseAng = Math.atan2(end.y - origin.y, end.x - origin.x);
    const branches = 4 + Math.floor(Math.random() * 4);
    for (let b = 0; b < branches; b++) {
      const from = main[Math.floor(main.length * (0.1 + Math.random() * 0.85))];
      const ang = baseAng + (Math.random() < 0.5 ? -1 : 1) * (0.4 + Math.random() * 0.7);
      const bl = len * (0.06 + Math.random() * 0.1);
      const to = { x: from.x + Math.cos(ang) * bl, y: from.y + Math.sin(ang) * bl };
      this.bolts.addStrand(boltPoints(from, to, jitter * 0.6, 14, 30), (t) => 0.8 * (1 - t), 1.1 * fade);
    }
    this.bolts.end();
  }
}