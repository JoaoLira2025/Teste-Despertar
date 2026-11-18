import type { Hand } from "../tracking/handTracker";

export type GestureName = "none" | "openPalm" | "pinch" | "fist" | "spark" | "three" | "one";
type Point = { x: number; y: number };

// Índices dos landmarks do MediaPipe
const WRIST = 0;
const THUMB_IP = 3;
const THUMB_TIP = 4;
const INDEX_TIP = 8;
const MIDDLE_MCP = 9;
const PINKY_MCP = 17;

// [ponta, articulação do meio (PIP)] de cada dedo (sem o polegar)
const FINGERS: [number, number][] = [
  [8, 6],   // indicador
  [12, 10], // médio
  [16, 14], // anelar
  [20, 18], // mindinho
];

/** Distância 2D corrigindo a proporção do vídeo (x é normalizado pela largura, y pela altura). */
function dist(a: Point, b: Point, aspect: number): number {
  return Math.hypot((a.x - b.x) * aspect, a.y - b.y);
}

/** Tamanho de referência da mão: pulso até a base do dedo médio. */
export function handScale(hand: Hand, aspect: number): number {
  return dist(hand[WRIST], hand[MIDDLE_MCP], aspect);
}

function isFingerExtended(hand: Hand, tip: number, pip: number, aspect: number): boolean {
  return dist(hand[WRIST], hand[tip], aspect) > dist(hand[WRIST], hand[pip], aspect) * 1.15;
}

function isThumbExtended(hand: Hand, aspect: number): boolean {
  return dist(hand[THUMB_TIP], hand[PINKY_MCP], aspect) > dist(hand[THUMB_IP], hand[PINKY_MCP], aspect) * 1.1;
}

/** Distância entre a ponta do polegar e do indicador, relativa ao tamanho da mão (0 = encostados). */
export function pinchRatio(hand: Hand, aspect: number): number {
  return dist(hand[THUMB_TIP], hand[INDEX_TIP], aspect) / handScale(hand, aspect);
}

/** Classificação "crua" de um frame (ainda sem estabilização). */
export function classifyHand(hand: Hand, aspect: number): GestureName {
  const ext = FINGERS.map(([tip, pip]) => isFingerExtended(hand, tip, pip, aspect));
  const extended = ext.filter(Boolean).length;

  // Punho: dedos recolhidos e a ponta do indicador perto do pulso
  const indexTight = dist(hand[WRIST], hand[INDEX_TIP], aspect) / handScale(hand, aspect) < 1.15;
  if (extended === 0 && indexTight) return "fist";

  if (pinchRatio(hand, aspect) < 0.3) return "pinch";
  if (extended === 4 && isThumbExtended(hand, aspect)) return "openPalm";
  if (ext[0] && ext[1] && !ext[2] && !ext[3] && isThumbExtended(hand, aspect)) return "three";
  if (ext[0] && !ext[1] && !ext[2] && !ext[3] && isThumbExtended(hand, aspect)) return "spark";
  if (extended === 0) return "fist";
  if (ext[0] && !ext[1] && !ext[2] && !ext[3]) {
    // Além de esticado, verificamos se o dedão está perto da palma (para não ser o "L")
    const thumbTight = dist(hand[WRIST], hand[THUMB_TIP], aspect) / handScale(hand, aspect) < 1.5;
    if (thumbTight) return "one";
  }
  
  return "none";
}

/**
 * Evita disparos falsos: o gesto só muda depois de aparecer por N frames seguidos.
 * Use uma instância por mão.
 */
export class GestureStabilizer {
  private current: GestureName = "none";
  private candidate: GestureName = "none";
  private count = 0;

  constructor(private framesToChange = 4) {}

  update(raw: GestureName): GestureName {
    if (raw === this.current) {
      this.candidate = raw;
      this.count = 0;
      return this.current;
    }
    if (raw === this.candidate) {
      this.count++;
    } else {
      this.candidate = raw;
      this.count = 1;
    }
    if (this.count >= this.framesToChange) {
      this.current = raw;
      this.count = 0;
    }
    return this.current;
  }
}