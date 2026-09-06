import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export interface TDeckViewer {
  setScreen(url: string): void;
  setMotion(enabled: boolean): void;
  reset(): void;
  dispose(): void;
}

const MODEL_URL = '/models/tdeck-plus/tdeck-plus-v5.glb';
const INITIAL_YAW = -0.12;
const INITIAL_PITCH = .06;

/** Owns GPU resources and input for one mounted intro. No global render loop. */
export function mountTDeck(
  canvas: HTMLCanvasElement,
  callbacks: { onReady(): void; onError(): void },
): TDeckViewer {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  } catch {
    callbacks.onError();
    return { setScreen() {}, setMotion() {}, reset() {}, dispose() {} };
  }
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-.12, .12, .17, -.17, .001, 5);
  camera.position.set(0, .027, 1);
  camera.lookAt(0, .027, 0);
  const rig = new THREE.Group();
  scene.add(rig);
  const environment = new RoomEnvironment();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environmentMap = pmrem.fromScene(environment, .04);
  scene.environment = environmentMap.texture;
  scene.environmentIntensity = .85;
  environment.dispose();
  pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x5b5060, 1.3));
  for (const [x, y, z, strength] of [[-.3, .2, .5, 3], [.3, .1, -.3, 2], [.2, -.2, .4, 1]]) {
    const light = new THREE.DirectionalLight(0xffffff, strength);
    light.position.set(x, y, z);
    scene.add(light);
  }

  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const bitmaps = new Set<ImageBitmap>();
  const controller = new AbortController();
  const lcdCanvas = document.createElement('canvas');
  lcdCanvas.width = 320;
  lcdCanvas.height = 240;
  const lcdContext = lcdCanvas.getContext('2d');
  const lcdTexture = new THREE.CanvasTexture(lcdCanvas);
  lcdTexture.flipY = false;
  lcdTexture.colorSpace = THREE.SRGBColorSpace;
  lcdTexture.minFilter = THREE.LinearFilter;
  lcdTexture.magFilter = THREE.NearestFilter;
  lcdTexture.generateMipmaps = false;
  const lcdMaterial = new THREE.MeshBasicMaterial({ map: lcdTexture, toneMapped: false });
  textures.add(lcdTexture);
  materials.add(lcdMaterial);

  let disposed = false;
  let ready = false;
  let failed = false;
  let moving = true;
  let visible = true;
  let frame = 0;
  let lastTime = 0;
  let time = 0;
  let yaw = INITIAL_YAW;
  let pitch = INITIAL_PITCH;
  let screenUrl = '';
  let screenRequest = 0;
  let pointer: { id: number; x: number; y: number; startX: number; startY: number; time: number; touch: boolean; dragging: boolean } | undefined;
  // Decoded frames are small (320×240); keep a bounded cache for reverse scrolling.
  const screens = new Map<string, HTMLImageElement>();

  function render(now: number) {
    frame = 0;
    if (disposed || failed || !visible || document.hidden) return;
    const dt = Math.min((now - (lastTime || now)) / 1000, .04);
    lastTime = now;
    if (moving && !pointer) {
      time += dt;
      yaw += (INITIAL_YAW - yaw) * (1 - Math.exp(-4.2 * dt));
      pitch += (INITIAL_PITCH - pitch) * (1 - Math.exp(-4.2 * dt));
    }
    const breathe = moving ? 1 : 0;
    rig.rotation.set(
      pitch + Math.sin(time * .55) * .012 * breathe,
      yaw,
      -.03 + Math.sin(time * .4) * .008 * breathe,
      'YXZ',
    );
    rig.position.set(0, Math.sin(time * .7) * .0015 * breathe, 0);
    renderer.render(scene, camera);
    if (moving && ready) requestRender();
  }

  function requestRender() {
    if (!frame && !disposed && !failed && visible && !document.hidden) frame = requestAnimationFrame(render);
  }

  function resize() {
    const width = Math.max(canvas.clientWidth, 1);
    const height = Math.max(canvas.clientHeight, 1);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, width < 600 ? 1.5 : 2));
    renderer.setSize(width, height, false);
    // Fill the stage with the body. Sit the radio next to the copy; leftover
    // space belongs on the far right, not between the headline and the handset.
    const aspect = width / height;
    const halfHeight = Math.max(height < 400 ? .06 : .07, .042 * height / width);
    const pan = aspect > 1 ? halfHeight * aspect * .3 : 0;
    camera.position.y = height < 400 ? -.004 : -.008;
    camera.left = -halfHeight * aspect + pan;
    camera.right = halfHeight * aspect + pan;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.updateProjectionMatrix();
    requestRender();
  }

  function trackResources(root: THREE.Object3D) {
    root.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        materials.add(material);
        for (const value of Object.values(material)) {
          if (value instanceof THREE.Texture) {
            textures.add(value);
            if (typeof ImageBitmap !== 'undefined' && value.image instanceof ImageBitmap) bitmaps.add(value.image);
          }
        }
      }
    });
  }

  function disposeModel() {
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const texture of textures) texture.dispose();
    for (const bitmap of bitmaps) bitmap.close();
    geometries.clear(); materials.clear(); textures.clear(); bitmaps.clear();
  }

  function fail() {
    if (disposed || failed) return;
    failed = true;
    cancelAnimationFrame(frame);
    frame = 0;
    callbacks.onError();
  }

  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  fetch(MODEL_URL, { signal: controller.signal })
    .then(response => {
      if (!response.ok) throw new Error(`Model request failed: ${response.status}`);
      return response.arrayBuffer();
    })
    .then(bytes => {
      if (disposed || failed) return undefined;
      return loader.parseAsync(bytes, '/models/tdeck-plus/');
    })
    .then(gltf => {
      if (!gltf) return;
      trackResources(gltf.scene);
      if (disposed || failed) { disposeModel(); return; }
      let hasScreen = false;
      gltf.scene.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        const replaceScreen = (material: THREE.Material) => {
          if (material.name !== 'LCD display') return material;
          hasScreen = true;
          // The web export normalizes the LCD's full 0..1 coordinates to UV0.
          return lcdMaterial;
        };
        object.material = Array.isArray(object.material) ? object.material.map(replaceScreen) : replaceScreen(object.material);
      });
      if (!hasScreen || !lcdContext) throw new Error('Model has no usable LCD');
      // Source glTF: front +Y, antenna -Z. Present front +Z and antenna +Y.
      gltf.scene.rotation.x = Math.PI / 2;
      rig.add(gltf.scene);
      ready = true;
      requestRender();
      callbacks.onReady();
    })
    .catch(error => { if (error.name !== 'AbortError') fail(); });

  function setScreen(url: string) {
    if (disposed || url === screenUrl) return;
    screenUrl = url;
    const request = ++screenRequest;
    const apply = (image: HTMLImageElement) => {
      if (disposed || request !== screenRequest || !lcdContext) return;
      lcdContext.drawImage(image, 0, 0, 320, 240);
      lcdTexture.needsUpdate = true;
      canvas.dataset.screen = url;
      requestRender();
    };
    const cached = screens.get(url);
    if (cached) { apply(cached); return; }
    const image = new Image();
    image.src = url;
    image.decode().then(() => {
      if (disposed) return;
      screens.set(url, image);
      while (screens.size > 8) screens.delete(screens.keys().next().value!);
      apply(image);
    }).catch(() => {
      // Keep the last successful screen; a stale response can never replace it.
      if (!disposed && request === screenRequest) screenUrl = '';
    });
  }

  function release(event: PointerEvent) {
    if (pointer?.id !== event.pointerId) return;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    pointer = undefined;
    requestRender();
  }
  function pointerDown(event: PointerEvent) {
    if (!ready || !event.isPrimary || event.button !== 0) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, time: event.timeStamp, touch: event.pointerType === 'touch', dragging: event.pointerType !== 'touch' };
    if (!pointer.touch) canvas.setPointerCapture(event.pointerId);
  }
  function pointerMove(event: PointerEvent) {
    if (pointer?.id !== event.pointerId) return;
    if (!pointer.dragging) {
      const dx = Math.abs(event.clientX - pointer.startX);
      const dy = Math.abs(event.clientY - pointer.startY);
      if (dy > dx && dy > 6) { pointer = undefined; return; }
      if (dx < 6) return;
      pointer.dragging = true;
      canvas.setPointerCapture(event.pointerId);
    }
    const delta = (event.clientX - pointer.x) * .012;
    yaw += delta;
    if (!pointer.touch) pitch = THREE.MathUtils.clamp(pitch + (event.clientY - pointer.y) * .008, -.65, .65);
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    pointer.time = event.timeStamp;
    requestRender();
  }
  function reset() {
    yaw = INITIAL_YAW;
    pitch = INITIAL_PITCH;
    time = 0;
    requestRender();
  }
  function keyDown(event: KeyboardEvent) {
    if (event.key === 'ArrowLeft') yaw -= .2;
    else if (event.key === 'ArrowRight') yaw += .2;
    else if (event.key === 'ArrowUp') pitch = Math.max(-.65, pitch - .15);
    else if (event.key === 'ArrowDown') pitch = Math.min(.65, pitch + .15);
    else if (event.key === 'Home') reset();
    else return;
    event.preventDefault();
    requestRender();
  }
  function visibilityChanged() {
    lastTime = 0;
    if (document.hidden) { cancelAnimationFrame(frame); frame = 0; }
    else requestRender();
  }
  function contextLost(event: Event) { event.preventDefault(); fail(); }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  const intersection = new IntersectionObserver(entries => {
    visible = entries[0].isIntersecting;
    lastTime = 0;
    if (visible) requestRender();
    else { cancelAnimationFrame(frame); frame = 0; }
  });
  intersection.observe(canvas);
  canvas.addEventListener('pointerdown', pointerDown);
  canvas.addEventListener('pointermove', pointerMove);
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('lostpointercapture', release);
  canvas.addEventListener('keydown', keyDown);
  canvas.addEventListener('webglcontextlost', contextLost);
  document.addEventListener('visibilitychange', visibilityChanged);
  resize();

  return {
    setScreen,
    setMotion(enabled) { moving = enabled; lastTime = 0; requestRender(); },
    reset,
    dispose() {
      disposed = true;
      controller.abort();
      ++screenRequest;
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      intersection.disconnect();
      canvas.removeEventListener('pointerdown', pointerDown);
      canvas.removeEventListener('pointermove', pointerMove);
      canvas.removeEventListener('pointerup', release);
      canvas.removeEventListener('pointercancel', release);
      canvas.removeEventListener('lostpointercapture', release);
      canvas.removeEventListener('keydown', keyDown);
      canvas.removeEventListener('webglcontextlost', contextLost);
      document.removeEventListener('visibilitychange', visibilityChanged);
      screens.clear();
      disposeModel();
      environmentMap.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
