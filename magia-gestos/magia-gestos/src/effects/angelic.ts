import type { Hand } from "../tracking/handTracker";
import { handScale } from "../gestures/gestures";

type Spark = {
  x: number; y: number;
  vx: number; vy: number;
  life: number; maxLife: number;
  size: number;
};

export class AngelicEffect {
  private level = 0;
  private cx = 0;
  private cy = 0;
  private r = 0;
  private sparks: Spark[] = [];

  draw(
    ctx: CanvasRenderingContext2D,
    hand: Hand | null,
    active: boolean,
    now: number,
    aspect: number,
  ): void {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;

    if (hand) {
      // O orbe fica entre as pontas do polegar e do indicador
      const tx = ((hand[4].x + hand[8].x) / 2) * w;
      const ty = ((hand[4].y + hand[8].y) / 2) * h;
      const tr = handScale(hand, aspect) * h * 0.35;
      if (this.level === 0) {
        this.cx = tx; this.cy = ty; this.r = tr;
      } else {
        this.cx += (tx - this.cx) * 0.5;
        this.cy += (ty - this.cy) * 0.5;
        this.r += (tr - this.r) * 0.5;
      }
    }

    this.level = active ? Math.min(1, this.level + 0.08) : Math.max(0, this.level - 0.07);

    // Faíscas douradas flutuando para cima
    if (active && this.level > 0.3) {
      for (let i = 0; i < 2; i++) {
        const ang = Math.random() * Math.PI * 2;
        const dist = this.r * (1 + Math.random() * 2.5);
        this.sparks.push({
          x: this.cx + Math.cos(ang) * dist,
          y: this.cy + Math.sin(ang) * dist,
          vx: (Math.random() - 0.5) * 0.6,
          vy: -(0.5 + Math.random() * 1.2) * (this.r / 30),
          life: 0,
          maxLife: 40 + Math.random() * 30,
          size: 2 + Math.random() * 3,
        });
      }
    }
    for (const s of this.sparks) {
      s.x += s.vx;
      s.y += s.vy;
      s.life++;
    }
    this.sparks = this.sparks.filter((s) => s.life < s.maxLife);

    if (this.level <= 0.01 && this.sparks.length === 0) return;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    if (this.level > 0.01) {
      const R = this.r * this.level * (1 + 0.08 * Math.sin(now / 200));
      ctx.globalAlpha = this.level;

      // Brilho suave
      const glow = ctx.createRadialGradient(this.cx, this.cy, 0, this.cx, this.cy, R * 4);
      glow.addColorStop(0, "rgba(255,248,210,0.55)");
      glow.addColorStop(0.4, "rgba(255,215,120,0.2)");
      glow.addColorStop(1, "rgba(255,200,80,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(this.cx, this.cy, R * 4, 0, Math.PI * 2);
      ctx.fill();

      // Raios de luz girando
      ctx.lineCap = "round";
      ctx.lineWidth = 3;
      const rays = 12;
      for (let i = 0; i < rays; i++) {
        const a = now / 3000 + (i * Math.PI * 2) / rays;
        const len = R * (2.2 + 1.2 * Math.sin(now / 400 + i * 1.7));
        const ex = this.cx + Math.cos(a) * len;
        const ey = this.cy + Math.sin(a) * len;
        const g = ctx.createLinearGradient(this.cx, this.cy, ex, ey);
        g.addColorStop(0, "rgba(255,245,200,0.8)");
        g.addColorStop(1, "rgba(255,230,150,0)");
        ctx.strokeStyle = g;
        ctx.beginPath();
        ctx.moveTo(this.cx, this.cy);
        ctx.lineTo(ex, ey);
        ctx.stroke();
      }

      // Auréola
      ctx.shadowColor = "#ffd66b";
      ctx.shadowBlur = 20;
      ctx.strokeStyle = "rgba(255,230,150,0.95)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(this.cx, this.cy - R * 2.6, R * 1.8, R * 0.5, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Núcleo
      const core = ctx.createRadialGradient(this.cx, this.cy, 0, this.cx, this.cy, R);
      core.addColorStop(0, "rgba(255,255,255,1)");
      core.addColorStop(0.5, "rgba(255,240,180,0.9)");
      core.addColorStop(1, "rgba(255,210,100,0)");
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(this.cx, this.cy, R, 0, Math.PI * 2);
      ctx.fill();
    }

    // Faíscas (estrelinhas de 4 pontas)
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1.5;
    for (const s of this.sparks) {
      const t = s.life / s.maxLife;
      const a = Math.sin(Math.PI * t); // surge e some suavemente
      ctx.strokeStyle = `rgba(255,240,190,${a})`;
      ctx.beginPath();
      ctx.moveTo(s.x - s.size, s.y);
      ctx.lineTo(s.x + s.size, s.y);
      ctx.moveTo(s.x, s.y - s.size);
      ctx.lineTo(s.x, s.y + s.size);
      ctx.stroke();
    }

    ctx.restore();
  }
    // Método para desenhar a Luz Angelical Suprema
    // Método para desenhar a Luz Angelical Suprema (Plasma Orgânico)
  public drawCombined(
    ctx: CanvasRenderingContext2D,
    handA: Hand,
    handB: Hand,
    now: number,
    aspect: number,
  ): void {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;

    // 1. Ponto médio entre as mãos
    const ax = ((handA[4].x + handA[8].x) / 2) * w;
    const ay = ((handA[4].y + handA[8].y) / 2) * h;
    const bx = ((handB[4].x + handB[8].x) / 2) * w;
    const by = ((handB[4].y + handB[8].y) / 2) * h;
    
    const cx = (ax + bx) / 2;
    const cy = (ay + by) / 2;

    // 2. Tamanho
    const dist = Math.hypot(ax - bx, ay - by);
    const baseScale = (handScale(handA, aspect) + handScale(handB, aspect)) / 2;
    // Deixei um pouco maior para dar imponência
    const r = Math.max(dist * 0.7, baseScale * h * 1.5);

    // 3. Fade in/out
    this.level = Math.min(1, this.level + 0.1);

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = this.level;

    // Pulsação base
    const time = now / 1000;
    const pulse = 1 + 0.05 * Math.sin(time * 5);

    // --- CAMADA 1: O Brilho Externo (Aura) ---
    const glow = ctx.createRadialGradient(cx, cy, r * 0.5, cx, cy, r * 2.5);
    glow.addColorStop(0, "rgba(255, 220, 100, 0.4)");
    glow.addColorStop(0.5, "rgba(255, 160, 0, 0.1)");
    glow.addColorStop(1, "rgba(255, 100, 0, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 2.5 * pulse, 0, Math.PI * 2);
    ctx.fill();

    // --- CAMADA 2: O Corpo de Plasma (Textura de fumaça/fluido) ---
    // Vamos desenhar várias "bolhas" deformadas que se movem
    const numBlobs = 15;
    for (let i = 0; i < numBlobs; i++) {
      // Cada blob tem um ângulo e distância do centro que variam com o tempo
      const angle = (i / numBlobs) * Math.PI * 2 + time * 0.5;
      
      // Ruído para fazer o raio variar
      const noise = Math.sin(time * 3 + i) * Math.cos(time * 2 + i * 2);
      
      // A distância do centro do blob
      const blobDist = r * 0.4 * (1 + noise * 0.5);
      
      // O tamanho do blob
      const blobSize = r * (0.6 + 0.4 * Math.sin(time * 4 + i));
      
      const bx2 = cx + Math.cos(angle) * blobDist;
      const by2 = cy + Math.sin(angle) * blobDist;

      // Gradiente interno do blob (amarelo claro no centro, laranja nas bordas)
      const blobGrad = ctx.createRadialGradient(bx2, by2, 0, bx2, by2, blobSize);
      blobGrad.addColorStop(0, "rgba(255, 255, 180, 0.6)"); // Núcleo do plasma
      blobGrad.addColorStop(0.5, "rgba(255, 200, 50, 0.3)"); // Meio
      blobGrad.addColorStop(1, "rgba(255, 120, 0, 0)");     // Borda suave

      ctx.fillStyle = blobGrad;
      ctx.beginPath();
      // Desenhamos um círculo
      ctx.arc(bx2, by2, blobSize * pulse, 0, Math.PI * 2);
      ctx.fill();
    }

    // --- CAMADA 3: O Núcleo Sólido (Borda irregular) ---
    // Desenhamos uma forma principal com a borda ondulada
    ctx.beginPath();
    const numPoints = 64;
    for (let i = 0; i <= numPoints; i++) {
      const a = (i / numPoints) * Math.PI * 2;
      
      // Ruído complexo para a borda
      const wobble = 
        1 + 
        0.08 * Math.sin(a * 3 + time * 4) + 
        0.04 * Math.sin(a * 7 - time * 3) +
        0.02 * Math.sin(a * 11 + time * 5);

      const px = cx + Math.cos(a) * r * wobble * pulse;
      const py = cy + Math.sin(a) * r * wobble * pulse;

      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();

    // Preenchimento do núcleo (amarelo muito brilhante no centro)
    const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    coreGrad.addColorStop(0, "rgba(255, 255, 220, 0.95)");
    coreGrad.addColorStop(0.4, "rgba(255, 230, 100, 0.8)");
    coreGrad.addColorStop(0.8, "rgba(255, 180, 0, 0.4)");
    coreGrad.addColorStop(1, "rgba(255, 100, 0, 0)");
    ctx.fillStyle = coreGrad;
    ctx.fill();

    // Contorno brilhante (Efeito de raio-X na borda)
    ctx.strokeStyle = "rgba(255, 255, 200, 0.8)";
    ctx.lineWidth = 3;
    ctx.stroke();

    // --- CAMADA 4: Faíscas Estelares (Opcional, mas fica bonito) ---
    ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
    for (let i = 0; i < 5; i++) {
      const sparkAngle = time * 2 + (i * Math.PI * 2) / 5;
      const sparkDist = r * 1.3;
      const px = cx + Math.cos(sparkAngle) * sparkDist;
      const py = cy + Math.sin(sparkAngle) * sparkDist;
      
      ctx.beginPath();
      ctx.arc(px, py, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  public getCenter() {
    return { x: this.cx, y: this.cy, radius: this.r, level: this.level };
  }
}