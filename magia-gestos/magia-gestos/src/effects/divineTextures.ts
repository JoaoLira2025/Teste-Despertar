import * as THREE from "three";

const S = 1024;
const C = S / 2;
const R = S / 2 - 6;

// Medidas do desenho da asa (usadas também pelo DivineShieldGL para posicionar a raiz da asa)
export const WING_W = 1024;
export const WING_H = 640;
export const WING_ROOT = { x: 50, y: 470 };
export const WING_MAX_LEN = 880;

type Ctx = CanvasRenderingContext2D;

function newCanvas(w: number, h: number): { cv: HTMLCanvasElement; ctx: Ctx } {
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext("2d")!;
  ctx.strokeStyle = "#ffffff";
  ctx.fillStyle = "#ffffff";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  return { cv, ctx };
}

function toTexture(cv: HTMLCanvasElement, flipY = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.flipY = flipY;
  return t;
}

/** Ponto a r do centro, com o ângulo medido no sentido horário a partir do topo. */
function polar(r: number, a: number): [number, number] {
  return [C + Math.sin(a) * r, C - Math.cos(a) * r];
}

function circle(ctx: Ctx, r: number, lw: number): void {
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.arc(C, C, r, 0, Math.PI * 2);
  ctx.stroke();
}

function star4(ctx: Ctx, radius: number, pinch: number, rot: number): void {
  ctx.beginPath();
  for (let k = 0; k < 8; k++) {
    const a = rot + (k * Math.PI) / 4;
    const r = k % 2 === 0 ? radius : radius * pinch;
    const [x, y] = polar(r, a);
    if (k === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** Asa direita: raiz à esquerda, penas em leque (3 fileiras). A asa esquerda é o espelho. */
function makeWing(): THREE.CanvasTexture {
  const { cv, ctx } = newCanvas(WING_W, WING_H);
  const rx = WING_ROOT.x;
  const ry = WING_ROOT.y;
  const deg = Math.PI / 180;
  const peak = -22 * deg;
  const spread = 65 * deg;

  const feather = (angle: number, len: number, wid: number): void => {
    ctx.save();
    ctx.translate(rx, ry);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(len * 0.45, -wid, len, 0);
    ctx.quadraticCurveTo(len * 0.45, wid * 0.55, 0, 0);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, 0, len, 0);
    g.addColorStop(0, "rgba(255,255,255,0.05)");
    g.addColorStop(1, "rgba(255,255,255,0.3)");
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.stroke();
    // nervura central da pena
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(255,255,255,0.45)";
    ctx.beginPath();
    ctx.moveTo(len * 0.08, 0);
    ctx.lineTo(len * 0.92, 0);
    ctx.stroke();
    ctx.restore();
  };

  // Comprimento por ângulo: penas do meio mais longas, as das pontas mais curtas
  const lenAt = (a: number): number =>
    WING_MAX_LEN * (0.3 + 0.7 * Math.max(0, Math.cos(((a - peak) / spread) * (Math.PI / 2))));

  // Das penas longas (atrás) para as curtas (na frente)
  const rows = [
    { n: 9, scale: 1.0, from: -80, to: 8, wid: 90 },
    { n: 8, scale: 0.66, from: -74, to: 2, wid: 66 },
    { n: 6, scale: 0.4, from: -66, to: -4, wid: 46 },
  ];
  for (const row of rows) {
    for (let i = 0; i < row.n; i++) {
      const a = (row.from + ((row.to - row.from) * i) / (row.n - 1)) * deg;
      feather(a, lenAt(a) * row.scale, row.wid);
    }
  }

  // articulação do ombro
  ctx.beginPath();
  ctx.arc(rx, ry, 12, 0, Math.PI * 2);
  ctx.fill();

  return toTexture(cv, false); // flipY false: a câmera tem o eixo Y invertido
}

/** Sol de raios: 32 raios alternando longos e curtos. */
function makeSunburst(): THREE.CanvasTexture {
  const { cv, ctx } = newCanvas(S, S);
  const g = ctx.createRadialGradient(C, C, R * 0.25, C, C, R);
  g.addColorStop(0, "rgba(255,255,255,0.9)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;

  const n = 32;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const long = k % 2 === 0;
    const len = R * (long ? 1 : 0.68);
    const half = long ? 0.045 : 0.03;
    ctx.beginPath();
    ctx.moveTo(...polar(R * 0.25, a - half));
    ctx.lineTo(...polar(len, a));
    ctx.lineTo(...polar(R * 0.25, a + half));
    ctx.closePath();
    ctx.fill();
  }
  return toTexture(cv);
}

/** Sigilo: octagrama {8/3}, círculos, marcas e um mini sol no centro. */
function makeSigil(): THREE.CanvasTexture {
  const { cv, ctx } = newCanvas(S, S);
  circle(ctx, R * 0.9, 5);
  circle(ctx, R * 0.84, 2);
  circle(ctx, R * 0.42, 4);

  // Octagrama: liga cada vértice ao 3º seguinte
  const rv = R * 0.8;
  ctx.lineWidth = 5;
  ctx.beginPath();
  for (let k = 0; k <= 8; k++) {
    const [x, y] = polar(rv, ((k * 3) % 8) * (Math.PI / 4));
    if (k === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // círculos nos 8 vértices
  for (let k = 0; k < 8; k++) {
    const [x, y] = polar(rv, k * (Math.PI / 4));
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(x, y, R * 0.04, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 48 marcações pequenas
  ctx.lineWidth = 3;
  for (let k = 0; k < 48; k++) {
    const a = (k / 48) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(...polar(R * 0.855, a));
    ctx.lineTo(...polar(R * 0.885, a));
    ctx.stroke();
  }

  // mini sol: 12 raios curtos em volta de um círculo
  circle(ctx, R * 0.1, 4);
  ctx.lineWidth = 4;
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(...polar(R * 0.14, a));
    ctx.lineTo(...polar(R * (k % 2 === 0 ? 0.3 : 0.22), a));
    ctx.stroke();
  }
  return toTexture(cv);
}

/** Brilho central: halo macio + duas estrelas de 4 pontas (uma girada 45°). */
function makeFlare(): THREE.CanvasTexture {
  const { cv, ctx } = newCanvas(S, S);

  const glow = ctx.createRadialGradient(C, C, 0, C, C, R * 0.5);
  glow.addColorStop(0, "rgba(255,255,255,1)");
  glow.addColorStop(0.35, "rgba(255,255,255,0.35)");
  glow.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(C, C, R * 0.5, 0, Math.PI * 2);
  ctx.fill();

  const rays = ctx.createRadialGradient(C, C, 0, C, C, R);
  rays.addColorStop(0, "rgba(255,255,255,0.95)");
  rays.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = rays;
  star4(ctx, R * 0.98, 0.07, 0);
  ctx.fill();
  star4(ctx, R * 0.55, 0.1, Math.PI / 4);
  ctx.fill();

  return toTexture(cv);
}

/** Anel de auréola (será achatado em elipse pelo DivineShieldGL). */
function makeHalo(): THREE.CanvasTexture {
  const { cv, ctx } = newCanvas(S, S);
  ctx.shadowColor = "#ffffff";
  ctx.shadowBlur = 40;
  circle(ctx, R * 0.78, 18);
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(255,255,255,0.6)";
  circle(ctx, R * 0.66, 4);
  return toTexture(cv);
}

type DivineTextures = {
  wing: THREE.CanvasTexture;
  sunburst: THREE.CanvasTexture;
  sigil: THREE.CanvasTexture;
  flare: THREE.CanvasTexture;
  halo: THREE.CanvasTexture;
};

let cache: DivineTextures | null = null;

export function getDivineTextures(): DivineTextures {
  if (!cache) {
    cache = {
      wing: makeWing(),
      sunburst: makeSunburst(),
      sigil: makeSigil(),
      flare: makeFlare(),
      halo: makeHalo(),
    };
  }
  return cache;
}