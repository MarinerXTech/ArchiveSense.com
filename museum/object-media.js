const REGION_KEYS = ["x", "y", "width", "height"];

const regionObserver = typeof ResizeObserver === "function"
  ? new ResizeObserver((entries) => {
      for (const entry of entries) layoutExactRegion(entry.target);
    })
  : null;

export function presentationKind(artifact) {
  return artifact?.presentation?.kind ?? "object";
}

export function objectRegion(image) {
  const region = image?.presentation?.objectRegion;
  if (!region || REGION_KEYS.some((key) => !Number.isFinite(region[key]))) return null;
  if (region.width <= 0 || region.height <= 0) return null;
  if (region.x < 0 || region.y < 0) return null;
  if (region.x + region.width > 100 || region.y + region.height > 100) return null;
  return region;
}

export function hasObjectView(image) {
  if (objectRegion(image)) return true;
  const framing = image?.presentation;
  return Boolean(
    framing
      && (Number.isFinite(framing.focusX)
        || Number.isFinite(framing.focusY)
        || Number.isFinite(framing.scale)),
  );
}

export function preferredInspectionView(image) {
  return hasObjectView(image) ? "object" : "photo";
}

export function mountArtifactMedia(container, {
  artifact,
  image,
  src,
  alt = "",
  mode = "object",
  loading = "lazy",
  onReady,
}) {
  const kind = presentationKind(artifact);
  const exactRegion = mode === "object" ? objectRegion(image) : null;
  const legacy = mode === "object" && !exactRegion && hasObjectView(image);
  const previousStage = container.querySelector(":scope > .artifact-media__stage");
  if (previousStage) {
    regionObserver?.unobserve(previousStage);
    previousStage.remove();
  }

  for (const name of [...container.classList]) {
    if (name.startsWith("kind-")) container.classList.remove(name);
  }
  container.classList.add("artifact-media", `kind-${kind}`);
  container.dataset.mediaMode = mode;
  container.dataset.mediaFraming = exactRegion ? "region" : legacy ? "legacy" : "full";

  const stage = document.createElement("span");
  stage.className = "artifact-media__stage";
  const viewport = document.createElement("span");
  viewport.className = "artifact-media__viewport";
  const element = document.createElement("img");
  element.className = "artifact-media__image";
  element.src = src;
  element.alt = alt;
  element.decoding = "async";
  if (loading) element.loading = loading;
  viewport.append(element);
  stage.append(viewport);
  container.prepend(stage);

  if (exactRegion) {
    const { x, y, width, height } = exactRegion;
    element.style.left = `${(-100 * x) / width}%`;
    element.style.top = `${(-100 * y) / height}%`;
    element.style.width = `${10000 / width}%`;
    element.style.height = `${10000 / height}%`;
    const finalize = () => {
      if (stage.parentElement !== container) return;
      if (!element.naturalWidth || !element.naturalHeight) return;
      const aspect = (element.naturalWidth * width) / (element.naturalHeight * height);
      stage.dataset.regionAspect = String(aspect);
      container.style.setProperty("--object-region-aspect", String(aspect));
      layoutExactRegion(stage);
      regionObserver?.observe(stage);
      onReady?.({ aspect, framing: "region", element });
    };
    if (element.complete && element.naturalWidth) finalize();
    else element.addEventListener("load", finalize, { once: true });
  } else {
    const framing = image?.presentation ?? {};
    const focusX = Number.isFinite(framing.focusX) ? framing.focusX : 50;
    const focusY = Number.isFinite(framing.focusY) ? framing.focusY : 50;
    const scale = Number.isFinite(framing.scale) ? framing.scale : 1;
    element.style.setProperty("--focus-x", `${focusX}%`);
    element.style.setProperty("--focus-y", `${focusY}%`);
    element.style.setProperty("--object-scale", String(scale));
    const finalize = () => {
      if (stage.parentElement !== container) return;
      const aspect = element.naturalWidth && element.naturalHeight
        ? element.naturalWidth / element.naturalHeight
        : 1;
      container.style.setProperty("--object-region-aspect", String(aspect));
      onReady?.({ aspect, framing: legacy ? "legacy" : "full", element });
    };
    if (element.complete && element.naturalWidth) finalize();
    else element.addEventListener("load", finalize, { once: true });
  }

  return element;
}

function layoutExactRegion(stage) {
  const aspect = Number(stage.dataset.regionAspect);
  if (!Number.isFinite(aspect) || aspect <= 0) return;
  const viewport = stage.querySelector(":scope > .artifact-media__viewport");
  if (!viewport) return;
  const width = stage.clientWidth;
  const height = stage.clientHeight;
  if (!width || !height) return;

  if (width / height > aspect) {
    viewport.style.width = `${height * aspect}px`;
    viewport.style.height = `${height}px`;
  } else {
    viewport.style.width = `${width}px`;
    viewport.style.height = `${width / aspect}px`;
  }
}
