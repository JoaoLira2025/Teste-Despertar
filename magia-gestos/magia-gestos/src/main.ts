import { HandTracker, type Hand } from "./tracking/handTracker";
import { HandSmoother } from "./tracking/smothing";
import { GestureStabilizer, classifyHand, type GestureName } from "./gestures/gestures";
import { GeodesicGlobeGL } from "./effects/geodesicGlobeGL";
import { Stage } from "./engine/stage";
import { FireGL } from "./effects/fireGL";
import { ShieldGL, SuperShieldGL } from "./effects/shieldGL";
import { DivineShieldGL } from "./effects/divineShieldGL";
import { AngelicGL, SuperAngelicGL } from "./effects/angelicGL";
import { LightningGL } from "./effects/lightningGL";
import { StormGL } from "./effects/stormGL";
import { TeslaShieldGL } from "./effects/teslaShieldGL";
import { JudgementGlobeGL } from "./effects/judgementGlobeGL";
import { ProjectileSystem } from "./engine/projectiles";
import { WaterBubbleGL } from "./effects/waterBubbleGL"; // <-- NOVO IMPORT

const video = document.getElementById("video") as HTMLVideoElement;
const canvas = document.getElementById("overlay") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const statusEl = document.getElementById("status")!;
const startBtn = document.getElementById("start") as HTMLButtonElement;

// Conexões entre os 21 landmarks da mão (esqueleto)
const CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

const GESTURE_COLOR: Record<GestureName, string> = {
  none: "#8f7bff",
  openPalm: "#38e8ff",
  pinch: "#ffd93d",
  fist: "#ff5d73",
  spark: "#7aa2ff",
  three: "#ffb347",
  one: "#00ffff", // <-- Cor para o novo gesto
};

const GESTURE_LABEL: Record<GestureName, string> = {
  none: "—",
  openPalm: "Palma aberta",
  pinch: "Pinça",
  fist: "Punho",
  spark: "Raio",
  three: "Globo",
  one: "Bolha d'água", // <-- Label para o novo gesto
};

function drawHand(hand: Hand, gesture: GestureName): void {
  const w = canvas.width;
  const h = canvas.height;
  const color = GESTURE_COLOR[gesture];

  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  for (const [a, b] of CONNECTIONS) {
    ctx.beginPath();
    ctx.moveTo(hand[a].x * w, hand[a].y * h);
    ctx.lineTo(hand[b].x * w, hand[b].y * h);
    ctx.stroke();
  }
  ctx.fillStyle = "#ffffff";
  for (const p of hand) {
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // O canvas está espelhado via CSS, então desenhamos o texto "desespelhado"
  ctx.save();
  ctx.translate(hand[0].x * w, hand[0].y * h + 32);
  ctx.scale(-1, 1);
  ctx.fillStyle = color;
  ctx.font = "bold 22px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(GESTURE_LABEL[gesture], 0, 0);
  ctx.restore();
}

async function start(): Promise<void> {
  startBtn.disabled = true;
  statusEl.textContent = "Carregando modelo de mãos...";

  const tracker = new HandTracker();
  await tracker.init();

  statusEl.textContent = "Pedindo acesso à câmera...";
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 1280, height: 960, facingMode: "user" },
  });
  video.srcObject = stream;
  await video.play();

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const aspect = video.videoWidth / video.videoHeight;
  startBtn.style.display = "none";

  // Cena Three.js (bloom + efeitos na GPU), mesmo tamanho do canvas 2D
  const stage = new Stage(
    document.getElementById("gl") as HTMLCanvasElement,
    canvas.width,
    canvas.height,
  );

  const smoother = new HandSmoother(0.5);
  const stabilizers = [new GestureStabilizer(4), new GestureStabilizer(4)];

  // Escudos em WebGL
  const shields = [new ShieldGL(stage.scene), new ShieldGL(stage.scene)];
  const superShield = new SuperShieldGL(stage.scene);
  const divineShield = new DivineShieldGL(stage.scene);

  const fireGLs = [new FireGL(stage.scene), new FireGL(stage.scene)];

  // Luz Angelical em WebGL
  const angels = [new AngelicGL(stage.scene), new AngelicGL(stage.scene)];
  const superAngel = new SuperAngelicGL(stage.scene);

  // Raios em WebGL
  const lightnings = [new LightningGL(stage.scene), new LightningGL(stage.scene)];

  // Janela da Tempestade
  const storm = new StormGL(stage.scene);

  // Escudo Tesla (palma aberta + "L")
  const tesla = new TeslaShieldGL(stage.scene);
  let teslaActive = false; // histerese: entra com margem 80, só sai com margem 140

  // Globo do Julgamento (pinça + "L")
  const judgement = new JudgementGlobeGL(stage.scene);
  let judgementActive = false; // histerese: entra com margem 140, só sai com margem 220

  // Globo Geodésico (polegar + indicador + médio)
  const globes = [
    new GeodesicGlobeGL(stage.scene, canvas.width, canvas.height),
    new GeodesicGlobeGL(stage.scene, canvas.width, canvas.height),
  ];

  // Bolha d'água (indicador apenas)
  const waterBubbles = [
    new WaterBubbleGL(stage.scene),
    new WaterBubbleGL(stage.scene)
  ];

  // Lançamento de feitiços (arremessar a mão)
  const projectiles = new ProjectileSystem(stage.scene, canvas.width, canvas.height, aspect);

  const loop = (): void => {
    const hands = smoother.smooth(tracker.detect(video));
    const w = canvas.width;
    const h = canvas.height;
    const now = performance.now();
    ctx.clearRect(0, 0, w, h);

    // 1. Calcula os gestos
    const gestures = hands.map((hand, i) => {
      const gesture = stabilizers[i].update(classifyHand(hand, aspect));
      drawHand(hand, gesture);
      return gesture;
    });

    // 1.1 Lançamento: detecta o arremesso e move os projéteis
    projectiles.update(hands, gestures, now);

    // 2. Verifica se as duas mãos estão abertas
    const bothOpen = hands.length === 2 && gestures[0] === "openPalm" && gestures[1] === "openPalm";

    // 3. Verifica se os escudos estão colidindo
    let near = false;
    if (bothOpen) {
      const c1 = shields[0].getCenter();
      const c2 = shields[1].getCenter();
      const dist = Math.hypot(c1.x - c2.x, c1.y - c2.y);
      if (dist < c1.radius + c2.radius) {
        near = true;
      }
    }

    // 3.1 Verifica se as duas pinças estão próximas
    const bothPinch = hands.length === 2 && gestures[0] === "pinch" && gestures[1] === "pinch";
    let nearAngel = false;
    if (bothPinch) {
      const c1 = angels[0].getCenter();
      const c2 = angels[1].getCenter();
      const dist = Math.hypot(c1.x - c2.x, c1.y - c2.y);
      if (dist < c1.radius + c2.radius + 100) {
        nearAngel = true;
      }
    }

    // 3.2 Duas mãos em "L" ao mesmo tempo → Janela da Tempestade
    const bothSpark = hands.length === 2 && gestures[0] === "spark" && gestures[1] === "spark";

    // 3.3 Fusão Divina (Escudo + Angelical)
    let divineFusion = false;
    if (hands.length === 2) {
      const isPalmPinch =
        (gestures[0] === "openPalm" && gestures[1] === "pinch") ||
        (gestures[0] === "pinch" && gestures[1] === "openPalm");

      if (isPalmPinch) {
        const idxShield = gestures[0] === "openPalm" ? 0 : 1;
        const idxAngel = idxShield === 0 ? 1 : 0;

        const cShield = shields[idxShield].getCenter();
        const cAngel = angels[idxAngel].getCenter();

        const dist = Math.hypot(cShield.x - cAngel.x, cShield.y - cAngel.y);

        if (dist < cShield.radius + cAngel.radius + 60) {
          divineFusion = true;
        }
      }
    }

    // 3.4 Escudo Tesla: uma mão em palma aberta + a outra em "L", com os dedos encostando no escudo
    let teslaFusion = false;
    let teslaPalmIdx = 0;
    let teslaSparkIdx = 1;
    if (hands.length === 2) {
      const isPalmSpark =
        (gestures[0] === "openPalm" && gestures[1] === "spark") ||
        (gestures[0] === "spark" && gestures[1] === "openPalm");

      if (isPalmSpark) {
        teslaPalmIdx = gestures[0] === "openPalm" ? 0 : 1;
        teslaSparkIdx = teslaPalmIdx === 0 ? 1 : 0;

        const cShield = shields[teslaPalmIdx].getCenter();
        const sh = hands[teslaSparkIdx];
        const mx = ((sh[4].x + sh[8].x) / 2) * w;
        const my = ((sh[4].y + sh[8].y) / 2) * h;
        const dist = Math.hypot(cShield.x - mx, cShield.y - my);

        const margin = teslaActive ? 140 : 80;
        if (dist < cShield.radius + margin) {
          teslaFusion = true;
        }
      }
    }
    teslaActive = teslaFusion;

    // 3.5 Globo do Julgamento: uma mão em pinça + a outra em "L", com o orbe perto dos dedos do "L"
    let judgementFusion = false;
    let jPinchIdx = 0;
    let jSparkIdx = 1;
    if (hands.length === 2) {
      const isPinchSpark =
        (gestures[0] === "pinch" && gestures[1] === "spark") ||
        (gestures[0] === "spark" && gestures[1] === "pinch");

      if (isPinchSpark) {
        jPinchIdx = gestures[0] === "pinch" ? 0 : 1;
        jSparkIdx = jPinchIdx === 0 ? 1 : 0;

        const cAngel = angels[jPinchIdx].getCenter();
        const sh = hands[jSparkIdx];
        const mx = ((sh[4].x + sh[8].x) / 2) * w;
        const my = ((sh[4].y + sh[8].y) / 2) * h;
        const dist = Math.hypot(cAngel.x - mx, cAngel.y - my);

        const margin = judgementActive ? 220 : 140;
        if (dist < cAngel.radius + margin) {
          judgementFusion = true;
        }
      }
    }
    judgementActive = judgementFusion;

    // 4. Atualiza os efeitos individuais
    hands.forEach((hand, i) => {
      const gesture = gestures[i];
      const locked = projectiles.isLocked(i, now);

      const showIndividualShield = gesture === "openPalm" && !near && !divineFusion && !teslaFusion && !locked;
      const showIndividualAngel = gesture === "pinch" && !nearAngel && !divineFusion && !judgementFusion && !locked;

      shields[i].update(hand, showIndividualShield, now, aspect, w, h);

      lightnings[i].update(hand, gesture === "spark" && !bothSpark && !teslaFusion && !judgementFusion && !locked, w, h);

      fireGLs[i].update(hand, gesture === "fist" && !locked, aspect, w, h);

      angels[i].update(hand, showIndividualAngel, now, aspect, w, h);

      globes[i].update(hand, gesture === "three" && !locked, now, aspect, w, h);

      // NOVO: Atualiza a bolha d'água (ela fica na mão e some se a mão for "travada" pelo lançamento)
      waterBubbles[i].update(hand, gesture === "one" && !locked, now, aspect, w, h);
    });

    // 5. Super escudo
    superShield.update(hands[0] ?? null, hands[1] ?? null, near && hands.length === 2, now, aspect, w, h);

    // 5.1 Luz Angelical Suprema
    superAngel.update(hands[0] ?? null, hands[1] ?? null, nearAngel && hands.length === 2, now, aspect, w, h);

    // 5.2 Escudo Divino
    divineShield.update(hands[0] ?? null, hands[1] ?? null, divineFusion, now, aspect, w, h);

    // 5.3 Janela da Tempestade
    storm.update(hands[0] ?? null, hands[1] ?? null, bothSpark, now, w, h);

    // 5.4 Escudo Tesla (a classe cuida do fade in/out sozinha)
    tesla.update(
      teslaFusion ? hands[teslaPalmIdx] : null,
      teslaFusion ? hands[teslaSparkIdx] : null,
      teslaFusion,
      now,
      aspect,
      w,
      h,
    );

    // 5.5 Globo do Julgamento
    judgement.update(
      judgementFusion ? hands[jPinchIdx] : null,
      judgementFusion ? hands[jSparkIdx] : null,
      judgementFusion,
      now,
      aspect,
      w,
      h,
    );

    // 6. Fade out das mãos que sumiram
    for (let i = hands.length; i < shields.length; i++) {
      shields[i].update(null, false, now, aspect, w, h);
      fireGLs[i].update(null, false, aspect, w, h);
      angels[i].update(null, false, now, aspect, w, h);
      lightnings[i].update(null, false, w, h);
      globes[i].update(null, false, now, aspect, w, h);
      waterBubbles[i].update(null, false, now, aspect, w, h); // <-- Adicionado no fade out
    }

    // 7. Renderiza a cena Three.js (com bloom)
    stage.render();

    // 8. Atualiza o status na tela (agora com a velocidade do arremesso)
    statusEl.textContent = hands.length
      ? `Gestos: ${gestures.map((g) => GESTURE_LABEL[g]).join(" | ")}  |  velocidade: ${projectiles.debugSpeed.toFixed(0)}`
      : "Mostre suas mãos para a câmera";

    requestAnimationFrame(loop);
  };

  loop();
}

startBtn.addEventListener("click", () => {
  start().catch((err) => {
    console.error(err);
    statusEl.textContent = `Erro: ${err.message}`;
    startBtn.disabled = false;
  });
});