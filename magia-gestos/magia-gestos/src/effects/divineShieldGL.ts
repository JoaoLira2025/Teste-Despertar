import * as THREE from "three";
import type { Hand } from "../tracking/handTracker";
import { handScale } from "../gestures/gestures";
import { getRuneTextures } from "./runeTextures";
import { getDivineTextures, WING_H, WING_MAX_LEN, WING_ROOT, WING_W } from "./divineTextures";

type RGB = [number, number, number];

const PALM = [0, 5, 9, 13, 17];

// ---- Tamanho (ajuste aqui) ----
const MIN_SCALE = 0.9;            // raio mínimo do escudo, em múltiplos do tamanho da mão
const DIST_FACTOR = 0.35;         // quanto a distância entre as mãos aumenta o escudo
const MAX_HEIGHT_FRACTION = 0.22; // teto do raio: fração da altura da tela
const WING_REACH = 1.7;           // alcance das asas, em raios do escudo
const WING_ANCHOR = 0.8;          // onde as asas nascem (em raios, a partir do centro)

const MOTES = 10;

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

/** Posição, escala (x e y separados), opacidade e rotação de uma camada. */
function place(
  mesh: THREE.Mesh,
  x: number,
  y: number,
  sx: number,
  sy: number,
  opacity: number,
  rotation = 0,
): void {
  mesh.position.set(x, y, 0);
  mesh.scale.set(sx, sy, 1);
  mesh.rotation.z = rotation;
  (mesh.material as THREE.MeshBasicMaterial).opacity = opacity;
}

function palmCenter(hand: Hand, w: number, h: number): { x: number; y: number } {
  let sx = 0;
  let sy = 0;
  for (const i of PALM) {
    sx += hand[i].x;
    sy += hand[i].y;
  }
  return { x: (sx / PALM.length) * w, y: (sy / PALM.length) * h };
}

/** Entrada com "pulinho": passa um pouco de 1.0 e assenta. */
function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/* --------------------------- Motes de luz (estrelinhas) --------------------------- */

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

/* ----------------------------------- Escudo Alado ----------------------------------- */

/** Escudo Divino (palma aberta + pinça): escudo alado com auréola, sol, sigilo e motes de luz. */
export class DivineShieldGL {
  private level = 0;
  private cx = 0;
  private cy = 0;
  private radius = 0;
  private tilt = 0;

  private readonly pivot = new THREE.Group();
  private readonly wingPivotR = new THREE.Group();
  private readonly wingPivotL = new THREE.Group();

  private readonly sunburst: THREE.Mesh;
  private readonly glass: THREE.Mesh;
  private readonly ring: THREE.Mesh;
  private readonly sigil: THREE.Mesh;
  private readonly flare: THREE.Mesh;
  private readonly halo: THREE.Mesh;
  private readonly wingR: THREE.Mesh;
  private readonly wingL: THREE.Mesh;

  private readonly motePos = new Float32Array(MOTES * 3);
  private readonly moteSize = new Float32Array(MOTES);
  private readonly moteAttrPos: THREE.BufferAttribute;
  private readonly moteAttrSize: THREE.BufferAttribute;
  private readonly moteMat: THREE.ShaderMaterial;

  constructor(scene: THREE.Scene) {
    const rune = getRuneTextures();
    const tex = getDivineTextures();

    this.sunburst = makeLayer(tex.sunburst, [1.0, 0.75, 0.25]);
    this.glass = makeLayer(rune.glass, [0.25, 0.8, 1.0]);
    this.ring = makeLayer(rune.ring, [1.6, 1.15, 0.35]);
    this.sigil = makeLayer(tex.sigil, [1.7, 1.5, 0.9]);
    this.flare = makeLayer(tex.flare, [2.0, 1.8, 1.3]);
    this.halo = makeLayer(tex.halo, [1.8, 1.4, 0.5]);
    this.wingR = makeLayer(tex.wing, [1.3, 1.2, 0.9]);
    this.wingL = makeLayer(tex.wing, [1.3, 1.2, 0.9]);

    this.wingPivotR.add(this.wingR);
    this.wingPivotL.add(this.wingL);

    // Motes: filhos do pivot, então herdam posição, inclinação e entrada
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

    this.pivot.add(
      this.sunburst,
      this.wingPivotL,
      this.wingPivotR,
      this.glass,
      this.ring,
      this.sigil,
      this.flare,
      this.halo,
      motes,
    );
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
    if (handA && handB) {
      const a = palmCenter(handA, w, h);
      const b = palmCenter(handB, w, h);
      const tx = (a.x + b.x) / 2;
      const ty = (a.y + b.y) / 2;

      const dist = Math.hypot((handA[9].x - handB[9].x) * w, (handA[9].y - handB[9].y) * h);
      const base = (handScale(handA, aspect) + handScale(handB, aspect)) / 2;
      const tr = Math.min(Math.max(dist * DIST_FACTOR, base * h * MIN_SCALE), h * MAX_HEIGHT_FRACTION);

      // Inclinação: segue (pela metade) a linha entre as duas palmas
      const targetTilt = Math.max(-0.6, Math.min(0.6, Math.atan2(b.y - a.y, b.x - a.x)));

      if (this.level === 0) {
        this.cx = tx; this.cy = ty; this.radius = tr; this.tilt = targetTilt;
      } else {
        this.cx += (tx - this.cx) * 0.4;
        this.cy += (ty - this.cy) * 0.4;
        this.radius += (tr - this.radius) * 0.3;
        this.tilt += (targetTilt - this.tilt) * 0.2;
      }
    }

    this.level = active ? Math.min(1, this.level + 0.07) : Math.max(0, this.level - 0.06);
    this.pivot.visible = this.level > 0.01;
    if (!this.pivot.visible) return;

    const L = this.level;
    const s = easeOutBack(L); // entrada com pulinho
    const t = Math.min(1, Math.max(0, (L - 0.15) / 0.85));
    const unfold = t * t * (3 - 2 * t); // as asas se abrem a partir do escudo
    const r = this.radius * (1 + 0.04 * Math.sin(now / 220));

    this.pivot.position.set(this.cx, this.cy, 0);
    this.pivot.rotation.z = this.tilt * 0.5;
    this.pivot.scale.set(s, s, 1);

    // Corpo
    place(this.sunburst, 0, 0, r * 1.9, r * 1.9, L * 0.45 * (0.8 + 0.2 * Math.sin(now / 400)), now / 9000);
    place(this.glass, 0, 0, r, r, L * 0.9);
    place(this.ring, 0, 0, r * 1.05, r * 1.05, L, now / 5000);
    place(this.sigil, 0, 0, r * 0.82, r * 0.82, L, -now / 3500);
    const fl = r * 0.75 * (0.9 + 0.1 * Math.sin(now / 250));
    place(this.flare, 0, 0, fl, fl, L, now / 6000);

    // Auréola: elipse achatada acima do escudo (y negativo = para cima na tela)
    place(this.halo, 0, -r * 1.45, r * 0.8, r * 0.22, L * (0.75 + 0.25 * Math.sin(now / 350)));

    // Asas: a textura é a asa direita; a esquerda é o espelho (escala x negativa)
    const sx = (WING_REACH * r) / (2 * (WING_MAX_LEN / WING_W));
    const sy = (sx * WING_H) / WING_W;
    const rootX = ((WING_ROOT.x * 2) / WING_W - 1) * sx;
    const rootY = ((WING_ROOT.y * 2) / WING_H - 1) * sy;
    const wingOpacity = L * unfold * (0.8 + 0.2 * Math.sin(now / 500));
    const flap = 0.1 * Math.sin(now / 650);

    this.wingPivotR.position.set(WING_ANCHOR * r, -0.1 * r, 0);
    this.wingPivotL.position.set(-WING_ANCHOR * r, -0.1 * r, 0);
    this.wingPivotR.rotation.z = flap;
    this.wingPivotL.rotation.z = -flap;
    place(this.wingR, -rootX * unfold, -rootY, sx * unfold, sy, wingOpacity);
    place(this.wingL, rootX * unfold, -rootY, -sx * unfold, sy, wingOpacity);

    // Motes de luz orbitando o anel
    const orbit = r * 1.12;
    for (let k = 0; k < MOTES; k++) {
      const ang = now / 1800 + (k * Math.PI * 2) / MOTES;
      this.motePos[k * 3] = Math.cos(ang) * orbit;
      this.motePos[k * 3 + 1] = Math.sin(ang) * orbit;
      this.motePos[k * 3 + 2] = 0;
      this.moteSize[k] = 14 + 8 * Math.sin(now / 300 + k * 1.7);
    }
    this.moteAttrPos.needsUpdate = true;
    this.moteAttrSize.needsUpdate = true;
    this.moteMat.uniforms.uAlpha.value = L;
  }
}