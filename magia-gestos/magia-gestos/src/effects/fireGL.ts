import * as THREE from "three";
import type { Hand } from "../tracking/handTracker";
import { handScale } from "../gestures/gestures";

const MAX = 6000;
const EMIT_PER_FRAME = 10;
const KNUCKLES = [5, 9, 13, 17]; // base dos dedos = topo do punho

const vertexShader = /* glsl */ `
  attribute float aSize;
  attribute float aAge;
  varying float vAge;
  void main() {
    vAge = aAge;
    gl_PointSize = aSize;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  varying float vAge;
  void main() {
    // Sprite redondo e macio
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float soft = smoothstep(1.0, 0.0, d);
    soft *= soft;

    // Cor pela idade: branco-amarelo -> laranja -> vermelho escuro
    vec3 hot  = vec3(1.0, 0.95, 0.6);
    vec3 mid  = vec3(1.0, 0.45, 0.08);
    vec3 cool = vec3(0.6, 0.08, 0.02);
    vec3 col = vAge < 0.35
      ? mix(hot, mid, vAge / 0.35)
      : mix(mid, cool, (vAge - 0.35) / 0.65);

    float alpha = soft * (1.0 - vAge);
    gl_FragColor = vec4(col * 1.5, alpha);
  }
`;

export class FireGL {
  private readonly pos = new Float32Array(MAX * 3);
  private readonly size = new Float32Array(MAX);
  private readonly age = new Float32Array(MAX);
  private readonly vel = new Float32Array(MAX * 2);
  private readonly life = new Float32Array(MAX).fill(1);
  private readonly maxLife = new Float32Array(MAX).fill(1); // life >= maxLife = partícula morta
  private readonly baseSize = new Float32Array(MAX);
  private readonly aPos: THREE.BufferAttribute;
  private readonly aSize: THREE.BufferAttribute;
  private readonly aAge: THREE.BufferAttribute;
  private next = 0;
  private cx = 0;
  private cy = 0;
  private scale = 0;

  constructor(scene: THREE.Scene) {
    const geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3);
    this.aSize = new THREE.BufferAttribute(this.size, 1);
    this.aAge = new THREE.BufferAttribute(this.age, 1);
    geo.setAttribute("position", this.aPos);
    geo.setAttribute("aSize", this.aSize);
    geo.setAttribute("aAge", this.aAge);

    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const points = new THREE.Points(geo, material);
    points.frustumCulled = false;
    scene.add(points);
  }

  update(hand: Hand | null, active: boolean, aspect: number, w: number, h: number): void {
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

    // Emissão (só enquanto o punho está fechado)
    if (active && this.scale > 0) {
      for (let n = 0; n < EMIT_PER_FRAME; n++) {
        const i = this.next;
        this.next = (this.next + 1) % MAX;
        this.pos[i * 3] = this.cx + (Math.random() - 0.5) * this.scale * 0.9;
        this.pos[i * 3 + 1] = this.cy + (Math.random() - 0.5) * this.scale * 0.3;
        this.pos[i * 3 + 2] = 0;
        this.vel[i * 2] = (Math.random() - 0.5) * 1.2;
        this.vel[i * 2 + 1] = -(1.5 + Math.random() * 2.5) * (this.scale / 80);
        this.life[i] = 0;
        this.maxLife[i] = 28 + Math.random() * 30;
        this.baseSize[i] = this.scale * (0.4 + Math.random() * 0.5);
      }
    }

    // Simulação
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] >= this.maxLife[i]) {
        this.size[i] = 0;
        continue;
      }
      this.life[i]++;
      const t = this.life[i] / this.maxLife[i];
      this.pos[i * 3] += this.vel[i * 2] + (Math.random() - 0.5) * 1.2;
      this.pos[i * 3 + 1] += this.vel[i * 2 + 1];
      this.vel[i * 2 + 1] *= 0.985;
      this.age[i] = t;
      this.size[i] = this.baseSize[i] * (1 - t * 0.7);
    }

    this.aPos.needsUpdate = true;
    this.aSize.needsUpdate = true;
    this.aAge.needsUpdate = true;
  }
}