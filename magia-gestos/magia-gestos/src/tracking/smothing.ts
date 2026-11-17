import type { Hand } from "./handTracker";

/**
 * Suavização exponencial dos landmarks.
 * alpha perto de 1 = mais responsivo (mais tremor); perto de 0 = mais suave (mais atraso).
 */
export class HandSmoother {
  private prev: Hand[] = [];

  constructor(private alpha = 0.5) {}

  smooth(hands: Hand[]): Hand[] {
    // Ordena por posição do pulso para manter a ordem das mãos estável entre frames
    const sorted = [...hands].sort((a, b) => a[0].x - b[0].x);

    // Se a quantidade de mãos mudou, reinicia (evita "arrastar" a mão anterior)
    if (sorted.length !== this.prev.length) {
      this.prev = sorted.map((h) => h.map((p) => ({ ...p })));
      return this.prev.map((h) => h.map((p) => ({ ...p })));
    }

    this.prev = sorted.map((hand, i) =>
      hand.map((p, j) => {
        const q = this.prev[i][j];
        return {
          ...p,
          x: q.x + (p.x - q.x) * this.alpha,
          y: q.y + (p.y - q.y) * this.alpha,
          z: q.z + (p.z - q.z) * this.alpha,
        };
      }),
    );
    return this.prev.map((h) => h.map((p) => ({ ...p })));
  }
}