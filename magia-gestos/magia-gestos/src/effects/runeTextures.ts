import * as THREE from "three";

const SIZE = 1024;
const C = SIZE / 2;
const R = SIZE / 2 - 6;

type Stroke = [number, number][];
type Glyph = Stroke[];

// Runas inspiradas no Futhark antigo, desenhadas como traços (não dependem de fonte).
// Coordenadas em uma caixa 0..1 (y para baixo).
const GLYPHS: Glyph[] = [
  [[[0.3, 0], [0.3, 1]], [[0.3, 0.3], [0.8, 0]], [[0.3, 0.6], [0.8, 0.3]]],                  // fehu
  [[[0.2, 1], [0.2, 0], [0.8, 0.3], [0.8, 1]]],                                              // uruz
  [[[0.25, 0], [0.25, 1]], [[0.25, 0.25], [0.75, 0.5], [0.25, 0.75]]],                       // thurisaz
  [[[0.25, 0], [0.25, 1]], [[0.25, 0.1], [0.8, 0.35]], [[0.25, 0.4], [0.8, 0.65]]],          // ansuz
  [[[0.25, 1], [0.25, 0], [0.75, 0.2], [0.75, 0.4], [0.25, 0.6]], [[0.25, 0.6], [0.8, 1]]],  // raidho
  [[[0.75, 0.15], [0.25, 0.5], [0.75, 0.85]]],                                               // kenaz
  [[[0.2, 0.1], [0.8, 0.9]], [[0.8, 0.1], [0.2, 0.9]]],                                      // gebo
  [[[0.25, 0], [0.25, 1]], [[0.25, 0.05], [0.75, 0.3], [0.25, 0.55]]],                       // wunjo
  [[[0.25, 0], [0.25, 1]], [[0.75, 0], [0.75, 1]], [[0.25, 0.35], [0.75, 0.65]]],            // hagalaz
  [[[0.5, 0], [0.5, 1]], [[0.2, 0.35], [0.8, 0.65]]],                                        // nauthiz
  [[[0.5, 0], [0.5, 1]], [[0.5, 0], [0.8, 0.25]], [[0.5, 1], [0.2, 0.75]]],                  // eihwaz
  [[[0.5, 0], [0.5, 1]], [[0.5, 0.5], [0.2, 0.15]], [[0.5, 0.5], [0.8, 0.15]]],              // algiz
  [[[0.65, 0], [0.35, 0.33], [0.65, 0.66], [0.35, 1]]],                                      // sowilo
  [[[0.5, 0], [0.5, 1]], [[0.5, 0], [0.2, 0.3]], [[0.5, 0], [0.8, 0.3]]],                    // tiwaz
  [[[0.25, 0], [0.25, 1]], [[0.25, 0], [0.75, 0.25], [0.25, 0.5], [0.75, 0.75], [0.25, 1]]], // berkano
  [[[0.2, 0.1], [0.2, 0.9], [0.8, 0.1], [0.8, 0.9], [0.2, 0.1]]],                            // dagaz
];

type Ctx = CanvasRenderingContext2D;

function newCanvas(): { cv: HTMLCanvasElement; ctx: Ctx } {
  const cv = document.createElement("canvas");
  cv.width = SIZE;
  cv.height = SIZE;
  const ctx = cv.getContext("2d")!;
  ctx.strokeStyle = "#ffffff";
  ctx.fillStyle = "#ffffff";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  return { cv, ctx };
}

function toTexture(cv: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
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

function dot(ctx: Ctx, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function line(ctx: Ctx, a: [number, number], b: [number, number], lw: number): void {
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  ctx.lineTo(b[0], b[1]);
  ctx.stroke();
}

function runeRing(ctx: Ctx, count: number, rMid: number, height: number, lw: number, offset: number): void {
  const width = height * 0.55;
  ctx.lineWidth = lw;
  for (let k = 0; k < count; k++) {
    const glyph = GLYPHS[(k * 5 + offset) % GLYPHS.length];
    ctx.save();
    ctx.translate(C, C);
    ctx.rotate((k / count) * Math.PI * 2);
    ctx.translate(0, -rMid);
    for (const stroke of glyph) {
      ctx.beginPath();
      stroke.forEach(([px, py], i) => {
        const x = (px - 0.5) * width;
        const y = (py - 0.5) * height;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
    ctx.restore();
  }
}

/** Hexagrama: dois triângulos inscritos no raio r. */
function hexagram(ctx: Ctx, r: number, lw: number): void {
  ctx.lineWidth = lw;
  for (let t = 0; t < 2; t++) {
    ctx.beginPath();
    for (let k = 0; k < 3; k++) {
      const [x, y] = polar(r, t * (Math.PI / 3) + k * ((Math.PI * 2) / 3));
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
  }
}

/** Anel externo: duas bordas, faixa de runas e divisórias. */
function makeRing(): THREE.CanvasTexture {
  const { cv, ctx } = newCanvas();
  circle(ctx, R, 7);
  circle(ctx, R * 0.94, 2.5);
  circle(ctx, R * 0.78, 5);
  circle(ctx, R * 0.75, 2);

  runeRing(ctx, 32, R * 0.86, R * 0.11, 5, 0);

  // 8 divisórias (grupos de 4 runas) com um ponto de ornamento na borda
  for (let k = 0; k < 8; k++) {
    const a = ((k * 4 - 0.5) / 32) * Math.PI * 2;
    line(ctx, polar(R * 0.785, a), polar(R * 0.935, a), 3);
    const [x, y] = polar(R * 0.97, a);
    dot(ctx, x, y, 7);
  }
  return toTexture(cv);
}

/** Camada interna: hexagrama, círculos, runas pequenas e marcações. */
function makeInner(): THREE.CanvasTexture {
  const { cv, ctx } = newCanvas();
  circle(ctx, R * 0.72, 2);
  circle(ctx, R * 0.66, 5);
  hexagram(ctx, R * 0.66, 4);
  circle(ctx, R * 0.33, 4);

  // marcações tipo engrenagem
  for (let k = 0; k < 36; k++) {
    const a = (k / 36) * Math.PI * 2;
    line(ctx, polar(R * 0.68, a), polar(R * 0.72, a), 3);
  }
  // círculos nos vértices do hexagrama
  for (let k = 0; k < 6; k++) {
    const [x, y] = polar(R * 0.66, (k * Math.PI) / 3);
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(x, y, R * 0.045, 0, Math.PI * 2);
    ctx.stroke();
  }
  runeRing(ctx, 8, R * 0.22, R * 0.09, 4, 3);
  circle(ctx, R * 0.08, 4);
  dot(ctx, C, C, 8);
  return toTexture(cv);
}

/** Vidro translúcido: mais opaco perto da borda. */
function makeGlass(): THREE.CanvasTexture {
  const { cv, ctx } = newCanvas();
  const g = ctx.createRadialGradient(C, C, R * 0.15, C, C, R);
  g.addColorStop(0, "rgba(255,255,255,0.03)");
  g.addColorStop(0.7, "rgba(255,255,255,0.12)");
  g.addColorStop(0.95, "rgba(255,255,255,0.32)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SIZE, SIZE);
  return toTexture(cv);
}

type RuneTextures = {
  glass: THREE.CanvasTexture;
  ring: THREE.CanvasTexture;
  inner: THREE.CanvasTexture;
};

let cache: RuneTextures | null = null;

export function getRuneTextures(): RuneTextures {
  if (!cache) {
    cache = { glass: makeGlass(), ring: makeRing(), inner: makeInner() };
  }
  return cache;
}