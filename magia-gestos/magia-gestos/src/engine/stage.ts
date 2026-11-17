import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

/**
 * Cena Three.js com câmera ortográfica em coordenadas de pixel (y para baixo),
 * idêntica ao sistema do Canvas 2D: (0,0) = canto superior esquerdo do vídeo.
 */
export class Stage {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.OrthographicCamera;
  readonly bloom: UnrealBloomPass;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;

  constructor(canvas: HTMLCanvasElement, width: number, height: number) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height, false); // false = não mexe no CSS do canvas
    this.renderer.setClearColor(0x000000, 1);

    this.camera = new THREE.OrthographicCamera(0, width, 0, height, -1000, 1000);

    this.composer = new EffectComposer(this.renderer);
    this.composer.setSize(width, height);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    // strength = intensidade, radius = espalhamento, threshold = a partir de qual brilho vaza luz
    this.bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 0.2, 0.6, 0.0);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  render(): void {
    this.composer.render();
  }
}