import * as THREE from "three";
import type { Hand } from "../tracking/handTracker";
import { handScale } from "../gestures/gestures";

/**
 * WaterBubbleGL v2
 *
 * - Película de sabão iridescente (azul > ciano > menta > rosa) que escorre pela superfície
 * - Água dentro da bolha: linha d'água que balança, cáusticas e bolhinhas subindo
 * - Reflexo de "janela", brilho secundário, faísca e crescente de luz refratada
 * - Squash & stretch com mola: a bolha estica na direção do movimento e faz "gelatina"
 * - Nascimento com overshoot elástico
 * - Bolhinhas satélite: soltas em movimento, sobem sozinhas, e estouram com anel
 * - Ao desativar o gesto a bolha ESTOURA em gotículas
 */

// Câmera ortográfica em pixels com Y para baixo (igual ao Canvas)?
// Se o brilho principal aparecer embaixo em vez de em cima, troque para false.
const Y_DOWN = true;

// Quanto o quad é maior que a bolha (espaço para o halo)
const PAD = 1.4;

// Máximo de bolhinhas simultâneas
const MAX_MINI = 36;

const plane = new THREE.PlaneGeometry(2, 2);

const GLSL_COMMON = /* glsl */ `
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
      mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x),
      f.y
    );
  }

  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * noise(p);
      p = p * 2.03 + vec2(17.1, 9.2);
      a *= 0.5;
    }
    return v;
  }

  // Cores de película fina de sabão, cíclica: azul > ciano > menta > rosa > azul
  vec3 film(float t) {
    t = fract(t) * 4.0;
    vec3 c0 = vec3(0.15, 0.45, 1.00);
    vec3 c1 = vec3(0.10, 0.95, 0.95);
    vec3 c2 = vec3(0.65, 1.00, 0.80);
    vec3 c3 = vec3(1.00, 0.50, 0.90);
    vec3 c = mix(c0, c1, smoothstep(0.0, 1.0, t));
    c = mix(c, c2, smoothstep(1.0, 2.0, t));
    c = mix(c, c3, smoothstep(2.0, 3.0, t));
    c = mix(c, c0, smoothstep(3.0, 4.0, t));
    return c;
  }
`;

/* ------------------------------------------------------------------ */
/*  Bolha principal                                                    */
/* ------------------------------------------------------------------ */

const bubbleVert = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const bubbleFrag = /* glsl */ `
  uniform float uTime;
  uniform float uLevel;
  uniform float uRot;
  uniform float uAmp;
  uniform float uTilt;
  uniform float uFlipY;
  varying vec2 vUv;

  const float PAD = ${PAD.toFixed(3)};

  ${GLSL_COMMON}

  void main() {
    // Coordenadas locais do quad (a elipse de squash vira círculo aqui)
    vec2 q = (vUv - 0.5) * 2.0 * PAD;
    float r = length(q);
    float ang = atan(q.y, q.x);

    // Borda ondulada (tensão superficial), mais agitada quando a bolha se move
    float wob = uAmp * (0.50 * sin(ang * 3.0 + uTime * 2.1)
                      + 0.35 * sin(ang * 5.0 - uTime * 2.9)
                      + 0.25 * sin(ang * 7.0 + uTime * 3.7))
              + 0.006 * sin(ang * 11.0 + uTime * 4.3);
    float R = 1.0 + wob;
    float rn = r / R;
    if (rn > 1.38) discard;

    // Coordenadas de tela (luz sempre vem de cima à esquerda, mesmo com a bolha girada)
    float cr = cos(uRot);
    float sr = sin(uRot);
    vec2 w = vec2(cr * q.x - sr * q.y, sr * q.x + cr * q.y);
    vec2 s = vec2(w.x, w.y * uFlipY) / R;

    float z = sqrt(max(1.0 - rn * rn, 0.0));
    float fres = pow(1.0 - z, 2.2);
    float inside = 1.0 - smoothstep(0.965, 1.0, rn);

    // Película iridescente que escorre devagar
    float flow = fbm(s * 2.0 + vec2(uTime * 0.10, -uTime * 0.07));
    float t = (1.0 - z) * 1.3 + flow * 0.9 + uTime * 0.04 + s.y * 0.12;
    vec3 fc = film(t);

    // Corpo quase transparente, borda forte
    vec3 col = fc * (0.05 + fres * 1.35);

    // ---------- Água dentro da bolha ----------
    float wl = -0.10
             + uTilt * s.x * 0.4
             + 0.030 * sin(s.x * 5.0 + uTime * 2.4)
             + 0.018 * sin(s.x * 9.0 - uTime * 3.3);
    float surf = s.y - wl;                       // > 0 acima da linha d'água
    float inW = 1.0 - smoothstep(-0.015, 0.015, surf);

    // Cáusticas
    vec2 cp = s * 2.6;
    float c1 = sin(cp.x * 2.0 + sin(cp.y * 2.0 + uTime * 1.3) + uTime * 0.9);
    float c2 = sin(cp.y * 2.3 + sin(cp.x * 2.1 - uTime * 1.1) - uTime * 0.7);
    float caust = pow(1.0 - abs(c1 * c2), 5.0);

    vec3 water = vec3(0.03, 0.30, 0.55) * (0.5 + 0.5 * z);
    water += vec3(0.30, 0.90, 1.00) * caust * 0.30 * (0.4 + 0.6 * z);
    // Luz focada no fundo (efeito de lente)
    water += vec3(0.20, 0.80, 1.00) * pow(max(-s.y, 0.0), 2.0) * 0.5 * z;
    col += water * inW;

    // Linha brilhante da superfície (menisco)
    col += vec3(0.75, 1.0, 1.0) * exp(-abs(surf) * 60.0) * (0.35 + 0.65 * z) * 0.9;

    // Bolhinhas subindo dentro da água
    vec2 bp = vec2(s.x * 3.5, s.y * 3.5 - uTime * 0.7);
    vec2 id = floor(bp);
    vec2 g = fract(bp) - 0.5;
    float h0 = hash21(id);
    vec2 off = vec2(sin(uTime * 1.4 + h0 * 40.0) * 0.12, 0.0)
             + (vec2(hash21(id + 7.3), hash21(id + 3.1)) - 0.5) * 0.2;
    float rad = 0.05 + 0.08 * hash21(id + 11.7);
    float bd = length(g - off);
    float ring = (1.0 - smoothstep(rad - 0.02, rad, bd))
               - (1.0 - smoothstep(rad - 0.05, rad - 0.025, bd));
    float glint = 1.0 - smoothstep(0.0, rad * 0.45, length(g - off - vec2(-0.3, 0.3) * rad));
    float has = step(0.55, h0);
    float below = 1.0 - smoothstep(-0.1, 0.0, surf);
    col += vec3(0.8, 1.0, 1.0) * (ring * 0.7 + glint * 0.9) * has * inW * below * 0.8;

    // ---------- Reflexos ----------
    // Janela de luz (retângulo arredondado, tangente à curva)
    vec2 hp = s - vec2(-0.40, 0.46);
    vec2 hq = vec2(hp.x * 0.82 + hp.y * 0.57, -hp.x * 0.57 + hp.y * 0.82);
    vec2 d2 = abs(hq) - vec2(0.13, 0.055);
    float rb = length(max(d2, 0.0)) + min(max(d2.x, d2.y), 0.0) - 0.045;
    float win = 1.0 - smoothstep(-0.01, 0.025, rb);
    col += vec3(1.0) * win * 0.95 * (0.4 + 0.6 * z);

    // Pontinho de brilho secundário
    float dot2 = 1.0 - smoothstep(0.0, 0.05, length(s - vec2(-0.66, 0.16)));
    col += vec3(1.0) * dot2 * 0.8;

    // Faísca em cruz que pulsa
    float spark = exp(-abs(hp.x) * 38.0) * exp(-abs(hp.y) * 7.0)
                + exp(-abs(hp.y) * 38.0) * exp(-abs(hp.x) * 7.0);
    col += vec3(1.0) * spark * (0.5 + 0.5 * sin(uTime * 2.2)) * 0.5;

    // Crescente colorido embaixo à direita (luz refratada atravessando)
    float cres = pow(max(dot(normalize(s + vec2(1e-4)), normalize(vec2(0.62, -0.78))), 0.0), 4.0)
               * pow(1.0 - z, 1.4);
    col += film(t + 0.45) * cres * 1.1;

    // ---------- Acabamento ----------
    col *= inside;
    float outside = smoothstep(0.96, 1.0, rn);
    col += fc * exp(-max(rn - 1.0, 0.0) * 9.0) * 0.20 * outside;   // halo suave
    col *= uLevel;

    // Blending aditivo: rgb já é a contribuição final
    gl_FragColor = vec4(col, 1.0);
  }
`;

/* ------------------------------------------------------------------ */
/*  Bolhinhas satélite (Points)                                        */
/* ------------------------------------------------------------------ */

const miniVert = /* glsl */ `
  attribute float aSize;
  attribute float aLife;
  attribute float aSeed;
  uniform float uPx;
  varying float vLife;
  varying float vSeed;
  void main() {
    vLife = aLife;
    vSeed = aSeed;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uPx;
  }
`;

const miniFrag = /* glsl */ `
  uniform float uTime;
  varying float vLife;
  varying float vSeed;

  ${GLSL_COMMON}

  void main() {
    vec2 p = (gl_PointCoord - 0.5) * 2.0;
    p.y = -p.y;
    float r = length(p);
    if (r > 1.0) discard;

    float pop = smoothstep(0.80, 1.0, vLife);      // fase de estouro
    float alive = 1.0 - pop;
    float born = smoothstep(0.0, 0.08, vLife);

    float z = sqrt(max(1.0 - r * r, 0.0));
    float fres = pow(1.0 - z, 1.8);
    vec3 c = film((1.0 - z) * 1.2 + vSeed + uTime * 0.15) * (0.06 + fres * 1.5) * alive;
    c += vec3(1.0) * (1.0 - smoothstep(0.0, 0.3, length(p - vec2(-0.38, 0.40)))) * 0.9 * alive;

    // Anel do estouro
    float ringR = mix(0.5, 0.97, pop);
    float ring = exp(-pow((r - ringR) * 12.0, 2.0)) * sin(pop * 3.14159);
    c += vec3(0.7, 1.0, 1.0) * ring * 1.4;

    gl_FragColor = vec4(c * born, 1.0);
  }
`;

/* ------------------------------------------------------------------ */
/*  Classe                                                             */
/* ------------------------------------------------------------------ */

export class WaterBubbleGL {
  private level = 0;
  private cx = 0;
  private cy = 0;
  private r = 0;

  // nascimento elástico
  private grow = 0;
  private growV = 0;

  // velocidade suavizada e mola de deformação (squash & stretch)
  private hasLast = false;
  private svx = 0;
  private svy = 0;
  private dx = 0;
  private dy = 0;
  private dvx = 0;
  private dvy = 0;

  private lastNow = 0;
  private wasActive = false;
  private unit = 1;
  private idleTimer = 0.4;
  private trailTimer = 0;

  private readonly scene: THREE.Scene;
  private readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;

  // bolhinhas
  private readonly points: THREE.Points;
  private readonly miniMaterial: THREE.ShaderMaterial;
  private readonly miniGeo = new THREE.BufferGeometry();
  private readonly pPos = new Float32Array(MAX_MINI * 3);
  private readonly pSize = new Float32Array(MAX_MINI);
  private readonly pLife = new Float32Array(MAX_MINI).fill(-1);
  private readonly pSeed = new Float32Array(MAX_MINI);
  private readonly pVx = new Float32Array(MAX_MINI);
  private readonly pVy = new Float32Array(MAX_MINI);
  private readonly pAge = new Float32Array(MAX_MINI);
  private readonly pTtl = new Float32Array(MAX_MINI);
  private pCursor = 0;

  /**
   * @param pixelRatio mesmo pixelRatio do renderer (para as bolhinhas terem o tamanho certo).
   */
  constructor(scene: THREE.Scene, pixelRatio: number = Math.min(window.devicePixelRatio || 1, 2)) {
    this.scene = scene;

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uLevel: { value: 0 },
        uRot: { value: 0 },
        uAmp: { value: 0.012 },
        uTilt: { value: 0 },
        uFlipY: { value: Y_DOWN ? -1 : 1 },
      },
      vertexShader: bubbleVert,
      fragmentShader: bubbleFrag,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(plane, this.material);
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);

    // Bolhinhas
    for (let i = 0; i < MAX_MINI; i++) {
      this.pPos[i * 3] = -9999;
      this.pPos[i * 3 + 1] = -9999;
    }
    const posAttr = new THREE.BufferAttribute(this.pPos, 3).setUsage(THREE.DynamicDrawUsage);
    const sizeAttr = new THREE.BufferAttribute(this.pSize, 1).setUsage(THREE.DynamicDrawUsage);
    const lifeAttr = new THREE.BufferAttribute(this.pLife, 1).setUsage(THREE.DynamicDrawUsage);
    const seedAttr = new THREE.BufferAttribute(this.pSeed, 1);
    this.miniGeo.setAttribute("position", posAttr);
    this.miniGeo.setAttribute("aSize", sizeAttr);
    this.miniGeo.setAttribute("aLife", lifeAttr);
    this.miniGeo.setAttribute("aSeed", seedAttr);

    this.miniMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uPx: { value: pixelRatio },
      },
      vertexShader: miniVert,
      fragmentShader: miniFrag,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });

    this.points = new THREE.Points(this.miniGeo, this.miniMaterial);
    this.points.frustumCulled = false;
    this.points.visible = false;
    scene.add(this.points);
  }

  update(hand: Hand | null, active: boolean, now: number, aspect: number, w: number, h: number): void {
    const dt = this.lastNow ? Math.min(Math.max((now - this.lastNow) / 1000, 0.001), 0.033) : 0.016;
    this.lastNow = now;
    this.unit = Math.max(h, 1) / 800;

    // Nascimento: reinicia a mola e o rastreio de velocidade
    if (active && hand && this.level < 0.02) {
      this.grow = 0;
      this.growV = 0;
      this.hasLast = false;
      this.svx = this.svy = 0;
      this.dx = this.dy = this.dvx = this.dvy = 0;
    }

    // Estouro ao soltar o gesto
    if (this.wasActive && !active && this.level > 0.3) this.pop();
    this.wasActive = active;

    // Posição / tamanho (ponta do indicador, landmark 8)
    let rawVx = 0;
    let rawVy = 0;
    if (hand) {
      const tx = hand[8].x * w;
      const ty = hand[8].y * h;
      const tr = handScale(hand, aspect) * h * 0.4;

      if (!this.hasLast) {
        this.cx = tx;
        this.cy = ty;
        this.r = tr;
        this.hasLast = true;
      } else {
        const a = 1 - Math.exp(-dt * 30);
        const px = this.cx;
        const py = this.cy;
        this.cx += (tx - this.cx) * a;
        this.cy += (ty - this.cy) * a;
        this.r += (tr - this.r) * a;
        rawVx = (this.cx - px) / dt;
        rawVy = (this.cy - py) / dt;
      }
    }

    const sa = 1 - Math.exp(-dt * 16);
    this.svx += (rawVx - this.svx) * sa;
    this.svy += (rawVy - this.svy) * sa;

    // Mola de deformação: estica na direção do movimento e balança (gelatina)
    const maxV = 2400 * this.unit;
    let tdx = this.svx / maxV;
    let tdy = this.svy / maxV;
    const tm = Math.hypot(tdx, tdy);
    if (tm > 1) {
      tdx /= tm;
      tdy /= tm;
    }
    const K = 170;
    const C = 10;
    this.dvx += ((tdx - this.dx) * K - this.dvx * C) * dt;
    this.dvy += ((tdy - this.dy) * K - this.dvy * C) * dt;
    this.dx += this.dvx * dt;
    this.dy += this.dvy * dt;

    const amt = Math.min(Math.hypot(this.dx, this.dy) * 0.38, 0.34);
    const ang = Math.atan2(this.dy, this.dx);

    // Nível (opacidade) e mola de crescimento com overshoot
    this.level = active ? Math.min(1, this.level + dt * 6) : Math.max(0, this.level - dt * 14);
    this.growV += ((1 - this.grow) * 140 - this.growV * 11) * dt;
    this.grow += this.growV * dt;

    const visible = this.level > 0.01;
    this.mesh.visible = visible;

    if (visible) {
      const breathe = 1 + 0.035 * Math.sin(now / 260) + 0.015 * Math.sin(now / 130 + 1.3);
      const expand = active ? 1 : 1 + (1 - this.level) * 0.2; // incha um pouco antes de estourar
      const R = Math.max(this.r * Math.max(this.grow, 0) * breathe * expand, 0.5);
      const S = R * PAD;

      this.mesh.position.set(this.cx, this.cy, 0);
      this.mesh.rotation.z = ang;
      this.mesh.scale.set(S * (1 + amt), S * (1 - amt * 0.55), 1);

      const u = this.material.uniforms;
      u.uTime.value = now / 1000;
      u.uLevel.value = this.level;
      u.uRot.value = ang;
      u.uAmp.value = 0.012 + amt * 0.1;
      u.uTilt.value = Math.max(-0.8, Math.min(0.8, -this.dx * 1.1));

      if (active) this.emitMini(dt, R);
    }

    this.stepMini(dt, now);
  }

  /* -------------------------- bolhinhas --------------------------- */

  private emitMini(dt: number, R: number): void {
    const u = this.unit;

    // Bolhinhas que sobem sozinhas pela parte de cima
    this.idleTimer -= dt;
    if (this.idleTimer <= 0) {
      this.idleTimer = 0.5 + Math.random() * 0.7;
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.6; // y para baixo: -90° é "cima"
      this.spawn(
        this.cx + Math.cos(a) * R * 0.95,
        this.cy + Math.sin(a) * R * 0.95,
        (Math.random() - 0.5) * 30 * u,
        -(40 + Math.random() * 50) * u,
        this.miniSize(R),
        1.4 + Math.random() * 1.2,
      );
    }

    // Rastro de bolhinhas quando a bolha se move rápido
    this.trailTimer -= dt;
    const speed = Math.hypot(this.svx, this.svy);
    if (speed > 350 * u && this.trailTimer <= 0) {
      this.trailTimer = 0.06 + Math.random() * 0.08;
      const dirx = -this.svx / speed;
      const diry = -this.svy / speed;
      const jit = (Math.random() - 0.5) * 0.9;
      this.spawn(
        this.cx + (dirx - diry * jit) * R * 0.9,
        this.cy + (diry + dirx * jit) * R * 0.9,
        dirx * 60 * u + (Math.random() - 0.5) * 40 * u,
        diry * 60 * u + (Math.random() - 0.5) * 40 * u,
        this.miniSize(R),
        0.9 + Math.random() * 0.9,
      );
    }
  }

  private miniSize(R: number): number {
    return Math.min(48, Math.max(6, R * (0.09 + 0.17 * Math.random())));
  }

  private pop(): void {
    const n = 12;
    const u = this.unit;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
      const dirx = Math.cos(a);
      const diry = Math.sin(a);
      const sp = (140 + Math.random() * 200) * u;
      this.spawn(
        this.cx + dirx * this.r * 0.9,
        this.cy + diry * this.r * 0.9,
        dirx * sp,
        diry * sp - 40 * u,
        Math.min(48, Math.max(6, this.r * (0.07 + 0.16 * Math.random()))),
        0.45 + Math.random() * 0.6,
      );
    }
  }

  private spawn(x: number, y: number, vx: number, vy: number, size: number, ttl: number): void {
    let idx = -1;
    for (let k = 0; k < MAX_MINI; k++) {
      const i = (this.pCursor + k) % MAX_MINI;
      if (this.pTtl[i] <= 0) {
        idx = i;
        break;
      }
    }
    if (idx < 0) idx = this.pCursor; // pool cheio: reaproveita o mais antigo
    this.pCursor = (idx + 1) % MAX_MINI;

    this.pPos[idx * 3] = x;
    this.pPos[idx * 3 + 1] = y;
    this.pPos[idx * 3 + 2] = 0;
    this.pVx[idx] = vx;
    this.pVy[idx] = vy;
    this.pSize[idx] = size;
    this.pAge[idx] = 0;
    this.pTtl[idx] = ttl;
    this.pLife[idx] = 0;
    this.pSeed[idx] = Math.random();
    (this.miniGeo.getAttribute("aSeed") as THREE.BufferAttribute).needsUpdate = true;
  }

  private stepMini(dt: number, now: number): void {
    const u = this.unit;
    let any = false;

    for (let i = 0; i < MAX_MINI; i++) {
      if (this.pTtl[i] <= 0) continue;

      this.pAge[i] += dt;
      if (this.pAge[i] >= this.pTtl[i]) {
        this.pTtl[i] = 0;
        this.pSize[i] = 0;
        this.pLife[i] = -1;
        this.pPos[i * 3] = -9999;
        this.pPos[i * 3 + 1] = -9999;
        continue;
      }
      any = true;

      // flutuação: sobe (y negativo), balança de leve e perde velocidade
      this.pVy[i] -= 90 * u * dt;
      this.pVx[i] += Math.sin(now / 300 + this.pSeed[i] * 20) * 50 * u * dt;
      const drag = Math.exp(-dt * 1.2);
      this.pVx[i] *= drag;
      this.pVy[i] *= drag;

      this.pPos[i * 3] += this.pVx[i] * dt;
      this.pPos[i * 3 + 1] += this.pVy[i] * dt;
      this.pLife[i] = this.pAge[i] / this.pTtl[i];
    }

    this.points.visible = any;
    this.miniMaterial.uniforms.uTime.value = now / 1000;

    (this.miniGeo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (this.miniGeo.getAttribute("aSize") as THREE.BufferAttribute).needsUpdate = true;
    (this.miniGeo.getAttribute("aLife") as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.scene.remove(this.points);
    this.material.dispose();
    this.miniMaterial.dispose();
    this.miniGeo.dispose();
  }
}