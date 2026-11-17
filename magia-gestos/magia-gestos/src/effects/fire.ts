import type { Hand } from "../tracking/handTracker";
import { handScale } from "../gestures/gestures";

type Particle = {
  x: number; y: number;
  vx: number; vy: number;
  life: number; maxLife: number;
  size: number;
};

const KNUCKLES = [5, 9, 13, 17]; // base dos dedos = topo do punho

export class FireEffect {
  private particles: Particle[] = [];
  private level = 0;
  private cx = 0;
  private cy = 0;
  private scale = 0;

  draw(ctx: CanvasRenderingContext2D, hand: Hand | null, active: boolean, aspect: number): void {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;

    if (hand) {
      let sx = 0;
      let sy = 0;
      for (const i of KNUCKLES) {
        sx += hand[i].x;
        sy += hand[i].y;
      }
      this.cx = (sx / KNUCKLES.length) * w;
      this.cy = (sy / KNUCKLES.length) * h;
      this.scale = handScale(hand, aspect) * h;
    }

    this.level = active ? Math.min(1, this.level + 0.1) : Math.max(0, this.level - 0.08);

    // Emissão: só enquanto o gesto está ativo
    if (active && this.scale > 0) {
      const count = Math.round(6 * this.level);
      for (let i = 0; i < count; i++) {
        this.particles.push({
          x: this.cx + (Math.random() - 0.5) * this.scale * 0.9,
          y: this.cy + (Math.random() - 0.5) * this.scale * 0.3,
          vx: (Math.random() - 0.5) * 1.2,
          vy: -(1.5 + Math.random() * 2.5) * (this.scale / 80),
          life: 0,
          maxLife: 28 + Math.random() * 22,
          size: this.scale * (0.22 + Math.random() * 0.25),
        });
      }
    }

    // Atualização
    for (const p of this.particles) {
      p.x += p.vx + (Math.random() - 0.5) * 1.2;
      p.y += p.vy;
      p.vy *= 0.985;
      p.life++;
    }
    this.particles = this.particles.filter((p) => p.life < p.maxLife);

    if (this.particles.length === 0 && this.level <= 0.01) return;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    // Brilho base no punho
    if (this.level > 0.01) {
      const r = this.scale * 1.6;
      const g = ctx.createRadialGradient(this.cx, this.cy, 0, this.cx, this.cy, r);
      g.addColorStop(0, `rgba(255,140,40,${0.35 * this.level})`);
      g.addColorStop(1, "rgba(255,60,0,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(this.cx, this.cy, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Partículas: branco-amarelo → laranja → vermelho
    for (const p of this.particles) {
      const t = p.life / p.maxLife;
      const r = p.size * (1 - t * 0.7);
      const a = (1 - t) * 0.9;
      const [R, G, B] = t < 0.3 ? [255, 230, 140] : t < 0.6 ? [255, 140, 30] : [200, 40, 10];

      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      g.addColorStop(0, `rgba(${R},${G},${B},${a})`);
      g.addColorStop(1, `rgba(${R},${G},${B},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }
}