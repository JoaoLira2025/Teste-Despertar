import {
  FilesetResolver,
  HandLandmarker,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";

export type Hand = NormalizedLandmark[];

const WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

export class HandTracker {
  private landmarker!: HandLandmarker;
  private lastVideoTime = -1;
  private lastHands: Hand[] = [];

  async init(): Promise<void> {
    const vision = await FilesetResolver.forVisionTasks(WASM_URL);
    this.landmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
      runningMode: "VIDEO",
      numHands: 2,
    });
  }

  /** Retorna as mãos detectadas no frame atual (21 landmarks cada). */
  detect(video: HTMLVideoElement): Hand[] {
    if (video.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = video.currentTime;
      const result = this.landmarker.detectForVideo(video, performance.now());
      this.lastHands = result.landmarks;
    }
    return this.lastHands;
  }
}
