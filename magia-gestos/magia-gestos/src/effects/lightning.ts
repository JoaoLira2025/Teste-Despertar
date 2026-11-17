type P = { x: number; y: number };

/** Gera uma linha em zigue-zague entre a e b (muda a cada chamada = efeito de faísca). */
function boltPoints(a: P, b: P, jitter: number): P[] {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const n = Math.max(6, Math.floor(len / 18));
  const nx = -(b.y - a.y) / len; // vetor perpendicular
  const ny = (b.x - a.x) / len;

  const pts: P[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const taper = Math.sin(Math.PI * t); // sem deslocamento nas pontas
    const off = (Math.random() - 0.5) * 2 * jitter * taper;
    pts.push({
      x: a.x + (b.x - a.x) * t + nx * off,
      y: a.y + (b.y - a.y) * t + ny * off,
    });
  }
  return pts;
}

function stroke(ctx: CanvasRenderingContext2D, pts: P[]): void {
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.stroke();
}

export function drawLightning(ctx: CanvasRenderingContext2D, a: P, b: P): void {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 12) return;

  const jitter = Math.min(30, len * 0.15);
  const main = boltPoints(a, b, jitter);

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.shadowColor = "#6aa8ff";
  ctx.shadowBlur = 30;

  // Três camadas: brilho largo, corpo, núcleo branco
  ctx.strokeStyle = "rgba(80,140,255,0.35)";
  ctx.lineWidth = 12;
  stroke(ctx, main);

  ctx.strokeStyle = "rgba(150,200,255,0.8)";
  ctx.lineWidth = 5;
  stroke(ctx, main);

  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  stroke(ctx, main);

  // Um ramo aleatório saindo do meio
  if (Math.random() < 0.7) {
    const from = main[Math.floor(main.length * (0.3 + Math.random() * 0.4))];
    const ang = Math.atan2(b.y - a.y, b.x - a.x) + (Math.random() - 0.5) * 2;
    const bl = len * (0.2 + Math.random() * 0.25);
    const branch = boltPoints(from, { x: from.x + Math.cos(ang) * bl, y: from.y + Math.sin(ang) * bl }, jitter * 0.6);
    ctx.strokeStyle = "rgba(190,220,255,0.9)";
    ctx.lineWidth = 2;
    stroke(ctx, branch);
  }

  ctx.restore();
}