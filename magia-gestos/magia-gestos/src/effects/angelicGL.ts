import * as THREE from "three";
import type { Hand } from "../tracking/handTracker";
import { handScale } from "../gestures/gestures";

const ORB_UV = 0.3; // raio do orbe dentro do quadrado do shader (0..1); o resto é aura/raios
const GAIN = 1.0;   // intensidade geral do brilho (desça se estiver estourando no bloom)

const plane = new THREE.PlaneGeometry(2, 2);

/* ----------------------------- Shader do orbe ----------------------------- */

const orbVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const orbFragment = /* glsl */ `
  uniform float uTime;
  uniform float uLevel;
  uniform float uSupreme;
  uniform float uGain;
  varying vec2 vUv;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * noise(p);
      p = p * 2.0 + vec2(17.0, 5.0);
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec2 p = (vUv - 0.5) * 2.0;   // -1..1; p.y > 0 = para baixo na tela
    float d = length(p);
    float ang = atan(p.y, p.x);
    float t = uTime;
    float R = ${ORB_UV.toFixed(2)};

    // Borda orgânica: o raio varia com o ângulo e o tempo
    float wob = 1.0
      + 0.06 * sin(ang * 3.0 + t * 4.0)
      + 0.03 * sin(ang * 7.0 - t * 3.0)
      + 0.015 * sin(ang * 11.0 + t * 5.0);
    float Rw = R * wob;

    // Esfera
    vec2 q = p / Rw;
    float r2 = min(dot(q, q), 1.0);
    float z = sqrt(1.0 - r2);

    // Plasma: ruído com distorção (domain warping), girando devagar
    float cs = cos(t * 0.3);
    float sn = sin(t * 0.3);
    vec2 w = mat2(cs, -sn, sn, cs) * q * 1.8;
    float n1 = fbm(w + vec2(t * 0.3, -t * 0.2));
    float n2 = fbm(w * 1.5 + n1 * 2.0 - vec2(t * 0.25, -t * 0.15));

    vec3 orange = vec3(1.0, 0.45, 0.08);
    vec3 gold   = vec3(1.0, 0.78, 0.28);
    vec3 white  = vec3(1.0, 0.97, 0.85);
    float core = pow(z, 1.6);
    vec3 col = mix(orange, gold, n2);
    col = mix(col, white, clamp(core * 0.75 + n1 * 0.15, 0.0, 1.0));
    col += vec3(1.0, 0.8, 0.4) * pow(1.0 - z, 2.5) * 0.7; // brilho na borda da esfera

    float inside = 1.0 - smoothstep(Rw * 0.94, Rw, d);

    // Aura suave em volta
    float outside = max(d - Rw, 0.0) / (1.0 - R);
    float aura = pow(clamp(1.0 - outside, 0.0, 1.0), 3.0) * 0.55 * (1.0 - inside);

    // Raios de luz girando, com comprimento variável
    float rayCount = mix(12.0, 20.0, uSupreme);
    float rays = pow(max(sin(ang * rayCount + t * 0.6), 0.0), 6.0);
    float lenMod = 0.55 + 0.45 * sin(ang * 5.0 - t * 1.3);
    float rayLen = Rw + (1.0 - Rw) * (0.5 + 0.5 * lenMod);
    float rayMask = rays * (1.0 - smoothstep(Rw, rayLen, d)) * smoothstep(Rw * 0.9, Rw * 1.1, d);

    // Auréola acima do orbe
    vec2 e = (p - vec2(0.0, -0.72)) / vec2(0.40, 0.085);
    float ed = abs(length(e) - 1.0);
    float halo = (1.0 - smoothstep(0.0, 0.14, ed)) + (1.0 - smoothstep(0.0, 0.8, ed)) * 0.12;

    // Anel tracejado girando (só na luz suprema)
    float ringD = abs(d - Rw * 1.55);
    float dash = step(0.5, fract(ang / 6.2831853 * 24.0 + t * 0.15));
    float ring = (1.0 - smoothstep(0.0, 0.012, ringD)) * dash * uSupreme;

    vec3 rgb = col * (1.2 + core) * inside;
    rgb += vec3(1.0, 0.82, 0.4) * (aura + rayMask * 0.9);
    rgb += vec3(1.0, 0.9, 0.55) * (halo * 1.4 + ring * 1.2);
    rgb *= mix(1.0, 1.35, uSupreme) * uGain;

    gl_FragColor = vec4(rgb, uLevel);
  }
`;

function makeOrbMaterial(supreme: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uLevel: { value: 0 },
      uSupreme: { value: supreme },
      uGain: { value: GAIN },
    },
    vertexShader: orbVertex,
    fragmentShader: orbFragment,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide, // a câmera tem o eixo Y invertido
  });
}

/* ------------------------- Faíscas (estrelas de 4 pontas) ------------------------- */

const MAX_SPARKS = 600;

const sparkVertex = /* glsl */ `
  attribute float aSize;
  attribute float aAge;
  varying float vAge;
  void main() {
    vAge = aAge;
    gl_PointSize = aSize;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const sparkFragment = /* glsl */ `
  varying float vAge;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float arm = max(
      exp(-abs(c.x) * 60.0 - abs(c.y) * 5.0),
      exp(-abs(c.y) * 60.0 - abs(c.x) * 5.0)
    );
    float core = exp(-length(c) * 14.0);
    float a = (arm + core) * sin(3.14159265 * vAge); // surge e some suavemente
    gl_FragColor = vec4(vec3(1.0, 0.93, 0.68) * 1.3, a);
  }
`;

class SparkSystem {
  private readonly pos = new Float32Array(MAX_SPARKS * 3);
  private readonly size = new Float32Array(MAX_SPARKS);
  private readonly age = new Float32Array(MAX_SPARKS);
  private readonly vel = new Float32Array(MAX_SPARKS * 2);
  private readonly life = new Float32Array(MAX_SPARKS).fill(1);
  private readonly maxLife = new Float32Array(MAX_SPARKS).fill(1); // life >= maxLife = morta
  private readonly baseSize = new Float32Array(MAX_SPARKS);
  private readonly aPos: THREE.BufferAttribute;
  private readonly aSize: THREE.BufferAttribute;
  private readonly aAge: THREE.BufferAttribute;
  private next = 0;

  constructor(scene: THREE.Scene) {
    const geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3);
    this.aSize = new THREE.BufferAttribute(this.size, 1);
    this.aAge = new THREE.BufferAttribute(this.age, 1);
    geo.setAttribute("position", this.aPos);
    geo.setAttribute("aSize", this.aSize);
    geo.setAttribute("aAge", this.aAge);

    const material = new THREE.ShaderMaterial({
      vertexShader: sparkVertex,
      fragmentShader: sparkFragment,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geo, material);
    points.frustumCulled = false;
    scene.add(points);
  }

  emit(x: number, y: number, vx: number, vy: number, maxLife: number, size: number): void {
    const i = this.next;
    this.next = (this.next + 1) % MAX_SPARKS;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = 0;
    this.vel[i * 2] = vx;
    this.vel[i * 2 + 1] = vy;
    this.life[i] = 0;
    this.maxLife[i] = maxLife;
    this.baseSize[i] = size;
  }

  update(): void {
    for (let i = 0; i < MAX_SPARKS; i++) {
      if (this.life[i] >= this.maxLife[i]) {
        this.size[i] = 0;
        continue;
      }
      this.life[i]++;
      this.pos[i * 3] += this.vel[i * 2];
      this.pos[i * 3 + 1] += this.vel[i * 2 + 1];
      this.age[i] = this.life[i] / this.maxLife[i];
      this.size[i] = this.baseSize[i];
    }
    this.aPos.needsUpdate = true;
    this.aSize.needsUpdate = true;
    this.aAge.needsUpdate = true;
  }
}

/* ------------------------------ Orbe da pinça ------------------------------ */

export class AngelicGL {
  private level = 0;
  private cx = 0;
  private cy = 0;
  private r = 0;
  private readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private readonly sparks: SparkSystem;

  constructor(scene: THREE.Scene) {
    this.material = makeOrbMaterial(0);
    this.mesh = new THREE.Mesh(plane, this.material);
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.sparks = new SparkSystem(scene);
  }

  update(hand: Hand | null, active: boolean, now: number, aspect: number, w: number, h: number): void {
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
        const a = Math.random() * Math.PI * 2;
        const dist = this.r * (1 + Math.random() * 2.5);
        this.sparks.emit(
          this.cx + Math.cos(a) * dist,
          this.cy + Math.sin(a) * dist,
          (Math.random() - 0.5) * 0.6,
          -(0.5 + Math.random() * 1.2) * (this.r / 30),
          40 + Math.random() * 30,
          10 + Math.random() * 14,
        );
      }
    }
    this.sparks.update();

    this.mesh.visible = this.level > 0.01;
    if (!this.mesh.visible) return;

    const R = this.r * this.level * (1 + 0.08 * Math.sin(now / 200));
    const half = Math.max(R, 1) / ORB_UV;
    this.mesh.position.set(this.cx, this.cy, 0);
    this.mesh.scale.set(half, half, 1);
    this.material.uniforms.uTime.value = now / 1000;
    this.material.uniforms.uLevel.value = this.level;
  }

  /** Mesma interface do efeito 2D: usado no main.ts para detectar a fusão das duas pinças. */
  getCenter(): { x: number; y: number; radius: number; level: number } {
    return { x: this.cx, y: this.cy, radius: this.r, level: this.level };
  }
}

/* ---------------------------- Luz Angelical Suprema ---------------------------- */

export class SuperAngelicGL {
  private level = 0;
  private cx = 0;
  private cy = 0;
  private r = 0;
  private readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private readonly sparks: SparkSystem;

  constructor(scene: THREE.Scene) {
    this.material = makeOrbMaterial(1);
    this.mesh = new THREE.Mesh(plane, this.material);
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.sparks = new SparkSystem(scene);
  }

  update(
    handA: Hand | null,
    handB: Hand | null,
    active: boolean,
    now: number,
    aspect: number,
    w: number,
    h: number,
  ): void {
    if (handA && handB) {
      const ax = ((handA[4].x + handA[8].x) / 2) * w;
      const ay = ((handA[4].y + handA[8].y) / 2) * h;
      const bx = ((handB[4].x + handB[8].x) / 2) * w;
      const by = ((handB[4].y + handB[8].y) / 2) * h;
      const tx = (ax + bx) / 2;
      const ty = (ay + by) / 2;
      const dist = Math.hypot(ax - bx, ay - by);
      const base = (handScale(handA, aspect) + handScale(handB, aspect)) / 2;
      const tr = Math.max(dist * 0.45, base * h * 1.0);

      if (this.level === 0) {
        this.cx = tx; this.cy = ty; this.r = tr;
      } else {
        this.cx += (tx - this.cx) * 0.4;
        this.cy += (ty - this.cy) * 0.4;
        this.r += (tr - this.r) * 0.3;
      }
    }

    this.level = active ? Math.min(1, this.level + 0.1) : Math.max(0, this.level - 0.06);

    // Faíscas orbitando em volta do orbe
    if (active && this.level > 0.3) {
      for (let i = 0; i < 3; i++) {
        const a = Math.random() * Math.PI * 2;
        const dist = this.r * (1.2 + Math.random() * 1.3);
        const speed = this.r / 40;
        this.sparks.emit(
          this.cx + Math.cos(a) * dist,
          this.cy + Math.sin(a) * dist,
          -Math.sin(a) * speed,
          Math.cos(a) * speed - Math.random() * speed,
          50 + Math.random() * 40,
          12 + Math.random() * 16,
        );
      }
    }
    this.sparks.update();

    this.mesh.visible = this.level > 0.01;
    if (!this.mesh.visible) return;

    const R = this.r * this.level * (1 + 0.05 * Math.sin(now / 200));
    const half = Math.max(R, 1) / ORB_UV;
    this.mesh.position.set(this.cx, this.cy, 0);
    this.mesh.scale.set(half, half, 1);
    this.material.uniforms.uTime.value = now / 1000;
    this.material.uniforms.uLevel.value = this.level;
  }
}