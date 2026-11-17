import type { Scene } from "three";
import type { Hand } from "../tracking/handTracker";
import { handScale, type GestureName } from "../gestures/gestures";
import { FireGL } from "../effects/fireGL";
import { AngelicGL } from "../effects/angelicGL";
import { ShieldGL } from "../effects/shieldGL";
import { GeodesicGlobeGL } from "../effects/geodesicGlobeGL";
import { BoltBeam } from "../effects/boltBeam";
import { fakeHand } from "../effects/fakeHand";

// ---- Ajustes (velocidades em px/s, para um vídeo de 1280 px; escalam sozinhas com a largura real) ----
const THROW_SPEED = 550;      // velocidade da mão para contar como arremesso
const MAX_HAND_SPEED = 9000;   // acima disso é falha do rastreamento, não um arremesso
const MIN_SPEED = 900;         // velocidade mínima do projétil
const MAX_SPEED = 2200;        // velocidade máxima do projétil
const DRAG = 0.992;            // freio por ~16 ms (1.0 = não desacelera)
const LIFE_MS = 2500;          // tempo máximo de voo
const FADE_MS = 1300;          // tempo de "apagar" antes de liberar o projétil para reuso
const LOCK_MS = 700;           // tempo que o efeito some da mão depois do arremesso
const POOL = 2;                // projéteis simultâneos de cada tipo
const MARGIN = 150;            // folga fora da tela antes de o projétil apagar
const REFERENCE_WIDTH = 1280;  // largura de referência das velocidades acima

type Kind = "fire" | "orb" | "globe" | "shield" | "bolt";
type Throwable = Exclude<Kind, "bolt">;
type V = { x: number; y: number };

// Qual gesto lança qual feitiço. Remova uma linha para desativar o arremesso daquele gesto.
const KIND_BY_GESTURE: Partial<Record<GestureName, Kind>> = {
  fist: "fire",
  pinch: "orb",
  three: "globe",
  openPalm: "shield",
  spark: "bolt",
};

type Slot = {
  busy: boolean;
  step: (hand: Hand | null, active: boolean, now: number) => void;
};

type Projectile = {
  slot: Slot;
  x: number;
  y: number;
  vx: number; // px/s
  vy: number;
  born: number;
  fadeAt: number | null;
  size: number;
  spread: number;
};

/** Média de landmarks, em pixels. */
function avgPx(hand: Hand, idx: number[], w: number, h: number): V {
  let sx = 0;
  let sy = 0;
  for (const i of idx) {
    sx += hand[i].x;
    sy += hand[i].y;
  }
  return { x: (sx / idx.length) * w, y: (sy / idx.length) * h };
}

export class ProjectileSystem {
  /** Maior velocidade de mão no último frame (na escala de 1280 px): use para calibrar o THROW_SPEED. */
  debugSpeed = 0;

  private readonly pool: Record<Throwable, Slot[]>;
  private readonly beam: BoltBeam;
  private readonly speedScale: number;
  private live: Projectile[] = [];
  private prev: (V | null)[] = [null, null];
  private vel: V[] = [{ x: 0, y: 0 }, { x: 0, y: 0 }];
  private lockUntil = [0, 0];
  private prevT = 0;
  private lastCount = 0;

  constructor(
    scene: Scene,
    private readonly w: number,
    private readonly h: number,
    private readonly aspect: number,
  ) {
    this.speedScale = w / REFERENCE_WIDTH;

    // Cria POOL instâncias de um efeito, cada uma com um "step" que chama o update certo dele
    const make = <T>(
      create: () => T,
      step: (fx: T, hand: Hand | null, active: boolean, now: number) => void,
    ): Slot[] =>
      Array.from({ length: POOL }, (): Slot => {
        const fx = create();
        return {
          busy: false,
          step: (hand: Hand | null, active: boolean, now: number): void => step(fx, hand, active, now),
        };
      });

    this.pool = {
      fire: make(
        () => new FireGL(scene),
        (fx, hand, active) => fx.update(hand, active, aspect, w, h),
      ),
      orb: make(
        () => new AngelicGL(scene),
        (fx, hand, active, now) => fx.update(hand, active, now, aspect, w, h),
      ),
      globe: make(
        () => new GeodesicGlobeGL(scene, w, h),
        (fx, hand, active, now) => fx.update(hand, active, now, aspect, w, h),
      ),
      shield: make(
        () => new ShieldGL(scene),
        (fx, hand, active, now) => fx.update(hand, active, now, aspect, w, h),
      ),
    };
    this.beam = new BoltBeam(scene, w, h);
  }

  /** O efeito dessa mão deve ficar apagado (acabou de lançar e está "recarregando")? */
  isLocked(handIndex: number, now: number): boolean {
    return now < this.lockUntil[handIndex];
  }

  /**
   * suppressLaunch = true impede novos lançamentos (use durante fusões de magias,
   * para não lançar sem querer ao mover a mão rápido para montá-las).
   */
  update(hands: Hand[], gestures: GestureName[], now: number, suppressLaunch = false): void {
    const dt = Math.min(50, Math.max(1, now - this.prevT));
    this.prevT = now;
    this.debugSpeed = 0;

    // Se a quantidade de mãos mudou, os índices podem ter trocado de mão: reinicia a medição
    if (hands.length !== this.lastCount) {
      this.lastCount = hands.length;
      this.prev = [null, null];
      this.vel = [{ x: 0, y: 0 }, { x: 0, y: 0 }];
    }

    // 1. Velocidade de cada mão e detecção do arremesso
    for (let i = 0; i < 2; i++) {
      const hand = hands[i];
      if (!hand) {
        this.prev[i] = null;
        continue;
      }
      const p = { x: hand[9].x * this.w, y: hand[9].y * this.h }; // base do dedo médio
      const last = this.prev[i];
      this.prev[i] = p;
      if (!last) {
        this.vel[i] = { x: 0, y: 0 };
        continue;
      }

      const v = this.vel[i];
      v.x += (((p.x - last.x) / dt) * 1000 - v.x) * 0.5; // suaviza
      v.y += (((p.y - last.y) / dt) * 1000 - v.y) * 0.5;
      const speed = Math.hypot(v.x, v.y);
      this.debugSpeed = Math.max(this.debugSpeed, speed / this.speedScale);

      const kind = KIND_BY_GESTURE[gestures[i]];
      if (!kind || suppressLaunch || now < this.lockUntil[i]) continue;
      if (speed < THROW_SPEED * this.speedScale) continue;
      if (speed > MAX_HAND_SPEED * this.speedScale) continue; // salto do rastreamento, não um arremesso

      if (this.launch(kind, hand, v, speed, now)) this.lockUntil[i] = now + LOCK_MS;
    }

    // 2. Voo dos projéteis
    const drag = Math.pow(DRAG, dt / 16.7);
    const alive: Projectile[] = [];
    for (const p of this.live) {
      if (p.fadeAt === null) {
        p.x += (p.vx * dt) / 1000;
        p.y += (p.vy * dt) / 1000;
        p.vx *= drag;
        p.vy *= drag;
        const out = p.x < -MARGIN || p.x > this.w + MARGIN || p.y < -MARGIN || p.y > this.h + MARGIN;
        if (out || now - p.born > LIFE_MS) p.fadeAt = now;
      }

      if (p.fadeAt === null) {
        p.slot.step(fakeHand(p.x, p.y, p.size, p.spread, this.w, this.h), true, now);
      } else {
        p.slot.step(null, false, now); // apaga no lugar
        if (now - p.fadeAt > FADE_MS) {
          p.slot.busy = false;
          continue;
        }
      }
      alive.push(p);
    }
    this.live = alive;

    this.beam.update();
  }

  /** Retorna true se o lançamento aconteceu. */
  private launch(kind: Kind, hand: Hand, v: V, speed: number, now: number): boolean {
    const w = this.w;
    const h = this.h;
    const dir = { x: v.x / speed, y: v.y / speed };

    if (kind === "bolt") {
      this.beam.fire(avgPx(hand, [4, 8], w, h), dir); // sai do meio entre polegar e indicador
      return true;
    }

    const slot = this.pool[kind].find((s) => !s.busy);
    if (!slot) return false;
    slot.busy = true;

    // Origem: onde o efeito estava na mão (para parecer que ele se soltou)
    const origin =
      kind === "fire"
        ? avgPx(hand, [5, 9, 13, 17], w, h)
        : kind === "orb"
          ? avgPx(hand, [4, 8], w, h)
          : kind === "globe"
            ? avgPx(hand, [4, 8, 12], w, h)
            : avgPx(hand, [0, 5, 9, 13, 17], w, h);

    // O globo tem tamanho que depende da abertura dos dedos: guarda para manter igual no voo
    let spread = 0;
    if (kind === "globe") {
      const a = avgPx(hand, [4], w, h);
      const b = avgPx(hand, [8], w, h);
      const c = avgPx(hand, [12], w, h);
      spread = Math.max(
        Math.hypot(a.x - b.x, a.y - b.y),
        Math.hypot(a.x - c.x, a.y - c.y),
        Math.hypot(b.x - c.x, b.y - c.y),
      );
    }

    const sc = this.speedScale;
    const s = Math.min(MAX_SPEED * sc, Math.max(MIN_SPEED * sc, speed * 1.1));
    this.live.push({
      slot,
      x: origin.x,
      y: origin.y,
      vx: dir.x * s,
      vy: dir.y * s,
      born: now,
      fadeAt: null,
      size: handScale(hand, this.aspect) * h,
      spread,
    });
    return true;
  }
}