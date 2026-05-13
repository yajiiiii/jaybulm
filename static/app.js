import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const PARTICLE_COUNT = 100;
const ATLAS_COLUMNS = 10;
const ATLAS_ROWS = 10;
const TILE_SIZE = 256;
const MOBILE_BREAKPOINT = 720;

// The backend fills this with every file in /albums and repeats from the
// beginning until exactly 100 particle image slots exist.
const media = await loadMedia();
const music = setupBackgroundMusic();
let viewport = getViewportConfig();

const canvas = document.querySelector("#universe-canvas");
const selectionCard = document.querySelector("[data-selection-card]");
const selectionTitle = document.querySelector("[data-selection-title]");
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xffffff);

const camera = new THREE.PerspectiveCamera(viewport.fov, window.innerWidth / window.innerHeight, 0.1, 2000);
camera.position.set(0, 0, viewport.cameraZ);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
  preserveDrawingBuffer: true
});
renderer.setPixelRatio(viewport.pixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.065;
controls.enableZoom = true;
controls.enableRotate = true;
controls.enablePan = true;
controls.screenSpacePanning = true;
configureControls();

const atlas = await createAtlas(media);
const uniforms = {
  size: { value: 0.1 },
  uReveal: { value: 0.0 },
  uAtlas: { value: atlas.texture },
  uAtlasGrid: { value: new THREE.Vector2(ATLAS_COLUMNS, ATLAS_ROWS) }
};

const geometry = new THREE.BufferGeometry();
const positions = new Float32Array(PARTICLE_COUNT * 3);
const atlasOffsets = new Float32Array(PARTICLE_COUNT * 2);

for (let i = 0; i < PARTICLE_COUNT; i += 1) {
  const radius = THREE.MathUtils.randFloat(160, 760);
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(THREE.MathUtils.randFloatSpread(2));

  positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
  positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
  positions[i * 3 + 2] = radius * Math.cos(phi);

  const column = i % ATLAS_COLUMNS;
  const row = Math.floor(i / ATLAS_COLUMNS);
  atlasOffsets[i * 2] = column / ATLAS_COLUMNS;
  atlasOffsets[i * 2 + 1] = row / ATLAS_ROWS;
}

geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
geometry.setAttribute("aAtlasOffset", new THREE.BufferAttribute(atlasOffsets, 2));

const vertexShader = `
  uniform float size;
  uniform float uReveal;
  attribute vec2 aAtlasOffset;
  varying vec2 vAtlasOffset;

  void main() {
    vAtlasOffset = aAtlasOffset;

    // GSAP animates uReveal from 0 to 1, so particles bloom outward from
    // the center into their assigned random 3D coordinates.
    vec3 revealedPosition = position * uReveal;
    vec4 mvPosition = modelViewMatrix * vec4(revealedPosition, 1.0);

    // Required distance sizing: close particles are larger, far particles
    // shrink naturally as their view-space z distance increases.
    gl_PointSize = size * (300.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const fragmentShader = `
  precision mediump float;

  uniform sampler2D uAtlas;
  uniform vec2 uAtlasGrid;
  varying vec2 vAtlasOffset;

  void main() {
    // Each particle receives an atlas tile offset from the CPU. gl_PointCoord
    // is the local 0..1 UV coordinate inside the particle sprite. Combining
    // both values reads the correct album image from the 10x10 atlas.
    vec2 tileSize = 1.0 / uAtlasGrid;
    vec2 pointUV = vec2(gl_PointCoord.x, 1.0 - gl_PointCoord.y);
    vec2 atlasUV = vAtlasOffset + pointUV * tileSize;
    vec4 mediaColor = texture2D(uAtlas, atlasUV);

    float edge = min(min(gl_PointCoord.x, 1.0 - gl_PointCoord.x), min(gl_PointCoord.y, 1.0 - gl_PointCoord.y));
    float alpha = smoothstep(0.0, 0.035, edge);
    gl_FragColor = vec4(mediaColor.rgb, mediaColor.a * alpha);
  }
`;

const material = new THREE.ShaderMaterial({
  uniforms,
  vertexShader,
  fragmentShader,
  transparent: true,
  depthTest: true,
  depthWrite: false
});

const particles = new THREE.Points(geometry, material);
scene.add(particles);
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const tapState = { x: 0, y: 0, time: 0, pointerId: null };
let selectionHideTimer = 0;
raycaster.params.Points.threshold = viewport.rayThreshold;

canvas.addEventListener("pointerdown", onPointerDown, { passive: true });
canvas.addEventListener("pointerup", onPointerUp, { passive: true });
canvas.addEventListener("pointercancel", resetTapState, { passive: true });

window.jaybulmUniverse = { scene, camera, renderer, particles, controls, media, atlas, music, focusParticleAt };
window.madeKidsUniverse = window.jaybulmUniverse;

gsap.to(uniforms.uReveal, {
  value: 1,
  duration: 2.3,
  ease: "power3.out"
});

gsap.to(uniforms.size, {
  value: viewport.pointSize,
  duration: 2,
  ease: "power3.out"
});

gsap.from(camera.position, {
  z: viewport.introZ,
  duration: 2.4,
  ease: "power3.out"
});

window.addEventListener("resize", onResize);
renderer.setAnimationLoop(render);

function render() {
  particles.rotation.y += 0.0007;
  controls.update();
  renderer.render(scene, camera);
}

function onResize() {
  viewport = getViewportConfig();
  configureControls();
  raycaster.params.Points.threshold = viewport.rayThreshold;
  renderer.setPixelRatio(viewport.pixelRatio);
  gsap.to(uniforms.size, {
    value: viewport.pointSize,
    duration: 0.35,
    overwrite: true,
    ease: "power2.out"
  });

  camera.fov = viewport.fov;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function configureControls() {
  controls.minDistance = viewport.minDistance;
  controls.maxDistance = viewport.maxDistance;
  controls.rotateSpeed = viewport.isMobile ? 0.72 : 0.88;
  controls.zoomSpeed = viewport.isMobile ? 0.82 : 1;
  controls.panSpeed = viewport.isMobile ? 0.72 : 1;
  controls.touches.ONE = THREE.TOUCH.ROTATE;
  controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
}

function getViewportConfig() {
  const isMobile = window.innerWidth <= MOBILE_BREAKPOINT || window.matchMedia("(pointer: coarse)").matches;
  return {
    isMobile,
    fov: isMobile ? 66 : 55,
    cameraZ: isMobile ? 760 : 620,
    introZ: isMobile ? 1040 : 900,
    pointSize: isMobile ? 96 : 86,
    pixelRatio: Math.min(window.devicePixelRatio || 1, isMobile ? 1.45 : 2),
    minDistance: isMobile ? 170 : 120,
    maxDistance: isMobile ? 1250 : 1100,
    rayThreshold: isMobile ? 44 : 30,
    focusDistance: isMobile ? 260 : 230
  };
}

function onPointerDown(event) {
  tapState.x = event.clientX;
  tapState.y = event.clientY;
  tapState.time = performance.now();
  tapState.pointerId = event.pointerId;
  document.body.classList.add("has-interacted");
}

function onPointerUp(event) {
  if (tapState.pointerId !== event.pointerId) return;

  const dx = event.clientX - tapState.x;
  const dy = event.clientY - tapState.y;
  const distance = Math.hypot(dx, dy);
  const elapsed = performance.now() - tapState.time;
  resetTapState();

  if (distance <= 12 && elapsed <= 420) {
    focusParticleAt(event.clientX, event.clientY);
  }
}

function resetTapState() {
  tapState.pointerId = null;
}

function focusParticleAt(clientX, clientY) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObject(particles);
  if (hits.length === 0 || typeof hits[0].index !== "number") return;

  const index = hits[0].index;
  const target = new THREE.Vector3().fromBufferAttribute(geometry.getAttribute("position"), index);
  particles.updateMatrixWorld(true);
  target.applyMatrix4(particles.matrixWorld);
  focusOnTarget(target, index);
}

function focusOnTarget(target, index) {
  const direction = camera.position.clone().sub(controls.target);
  if (direction.lengthSq() < 0.0001) direction.set(0, 0, 1);
  direction.normalize();

  const nextCamera = target.clone().add(direction.multiplyScalar(viewport.focusDistance));
  gsap.killTweensOf(camera.position);
  gsap.killTweensOf(controls.target);

  gsap.to(camera.position, {
    x: nextCamera.x,
    y: nextCamera.y,
    z: nextCamera.z,
    duration: 0.85,
    ease: "power3.out"
  });

  gsap.to(controls.target, {
    x: target.x,
    y: target.y,
    z: target.z,
    duration: 0.85,
    ease: "power3.out"
  });

  showSelection(index);
}

function showSelection(index) {
  if (!selectionCard || !selectionTitle) return;

  selectionTitle.textContent = cleanMediaLabel(media[index]);
  selectionCard.hidden = false;
  window.clearTimeout(selectionHideTimer);

  requestAnimationFrame(() => {
    selectionCard.classList.add("is-visible");
  });

  selectionHideTimer = window.setTimeout(() => {
    selectionCard.classList.remove("is-visible");
  }, 3200);
}

function cleanMediaLabel(src) {
  const filename = decodeURIComponent(String(src).split("/").pop() || "Album cover");
  return filename
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function loadMedia() {
  const endpoints = ["/api/media", "/static/media.json"];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint);
      if (!response.ok) throw new Error("media request failed");
      const payload = await response.json();
      if (Array.isArray(payload.media) && payload.media.length > 0) {
        return payload.media.slice(0, PARTICLE_COUNT);
      }
    } catch (error) {
      console.warn(`Could not load media from ${endpoint}.`, error);
    }
  }

  console.warn("Using generated fallback media because albums could not be loaded.");
  return Array.from({ length: PARTICLE_COUNT }, (_, index) => `generated-${index + 1}.png`);
}

async function createAtlas(items) {
  const atlasCanvas = document.createElement("canvas");
  atlasCanvas.width = ATLAS_COLUMNS * TILE_SIZE;
  atlasCanvas.height = ATLAS_ROWS * TILE_SIZE;
  const context = atlasCanvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, atlasCanvas.width, atlasCanvas.height);

  await Promise.all(items.slice(0, PARTICLE_COUNT).map(async (src, index) => {
    const column = index % ATLAS_COLUMNS;
    const row = Math.floor(index / ATLAS_COLUMNS);
    const x = column * TILE_SIZE;
    const y = row * TILE_SIZE;

    try {
      const image = await loadImage(src);
      drawCoverImage(context, image, x, y, TILE_SIZE, TILE_SIZE);
    } catch (error) {
      drawGeneratedTile(context, src, index, x, y);
    }
  }));

  const texture = new THREE.CanvasTexture(atlasCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;

  return { canvas: atlasCanvas, texture };
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

function drawCoverImage(context, image, x, y, width, height) {
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  const dx = x + (width - drawWidth) / 2;
  const dy = y + (height - drawHeight) / 2;

  context.save();
  context.beginPath();
  context.rect(x, y, width, height);
  context.clip();
  context.drawImage(image, dx, dy, drawWidth, drawHeight);
  context.restore();
}

function drawGeneratedTile(context, label, index, x, y) {
  const hue = (index * 37) % 360;
  const gradient = context.createLinearGradient(x, y, x + TILE_SIZE, y + TILE_SIZE);
  gradient.addColorStop(0, `hsl(${hue}, 78%, 70%)`);
  gradient.addColorStop(1, `hsl(${(hue + 90) % 360}, 78%, 88%)`);
  context.fillStyle = gradient;
  context.fillRect(x, y, TILE_SIZE, TILE_SIZE);

  context.fillStyle = "rgba(255,255,255,0.72)";
  context.beginPath();
  context.arc(x + TILE_SIZE * 0.35, y + TILE_SIZE * 0.35, 46, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = "#111111";
  context.font = "700 17px Manrope, sans-serif";
  context.fillText(String(label).slice(0, 22), x + 18, y + TILE_SIZE - 26);
}

function setupBackgroundMusic() {
  const audio = document.querySelector("#background-music");
  if (!audio) return null;

  audio.volume = 0.42;

  const tryPlay = () => {
    audio.play().catch(() => {
      // Browsers often block autoplay with sound until the first gesture.
      // The first click/tap anywhere on the page starts the music.
    });
  };

  window.addEventListener("pointerdown", function unlockAudio() {
    if (audio.paused) tryPlay();
    window.removeEventListener("pointerdown", unlockAudio);
  }, { once: true });

  tryPlay();
  return { audio, tryPlay };
}
