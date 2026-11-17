import type { Hand } from "../tracking/handTracker";

/**
 * Mão sintética: 21 pontos arrumados para que os efeitos (que leem landmarks) se comportem
 * como se houvesse uma mão aberta, de frente, no ponto (x, y).
 *
 * size   = tamanho da mão em pixels (distância do pulso à base do dedo médio)
 * spread = separação entre polegar e indicador em pixels (usado pelo globo)
 */
export function fakeHand(
  x: number,
  y: number,
  size: number,
  spread: number,
  w: number,
  h: number,
): Hand {
  const lm = (px: number, py: number) => ({ x: px / w, y: py / h, z: 0, visibility: 1 });
  const hand: Hand = Array.from({ length: 21 }, () => lm(x, y));

  hand[0] = lm(x, y + size / 2);        // pulso
  hand[9] = lm(x, y - size / 2);        // base do dedo médio
  hand[5] = lm(x + 0.6 * size, y);      // base do indicador  } largura da palma = 1.2x o tamanho
  hand[17] = lm(x - 0.6 * size, y);     // base do mindinho   } (escudo de frente, sem achatar)
  hand[4] = lm(x - spread / 2, y);      // ponta do polegar
  hand[8] = lm(x + spread / 2, y);      // ponta do indicador
  hand[12] = lm(x, y);                  // ponta do dedo médio

  return hand;
}