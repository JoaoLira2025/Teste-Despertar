import * as THREE from "three";

export type P = { x: number; y: number };
export type LayerCfg = {
  width: number;
  color: [number, number, number];
  alpha: number;
  power: number;
};

/** Linha em zigue-zague entre a e b (deslocamento aleatório que some nas pontas). */
export function boltPoints(a: P, b: P, jitter: number, step = 14, maxN = 60): P[] {
  const len = Math.max(Math.hypot(b.x - a.x, b.y - a.y), 1);
  const n = Math.min(maxN, Math.max(6, Math.floor(len / step)));
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

const vertex = /* glsl */ `
  attribute vec2 aNormal;
  attribute float aSide;
  attribute float aTaper;
  attribute float aGain;
  uniform float uWidth;
  varying float vSide;
  varying float vGain;
  void main() {
    vSide = aSide;
    vGain = aGain;
    vec3 p = position + vec3(aNormal * aSide * uWidth * aTaper * 0.5, 0.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const fragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAlpha;
  uniform float uPower;
  varying float vSide;
  varying float vGain;
  void main() {
    float f = 1.0 - abs(vSide);
    float a = pow(max(f, 0.0), uPower);
    gl_FragColor = vec4(uColor, a * uAlpha * vGain);
  }
`;

/**
 * Lote de raios: vários "strands" (polilinhas) desenhados como fitas, em N camadas.
 * Cada strand tem seu próprio brilho (gain) e afinamento (taper).
 */
export class BoltBatch {
  private readonly maxVerts: number;
  private readonly pos: Float32Array;
  private readonly nrm: Float32Array;
  private readonly side: Float32Array;
  private readonly taper: Float32Array;
  private readonly gain: Float32Array;
  private readonly idx: Uint16Array;
  private vCount = 0;
  private iCount = 0;

  private readonly geo = new THREE.BufferGeometry();
  private readonly attrs: THREE.BufferAttribute[];
  private readonly meshes: THREE.Mesh[] = [];
  private readonly mats: THREE.ShaderMaterial[] = [];
  private readonly layers: LayerCfg[];

  constructor(scene: THREE.Scene, layers: LayerCfg[], maxVerts = 1024) {
    this.maxVerts = maxVerts;
    this.layers = layers;
    this.pos = new Float32Array(maxVerts * 3);
    this.nrm = new Float32Array(maxVerts * 2);
    this.side = new Float32Array(maxVerts);
    this.taper = new Float32Array(maxVerts);
    this.gain = new Float32Array(maxVerts);
    this.idx = new Uint16Array(maxVerts * 4);

    const aPos = new THREE.BufferAttribute(this.pos, 3);
    const aNrm = new THREE.BufferAttribute(this.nrm, 2);
    const aSide = new THREE.BufferAttribute(this.side, 1);
    const aTaper = new THREE.BufferAttribute(this.taper, 1);
    const aGain = new THREE.BufferAttribute(this.gain, 1);
    const index = new THREE.BufferAttribute(this.idx, 1);
    this.attrs = [aPos, aNrm, aSide, aTaper, aGain, index];

    this.geo.setAttribute("position", aPos);
    this.geo.setAttribute("aNormal", aNrm);
    this.geo.setAttribute("aSide", aSide);
    this.geo.setAttribute("aTaper", aTaper);
    this.geo.setAttribute("aGain", aGain);
    this.geo.setIndex(index);
    this.geo.setDrawRange(0, 0);

    for (const L of layers) {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uWidth: { value: L.width },
          uColor: { value: new THREE.Color(L.color[0], L.color[1], L.color[2]) },
          uAlpha: { value: 0 },
          uPower: { value: L.power },
        },
        vertexShader: vertex,
        fragmentShader: fragment,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(this.geo, mat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      scene.add(mesh);
      this.meshes.push(mesh);
      this.mats.push(mat);
    }
  }

  begin(): void {
    this.vCount = 0;
    this.iCount = 0;
  }

  addStrand(pts: P[], taperFn: (t: number) => number, gain = 1): void {
    const k = pts.length;
    if (k < 2 || this.vCount + k * 2 > this.maxVerts) return;
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
        this.gain[v] = gain;
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

  end(): void {
    for (const a of this.attrs) a.needsUpdate = true;
    this.geo.setDrawRange(0, this.iCount);
  }

  setAlpha(a: number): void {
    this.layers.forEach((L, i) => {
      this.mats[i].uniforms.uAlpha.value = L.alpha * a;
    });
  }

  setVisible(v: boolean): void {
    for (const m of this.meshes) m.visible = v;
  }
}