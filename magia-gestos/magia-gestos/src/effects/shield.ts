import type { Hand } from "../tracking/handTracker";
import { handScale } from "../gestures/gestures";

const PALM = [0, 5, 9, 13, 17]; // pulso + base dos dedos = centro da palma

export class ShieldEffect {
  private level = 0;
  private cx = 0;
  private cy = 0;
  private radius = 0;

  draw(
    ctx: CanvasRenderingContext2D,
    hand: Hand | null,
    active: boolean,
    now: number,
    aspect: number,
  ): void {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;

    let angle = 0;
    let flatness = 1; // 1 = de frente, 0 = de lado

    if (hand) {
      // 1. Centro da palma
      let sx = 0;
      let sy = 0;
      for (const i of PALM) {
        sx += hand[i].x;
        sy += hand[i].y;
      }
      const tx = (sx / PALM.length) * w;
      const ty = (sy / PALM.length) * h;
      const tr = handScale(hand, aspect) * h * 1.0; 

      if (this.level === 0) {
        this.cx = tx; this.cy = ty; this.radius = tr;
      } else {
        this.cx += (tx - this.cx) * 0.4;
        this.cy += (ty - this.cy) * 0.4;
        this.radius += (tr - this.radius) * 0.4;
      }

      // 2. Cálculo de perspectiva
      // Ângulo: do pulso (0) até a base do dedo médio (9)
      const dxY = (hand[9].x - hand[0].x) * aspect;
      const dyY = hand[9].y - hand[0].y;
      angle = Math.atan2(dyY, dxY);

      // Largura da palma: distância entre a base do mindinho (17) e do indicador (5)
      const dxX = (hand[5].x - hand[17].x) * aspect;
      const dyX = hand[5].y - hand[17].y;
      const currentWidth = Math.hypot(dxX, dyX);
      
      // Largura esperada se a mão estivesse de frente (proporcional ao tamanho)
      const expectedWidth = handScale(hand, aspect) * 1.2; 
      
      // Evita divisão por zero e limita entre 0.2 e 1
      const rawRatio = currentWidth / Math.max(expectedWidth, 0.0001);
      flatness = Math.max(0.2, Math.min(1, rawRatio));
    }

    this.level = active ? Math.min(1, this.level + 0.08) : Math.max(0, this.level - 0.06);
    if (this.level <= 0.01) return;

    const r = this.radius * (0.6 + 0.4 * this.level) * (1 + 0.04 * Math.sin(now / 140));

    ctx.save();
    
    // 3. Aplica a transformação no Canvas
    ctx.translate(this.cx, this.cy);
    ctx.rotate(angle - Math.PI / 2); 
    
    // Achatamento no eixo X (perspectiva)
    ctx.scale(flatness, 1); 

    this.drawShield(ctx, r, now);
    
    ctx.restore();
  }

  private drawShield(ctx: CanvasRenderingContext2D, r: number, now: number) {
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = this.level;

    const g = ctx.createRadialGradient(0, 0, r * 0.2, 0, 0, r);
    g.addColorStop(0, "rgba(56,232,255,0.02)");
    g.addColorStop(0.7, "rgba(56,232,255,0.12)");
    g.addColorStop(1, "rgba(120,200,255,0.35)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowColor = "#38e8ff";
    ctx.shadowBlur = 25;
    ctx.strokeStyle = "#9ff4ff";

    this.hexagon(ctx, 0, 0, r, now / 2000);
    ctx.lineWidth = 4;
    ctx.stroke();

    this.hexagon(ctx, 0, 0, r * 0.78, -now / 1500);
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, 0, r * 1.08, 0, Math.PI * 2);
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
    // Retorna as coordenadas e o raio atual do escudo
  public getCenter() {
    return { x: this.cx, y: this.cy, radius: this.radius, level: this.level };
  }

  // Desenha o super escudo combinado
  public drawCombined(
    ctx: CanvasRenderingContext2D,
    handA: Hand,
    handB: Hand,
    now: number,
    aspect: number,
  ): void {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;

    let sx = 0;
    let sy = 0;
    for (const i of PALM) {
      sx += handA[i].x + handB[i].x;
      sy += handA[i].y + handB[i].y;
    }
    const cx = (sx / (PALM.length * 2)) * w;
    const cy = (sy / (PALM.length * 2)) * h;

    const dist = Math.hypot(handA[9].x * w - handB[9].x * w, handA[9].y * h - handB[9].y * h);
    const baseScale = (handScale(handA, aspect) + handScale(handB, aspect)) / 2;
    const r = Math.max(dist * 0.8, baseScale * h * 1.5);

    this.level = Math.min(1, this.level + 0.1);

    ctx.save();
    ctx.translate(cx, cy);
    
    const pulse = 1 + 0.05 * Math.sin(now / 100);
    
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = this.level;

    const g = ctx.createRadialGradient(0, 0, r * 0.3, 0, 0, r);
    g.addColorStop(0, "rgba(255,255,255,0.05)");
    g.addColorStop(0.6, "rgba(56,232,255,0.2)");
    g.addColorStop(1, "rgba(160,100,255,0.5)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r * pulse, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowColor = "#a064ff";
    ctx.shadowBlur = 40;
    ctx.strokeStyle = "#e0f4ff";

    this.hexagon(ctx, 0, 0, r * pulse, now / 1500);
    ctx.lineWidth = 6;
    ctx.stroke();

    this.hexagon(ctx, 0, 0, r * pulse * 0.8, -now / 1200);
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, 0, r * pulse * 1.1, 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.restore();
  }

  private hexagon(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, rot: number): void {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = rot + (i * Math.PI) / 3;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }
}