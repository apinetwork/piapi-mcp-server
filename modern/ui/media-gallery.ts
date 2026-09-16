import { App } from "@modelcontextprotocol/ext-apps";

type Asset = {
  kind: "image" | "video" | "audio" | "model";
  url: string;
  previewUrl?: string;
  format?: string;
};
type MediaResult = { taskId?: string; usage?: string; assets?: Asset[]; viewerUrl?: string };

const allowedDomains = Array.isArray(window.__PIAPI_MEDIA_RESOURCE_DOMAINS__)
  ? window.__PIAPI_MEDIA_RESOURCE_DOMAINS__
  : [];
const appRoot = document.getElementById("app");

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
  body.append(kind, externalLink(asset.url, "Open / download original"));
  element.append(body);
  return element;
}

function appendPreview(card: HTMLElement, asset: Asset): void {
  if (!isAllowed(asset.url)) return;
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
  }
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
