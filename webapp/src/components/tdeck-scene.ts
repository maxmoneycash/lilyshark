import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clampPitch, PITCH_DRAG, REST_PITCH, REST_ROLL, REST_YAW, YAW_DRAG } from './tdeck-pose';
import { getTDeckTune, subscribeTDeckTune } from './tdeck-tune';

export interface TDeckViewer {
  setScreen(url: string): void;
  setMotion(enabled: boolean): void;
  reset(): void;
  dispose(): void;
}

const MODEL_URL = '/models/tdeck-plus/tdeck-plus-v5.glb';
const CAMERA_FOV = 32;
const gltfLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

// Parse once for the page. Intro mounts after this module, so a cached GLB
// can attach on the first layout pass instead of flashing a 2D stand-in.
let parsedModel: THREE.Group | undefined;
const modelReady: Promise<THREE.Group> = fetch(MODEL_URL)
  .then(response => {
    if (!response.ok) throw new Error(`Model request failed: ${response.status}`);
    return response.arrayBuffer();
  })
  .then(bytes => gltfLoader.parseAsync(bytes.slice(0), '/models/tdeck-plus/'))
  .then(gltf => {
    parsedModel = gltf.scene;
    return gltf.scene;
  });

export function preloadTDeck(): Promise<unknown> {
  return modelReady;
}

/** Owns GPU resources and input for one mounted intro. No global render loop. */
export function mountTDeck(
  canvas: HTMLCanvasElement,
  callbacks: { onReady(): void; onError(): void },
): TDeckViewer {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
  } catch {
    callbacks.onError();
    return { setScreen() {}, setMotion() {}, reset() {}, dispose() {} };
  }
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.14;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, .02, 8);
  const look = new THREE.Vector3(0, .018, 0);
  camera.position.set(0, .018, .29);
  camera.lookAt(look);
  const rig = new THREE.Group();
  scene.add(rig);
  // Clean studio lighting
  const environment = new THREE.Scene();
  environment.background = new THREE.Color().setRGB(.16 * .7, .15 * .7, .14 * .7);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environmentMap = pmrem.fromScene(environment);
  scene.environment = environmentMap.texture;
  scene.environmentIntensity = 1.0;
  pmrem.dispose();
  
  const key = new THREE.DirectionalLight(0xfff6ea, 1.2);
  key.position.set(.55, .82, .48);
  scene.add(key);
  
  const rim = new THREE.DirectionalLight(0xc5d8f0, 0.8);
  rim.position.set(-.55, .28, -.22);
  scene.add(rim);
  
  const fill = new THREE.DirectionalLight(0xffffff, 0.4);
  fill.position.set(0, 0, .5);
  scene.add(fill);

  const bounce = new THREE.HemisphereLight(0xd7e4f2, 0x1c1612, .4);
  scene.add(bounce);

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
  // The LCD is an illuminated UI, so its pixels should retain their source
  // colors. PBR reflections were lifting black backgrounds into a gray veil.
  const lcdMaterial = new THREE.MeshBasicMaterial({
    map: lcdTexture,
    toneMapped: false,
    dithering: true,
  });

  let disposed = false;
  let ready = false;
  let modelLoaded = false;
  let failed = false;
  let moving = true;
  let visible = true;
  let frame = 0;
  let lastTime = 0;
  let time = 0;
  let yaw = REST_YAW;
  let pitch = REST_PITCH;
  let instanceRoot: THREE.Object3D | undefined;
  let velYaw = 0;
  let velPitch = 0;
  let screenUrl = '';
  let screenRequest = 0;
  let pointer: { id: number; x: number; y: number; startX: number; startY: number; time: number; dragging: boolean } | undefined;
  // Decoded frames are small (320×240); keep a bounded cache for reverse scrolling.
  const screens = new Map<string, HTMLImageElement>();

  function render(now: number) {
    frame = 0;
    if (disposed || failed || !visible || document.hidden) return;
    const dt = Math.min((now - (lastTime || now)) / 1000, .04);
    lastTime = now;
    if (!pointer) {
      if (moving) {
        velYaw *= Math.exp(-3.4 * dt);
        velPitch *= Math.exp(-3.4 * dt);
        if (Math.abs(velYaw) < .02) velYaw = 0;
        if (Math.abs(velPitch) < .02) velPitch = 0;
        yaw += velYaw * dt;
        pitch = clampPitch(pitch + velPitch * dt);
        time += dt;
      } else {
        velYaw = 0;
        velPitch = 0;
      }
    }
    const breathe = moving ? 1 : 0;
    const amp = getTDeckTune().breathe;
    rig.rotation.set(
      pitch + Math.sin(time * .55) * amp * breathe,
      yaw,
      REST_ROLL + Math.sin(time * .4) * (amp * .67) * breathe,
      'YXZ',
    );
    rig.position.set(0, Math.sin(time * .7) * .0015 * breathe, 0);
    renderer.render(scene, camera);
    if (moving && ready) requestRender();
  }

  function requestRender() {
    if (!frame && !disposed && !failed && visible && !document.hidden) frame = requestAnimationFrame(render);
  }

  // Show the chassis as soon as the GLB is in the scene. The LCD can fill in
  // a frame later; waiting on it was painting a 2D stand-in for a second.
  function showReady() {
    if (ready || failed || disposed || !modelLoaded) return;
    ready = true;
    cancelAnimationFrame(frame);
    frame = 0;
    lastTime = performance.now();
    render(lastTime);
    callbacks.onReady();
  }
  function resize() {
    const width = Math.max(canvas.clientWidth, 1);
    const height = Math.max(canvas.clientHeight, 1);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    const aspect = width / height;
    const tune = getTDeckTune();
    const halfHeight = Math.max(tune.halfHeight, .048 / aspect);
    const isMobile = window.innerWidth <= 860;
    const panOffset = isMobile ? 0 : -0.22;
    const pan = -halfHeight * aspect * (tune.pan + panOffset);
    renderer.toneMappingExposure = tune.exposure;
    scene.environmentIntensity = tune.envIntensity;
    camera.aspect = aspect;
    camera.fov = CAMERA_FOV;
    const distance = halfHeight / Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV) / 2);
    look.set(pan, .018, 0);
    camera.position.set(pan, .018, distance);
    camera.lookAt(look);
    camera.updateProjectionMatrix();
    requestRender();
  }

  function attachModel(source: THREE.Group) {
    const root = source.clone(true);
    // Source glTF: front +Y, antenna -Z. Present front +Z and antenna +Y.
    root.rotation.x = Math.PI / 2;
    let hasScreen = false;
    const anisotropy = renderer.capabilities.getMaxAnisotropy();
    root.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      const polish = (material: THREE.Material) => {
        if (material.name === 'LCD display') {
          hasScreen = true;
          return lcdMaterial;
        }
        if (material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshPhysicalMaterial) {
          material.envMapIntensity = 1;
          material.dithering = true;
          for (const map of [material.map, material.normalMap, material.roughnessMap, material.metalnessMap, material.aoMap]) {
            if (map) {
              map.anisotropy = anisotropy;
              map.needsUpdate = true;
            }
          }
          if (material.map) material.map.colorSpace = THREE.SRGBColorSpace;
          material.needsUpdate = true;
        }
        return material;
      };
      object.material = Array.isArray(object.material) ? object.material.map(polish) : polish(object.material);
    });
    if (!hasScreen || !lcdContext) throw new Error('Model has no usable LCD');
    instanceRoot = root;
    rig.add(root);
    modelLoaded = true;
    resize();
    showReady();
  }

  function disposeInstance() {
    if (instanceRoot) {
      rig.remove(instanceRoot);
      instanceRoot = undefined;
    }
    lcdMaterial.dispose();
    lcdTexture.dispose();
  }

  function fail() {
    if (disposed || failed) return;
    failed = true;
    cancelAnimationFrame(frame);
    frame = 0;
    callbacks.onError();
  }

  const attachWhenReady = (source: THREE.Group) => {
    if (disposed || failed) return;
    try {
      attachModel(source);
    } catch {
      fail();
    }
  };
  if (parsedModel) attachWhenReady(parsedModel);
  else {
    modelReady.then(attachWhenReady).catch(error => {
      if (error.name !== 'AbortError') fail();
    });
  }

  function setScreen(url: string) {
    if (disposed || failed || url === screenUrl) return;
    screenUrl = url;
    const request = ++screenRequest;
    const apply = (image: HTMLImageElement) => {
      if (disposed || failed || request !== screenRequest || !lcdContext) return;
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
      if (disposed || failed) return;
      screens.set(url, image);
      while (screens.size > 8) screens.delete(screens.keys().next().value!);
      apply(image);
    }).catch(() => {
      // Keep the last successful screen; a stale response can never replace it.
      // A missing first PNG must not hide the 3D chassis behind the photo.
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
    event.preventDefault();
    velYaw = 0;
    velPitch = 0;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, time: event.timeStamp, dragging: true };
    canvas.setPointerCapture(event.pointerId);
    requestRender();
  }
  function pointerMove(event: PointerEvent) {
    if (pointer?.id !== event.pointerId) return;
    event.preventDefault();
    if (!pointer.dragging) {
      pointer.dragging = true;
      if (!canvas.hasPointerCapture(event.pointerId)) canvas.setPointerCapture(event.pointerId);
    }
    const dt = Math.max((event.timeStamp - pointer.time) / 1000, .008);
    const dyaw = (event.clientX - pointer.x) * YAW_DRAG;
    const dpitch = (event.clientY - pointer.y) * PITCH_DRAG;
    yaw += dyaw;
    pitch = clampPitch(pitch + dpitch);
    velYaw = dyaw / dt;
    velPitch = dpitch / dt;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    pointer.time = event.timeStamp;
    requestRender();
  }
  function reset() {
    yaw = REST_YAW;
    pitch = REST_PITCH;
    velYaw = 0;
    velPitch = 0;
    time = 0;
    requestRender();
  }
  function keyDown(event: KeyboardEvent) {
    if (event.key === 'ArrowLeft') yaw -= .2;
    else if (event.key === 'ArrowRight') yaw += .2;
    else if (event.key === 'ArrowUp') pitch = clampPitch(pitch - .18);
    else if (event.key === 'ArrowDown') pitch = clampPitch(pitch + .18);
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
  function preventDrag(event: Event) { event.preventDefault(); }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  const unsubTune = subscribeTDeckTune(() => { resize(); requestRender(); });
  const intersection = new IntersectionObserver(entries => {
    visible = entries[0].isIntersecting;
    lastTime = 0;
    if (visible) requestRender();
    else { cancelAnimationFrame(frame); frame = 0; }
  });
  intersection.observe(canvas);
  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', pointerDown, { passive: false });
  canvas.addEventListener('pointermove', pointerMove, { passive: false });
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('lostpointercapture', release);
  canvas.addEventListener('keydown', keyDown);
  canvas.addEventListener('webglcontextlost', contextLost);
  canvas.addEventListener('dragstart', preventDrag);
  document.addEventListener('visibilitychange', visibilityChanged);
  resize();

  return {
    setScreen,
    setMotion(enabled) { moving = enabled; lastTime = 0; requestRender(); },
    reset,
    dispose() {
      disposed = true;
      ++screenRequest;
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      unsubTune();
      intersection.disconnect();
      canvas.removeEventListener('pointerdown', pointerDown);
      canvas.removeEventListener('pointermove', pointerMove);
      canvas.removeEventListener('pointerup', release);
      canvas.removeEventListener('pointercancel', release);
      canvas.removeEventListener('lostpointercapture', release);
      canvas.removeEventListener('keydown', keyDown);
      canvas.removeEventListener('webglcontextlost', contextLost);
      canvas.removeEventListener('dragstart', preventDrag);
      document.removeEventListener('visibilitychange', visibilityChanged);
      screens.clear();
      disposeInstance();
      environmentMap.dispose();
      renderer.dispose();
      // Fast Refresh can mount a new viewer on the same canvas immediately.
      // A queued context-loss event would then fail that replacement viewer.
      if (!canvas.isConnected) renderer.forceContextLoss();
    },
  };
}
