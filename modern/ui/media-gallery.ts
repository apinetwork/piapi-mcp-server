import { App } from "@modelcontextprotocol/ext-apps";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

type Asset = {
  kind: "image" | "video" | "audio" | "model";
  url: string;
  previewUrl?: string;
  expiresAt?: string;
  format?: string;
};
type MediaResult = { taskId?: string; usage?: string; assets?: Asset[]; viewerUrl?: string };

const allowedDomains = Array.isArray(window.__PIAPI_MEDIA_RESOURCE_DOMAINS__)
  ? window.__PIAPI_MEDIA_RESOURCE_DOMAINS__
  : [];
const appRoot = document.getElementById("app");
let disposePreviews: Array<() => void> = [];

if (!appRoot) throw new Error("PiAPI media gallery root is missing");

const app = new App({ name: "PiAPI Media Gallery", version: "1.1.0" });
app.addEventListener("toolresult", (result) => render(result.structuredContent as MediaResult | undefined));
app.addEventListener("toolcancelled", ({ reason }) => {
  appRoot.replaceChildren(message(reason ? `Task cancelled: ${reason}` : "Task cancelled."));
});
void app.connect().catch(() => {
  appRoot.replaceChildren(message("This host did not establish an MCP Apps UI session. Use the media links in the tool result."));
});

function render(result: MediaResult | undefined): void {
  for (const dispose of disposePreviews) dispose();
  disposePreviews = [];
  if (!result) {
    appRoot.replaceChildren(message("The task completed without structured media metadata. Use the links in the tool result."));
    return;
  }

  appRoot.replaceChildren();
  const summary = document.createElement("div");
  summary.className = "summary";
  summary.textContent = `PiAPI task ${result.taskId ?? "completed"}${result.usage ? ` · ${result.usage} tokens` : ""}`;
  appRoot.append(summary);

  const grid = document.createElement("div");
  grid.className = "grid";
  for (const asset of result.assets ?? []) grid.append(card(asset));
  if (!result.assets?.length) grid.append(message("The task completed, but no recognized media asset was returned."));
  appRoot.append(grid);
  if (result.viewerUrl) appRoot.append(document.createElement("br"), externalLink(result.viewerUrl, "Open PiAPI viewer"));
}

function card(asset: Asset): HTMLElement {
  const element = document.createElement("article");
  element.className = "card";
  appendPreview(element, asset);
  const body = document.createElement("div");
  body.className = "body";
  const kind = document.createElement("div");
  kind.className = "kind";
  kind.textContent = `${asset.kind}${asset.format ? ` · ${asset.format}` : ""}`;
  body.append(kind);
  if (asset.expiresAt) {
    const expiry = document.createElement("div");
    expiry.className = "expiry";
    const expires = new Date(asset.expiresAt);
    expiry.textContent = Number.isNaN(expires.getTime())
      ? "Temporary URL expiry unavailable"
      : expires.getTime() <= Date.now()
        ? "Temporary URL may have expired"
        : `Temporary URL expires ${expires.toLocaleString()}`;
    body.append(expiry);
  }
  body.append(externalLink(asset.url, "Open / download original"));
  element.append(body);
  return element;
}

function appendPreview(card: HTMLElement, asset: Asset): void {
  if (!isAllowed(asset.url) || hasExpired(asset.expiresAt)) return;
  if (asset.kind === "image") {
    const image = document.createElement("img");
    image.src = asset.url;
    image.alt = "PiAPI generated image";
    image.className = "preview";
    card.append(image);
  } else if (asset.kind === "video") {
    const video = document.createElement("video");
    video.src = asset.url;
    video.controls = true;
    video.preload = "metadata";
    video.className = "preview";
    if (asset.previewUrl && isAllowed(asset.previewUrl)) video.poster = asset.previewUrl;
    card.append(video);
  } else if (asset.kind === "audio") {
    if (asset.previewUrl && isAllowed(asset.previewUrl)) {
      const image = document.createElement("img");
      image.src = asset.previewUrl;
      image.alt = "Audio cover";
      image.className = "preview";
      card.append(image);
    }
    const audio = document.createElement("audio");
    audio.src = asset.url;
    audio.controls = true;
    audio.preload = "metadata";
    card.append(audio);
  } else if (asset.kind === "model" && asset.format === "glb") {
    appendGlbPreview(card, asset);
  }
}

/**
 * A self-contained GLB renderer. The Three.js bundle is served inside the
 * `ui://` resource, so the UI never needs an external script origin. GLTF
 * fetching remains subject to the same media-origin allowlist as other assets.
 */
function appendGlbPreview(card: HTMLElement, asset: Asset): void {
  const frame = document.createElement("div");
  frame.className = "model-preview";
  card.append(frame);

  try {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(320, 240, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.className = "model-canvas";
    frame.append(renderer.domElement);

    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x1f2937, 2.5));
    const directional = new THREE.DirectionalLight(0xffffff, 2);
    directional.position.set(3, 5, 4);
    scene.add(directional);

    const camera = new THREE.PerspectiveCamera(35, 4 / 3, 0.01, 1000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.addEventListener("change", renderScene);

    const resize = () => {
      const width = Math.max(1, frame.clientWidth || 320);
      renderer.setSize(width, 240, false);
      camera.aspect = width / 240;
      camera.updateProjectionMatrix();
      renderScene();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(frame);

    const loader = new GLTFLoader();
    loader.load(asset.url, (gltf) => {
      const model = gltf.scene;
      scene.add(model);
      const bounds = new THREE.Box3().setFromObject(model);
      const center = bounds.getCenter(new THREE.Vector3());
      const size = Math.max(bounds.getSize(new THREE.Vector3()).length(), 0.1);
      model.position.sub(center);
      camera.position.set(size, size * 0.7, size);
      controls.target.set(0, 0, 0);
      controls.update();
      resize();
    }, undefined, () => {
      frame.replaceChildren(message("3D preview could not load. Open the original GLB file instead."));
    });

    function renderScene(): void {
      renderer.render(scene, camera);
    }

    disposePreviews.push(() => {
      resizeObserver.disconnect();
      controls.dispose();
      renderer.dispose();
    });
  } catch {
    frame.replaceChildren(message("3D preview is unavailable in this host. Open the original GLB file instead."));
  }
}

function hasExpired(value: string | undefined): boolean {
  if (!value) return false;
  const expires = new Date(value);
  return !Number.isNaN(expires.getTime()) && expires.getTime() <= Date.now();
}

function externalLink(url: string, label: string): HTMLAnchorElement {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.target = "_blank";
  anchor.rel = "noreferrer";
  anchor.textContent = label;
  return anchor;
}

function message(text: string): HTMLElement {
  const element = document.createElement("div");
  element.className = "empty";
  element.textContent = text;
  return element;
}

function isAllowed(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && allowedDomains.some((entry) => {
      const domain = new URL(entry.replace("*.", "placeholder.")).hostname;
      return entry.includes("*.")
        ? url.hostname.endsWith(`.${domain.replace("placeholder.", "")}`)
        : url.origin === new URL(entry).origin;
    });
  } catch {
    return false;
  }
}

declare global {
  interface Window {
    __PIAPI_MEDIA_RESOURCE_DOMAINS__?: string[];
  }
}
