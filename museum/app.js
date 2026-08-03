const DEFAULT_EXHIBIT = "money-before-the-mint";
const SAFE_EXHIBIT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const gallery = document.querySelector("#gallery");
const experienceTemplate = document.querySelector("#experience-template");
const dialog = document.querySelector("#artifact-dialog");

let exhibit;
let exhibitUrl;
let museum;
let viewMode = "guided";
let activeStop = 0;
let activeGroupId = null;
let activeArtifact = 0;
let activeImage = 0;
let inspectionView = "photo";
let currentStage = "threshold";

initialize();

async function initialize() {
  const requested = new URLSearchParams(location.search).get("exhibit") ?? DEFAULT_EXHIBIT;
  const exhibitId = SAFE_EXHIBIT.test(requested) ? requested : DEFAULT_EXHIBIT;
  exhibitUrl = new URL(`exhibits/${exhibitId}/exhibit.json`, location.href);

  try {
    const response = await fetch(exhibitUrl);
    if (!response.ok) throw new Error(`Exhibit request returned ${response.status}`);
    exhibit = await response.json();
    validatePublicExhibit(exhibit);
    museum = exhibit.experience ?? createFallbackExperience(exhibit);
    renderExperience();
  } catch (error) {
    gallery.innerHTML = `
      <section class="error-state">
        <p class="kicker">Study room unavailable</p>
        <h1>The exhibit could not be opened.</h1>
        <p>Run this site through its local web server, or check that the selected exhibit has been published.</p>
      </section>`;
    console.error(error);
  }
}

function validatePublicExhibit(value) {
  if (value?.schemaVersion !== "1.0" || !Array.isArray(value.artifacts) || value.artifacts.length === 0) {
    throw new Error("Unsupported or empty public exhibit.");
  }
  const artifactIds = new Set();
  for (const artifact of value.artifacts) {
    if (!artifact.id || !artifact.title || !Array.isArray(artifact.images) || artifact.images.length === 0) {
      throw new Error("An artifact record is incomplete.");
    }
    artifactIds.add(artifact.id);
  }
  for (const group of value.experience?.groups ?? []) {
    if (!group.id || !Array.isArray(group.artifactIds) || group.artifactIds.length === 0) {
      throw new Error("An exhibit grouping is incomplete.");
    }
    if (group.artifactIds.some((id) => !artifactIds.has(id))) {
      throw new Error(`Grouping ${group.id} references an unknown public artifact.`);
    }
  }
}

function createFallbackExperience(value) {
  return {
    overview: "Explore the selected objects as a room, or use the object index below for direct access.",
    groups: [
      {
        id: "selected-objects",
        kicker: "Selected objects",
        title: value.title,
        description: value.introduction,
        display: "glass-case",
        artifactIds: value.artifacts.map((artifact) => artifact.id),
        camera: { x: 0, y: 8, scale: 1.35 },
      },
    ],
    tourStops: [
      {
        id: "welcome",
        kicker: "Introduction",
        title: value.title,
        narration: value.introduction,
      },
      {
        id: "selected-objects",
        groupId: "selected-objects",
        kicker: "Selected objects",
        title: "Look more closely",
        narration: value.summary,
      },
    ],
  };
}

function renderExperience() {
  const fragment = experienceTemplate.content.cloneNode(true);
  setAll(fragment, "title", exhibit.title);
  setAll(fragment, "kicker", exhibit.kicker ?? "ArchiveSense · Public exhibition");
  setAll(fragment, "summary", exhibit.summary);
  setAll(fragment, "artifact-count", `${exhibit.artifacts.length} selected objects`);
  setAll(fragment, "lens-label", exhibit.curatorialLens?.label ?? "A focused selection");
  setAll(fragment, "lens-description", exhibit.curatorialLens?.description ?? exhibit.summary);
  setAll(fragment, "introduction", exhibit.introduction);
  setAll(
    fragment,
    "published-at",
    exhibit.publishedAt ? `Published ${formatDate(exhibit.publishedAt)}` : "",
  );

  renderIntroPreview(fragment.querySelector(".preview-objects"));
  renderStations(fragment.querySelector(".display-stations"));
  renderRoomMap(fragment.querySelector(".room-map"));
  renderObjectIndex(fragment.querySelector(".object-index"));
  gallery.replaceChildren(fragment);

  gallery.querySelector(".begin-tour").addEventListener("click", () => enterRoom("guided"));
  gallery.querySelector(".explore-entry").addEventListener("click", () => enterRoom("explore"));
  gallery.querySelector(".intro-preview").addEventListener("click", () => enterRoom("explore"));
  gallery.querySelector(".threshold-button").addEventListener("click", returnToThreshold);
  gallery.querySelector(".open-index").addEventListener("click", openObjectIndex);
  gallery.querySelector(".close-index").addEventListener("click", () => closeObjectIndex(true));
  gallery.querySelectorAll(".mode-button").forEach((button) => {
    button.addEventListener("click", () => setMode(button.dataset.mode));
  });
  gallery.querySelector(".tour-previous").addEventListener("click", () => goToStop(activeStop - 1));
  gallery.querySelector(".tour-next").addEventListener("click", () => goToStop(activeStop + 1));
  gallery.querySelector(".overview-button").addEventListener("click", showOverview);
  gallery.querySelector(".museum-room").addEventListener("keydown", handleRoomKeys);
  gallery.querySelector(".museum-viewport").addEventListener("click", handleViewportClick);
  setMode("guided", false);
  setStage("threshold");
}

function renderIntroPreview(container) {
  for (const artifact of exhibit.artifacts.slice(0, 3)) {
    const mount = document.createElement("span");
    mount.className = `preview-object kind-${presentationKind(artifact)}`;
    const image = document.createElement("img");
    image.src = imageUrl(artifact.images[0]);
    image.alt = "";
    applyImageFraming(image, artifact.images[0]);
    mount.append(image);
    container.append(mount);
  }
}

function enterRoom(mode) {
  setMode(mode, false);
  closeObjectIndex();
  setStage("room");
  gallery.querySelector(".museum-room").focus({ preventScroll: true });
}

function setMode(mode, announce = true) {
  viewMode = mode === "explore" ? "explore" : "guided";
  const experience = gallery.querySelector(".museum-experience");
  experience.dataset.mode = viewMode;
  gallery.querySelectorAll(".mode-button").forEach((button) => {
    const active = button.dataset.mode === viewMode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });

  if (viewMode === "guided") {
    applyTourStop(activeStop);
  } else {
    activeGroupId = null;
    focusCamera(null);
    renderExploreCard(null);
    updateMap();
  }
  if (announce) gallery.querySelector(".museum-room").focus({ preventScroll: true });
}

function renderStations(container) {
  museum.groups.forEach((group, groupIndex) => {
    const station = document.createElement("section");
    station.className = `display-station station-${group.display}`;
    station.dataset.groupId = group.id;
    station.setAttribute("aria-label", `${group.title} grouping`);

    const display = document.createElement("div");
    if (group.display === "coin-tray") buildCoinTray(display, group);
    else if (group.display === "interpretive-panel") buildInterpretivePanel(display, group);
    else buildGlassCase(display, group);

    const focus = document.createElement("button");
    focus.type = "button";
    focus.className = "station-focus";
    focus.append(
      textElement("span", `Grouping ${pad(groupIndex + 1)}`),
      textElement("span", group.title),
    );
    station.append(display, focus);
    station.addEventListener("click", () => selectGroup(group.id));
    container.append(station);
  });
}

function buildCoinTray(container, group) {
  container.className = "coin-cabinet";
  const tray = document.createElement("div");
  tray.className = "tray-grid";
  const objects = groupArtifacts(group).flatMap((artifact) =>
    artifact.images.slice(0, 2).map((image) => ({ artifact, image })),
  );
  tray.style.setProperty("--tray-columns", String(objects.length > 6 ? 4 : 3));
  for (const { artifact, image } of objects) {
    tray.append(createObjectButton(artifact, image, "coin-recess"));
  }
  while (tray.childElementCount < 6) {
    const empty = document.createElement("span");
    empty.className = "coin-recess empty-recess";
    empty.setAttribute("aria-hidden", "true");
    tray.append(empty);
  }
  container.append(tray);
}

function buildGlassCase(container, group) {
  container.className = "glass-case";
  const interior = document.createElement("div");
  interior.className = "case-interior";
  for (const artifact of groupArtifacts(group)) {
    interior.append(createObjectButton(artifact, artifact.images[0], "mounted-paper"));
  }
  container.append(interior);
}

function buildInterpretivePanel(container, group) {
  container.className = "interpretive-panel";
  container.append(
    textElement("p", group.kicker ?? "Curatorial question"),
    textElement("h3", group.title),
  );
  const thumbnails = document.createElement("div");
  thumbnails.className = "panel-thumbnails";
  for (const artifact of groupArtifacts(group)) {
    thumbnails.append(createObjectButton(artifact, artifact.images[0], "panel-object"));
  }
  container.append(thumbnails);
}

function createObjectButton(artifact, image, className) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `${className} kind-${presentationKind(artifact)}`;
  button.setAttribute("aria-label", `Inspect ${artifact.title}`);
  button.title = `Inspect ${artifact.title}`;
  const element = document.createElement("img");
  element.src = imageUrl(image);
  element.alt = image.alt;
  applyImageFraming(element, image);
  button.append(element);
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    openArtifact(findArtifactIndex(artifact.id));
  });
  return button;
}

function renderRoomMap(container) {
  const overview = document.createElement("button");
  overview.type = "button";
  overview.className = "map-overview active";
  overview.textContent = "Room overview";
  overview.addEventListener("click", showOverview);
  container.append(overview);

  museum.groups.forEach((group, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "map-stop";
    button.dataset.groupId = group.id;
    button.append(textElement("span", pad(index + 1)), textElement("span", group.title));
    button.addEventListener("click", () => selectGroup(group.id));
    container.append(button);
  });
}

function renderObjectIndex(container) {
  exhibit.artifacts.forEach((artifact, index) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "object-card";
    card.setAttribute("aria-label", `Inspect ${artifact.title}`);
    const imageFrame = document.createElement("span");
    imageFrame.className = "object-card-image";
    const image = document.createElement("img");
    image.src = imageUrl(artifact.images[0]);
    image.alt = artifact.images[0].alt;
    applyImageFraming(image, artifact.images[0]);
    imageFrame.classList.add(`kind-${presentationKind(artifact)}`);
    imageFrame.append(image, textElement("span", pad(index + 1), "object-card-number"));
    const copy = document.createElement("span");
    copy.className = "object-card-copy";
    const labels = document.createElement("span");
    labels.append(
      textElement("h3", artifact.title),
      textElement("p", artifact.subtitle ?? artifact.date?.label ?? "Selected object"),
    );
    copy.append(labels, textElement("span", "↗", "object-card-arrow"));
    card.append(imageFrame, copy);
    card.addEventListener("click", () => openArtifact(index));
    container.append(card);
  });
}

function selectGroup(groupId) {
  closeObjectIndex();
  if (viewMode === "guided") {
    const stopIndex = museum.tourStops.findIndex((stop) => stop.groupId === groupId);
    if (stopIndex >= 0) goToStop(stopIndex);
    else focusCamera(groupId);
  } else {
    activeGroupId = groupId;
    focusCamera(groupId);
    renderExploreCard(groupById(groupId));
    updateMap();
    setStage("display");
  }
}

function showOverview() {
  if (viewMode === "guided") goToStop(0);
  else {
    activeGroupId = null;
    focusCamera(null);
    renderExploreCard(null);
    updateMap();
    setStage("room");
  }
}

function goToStop(index) {
  activeStop = Math.max(0, Math.min(museum.tourStops.length - 1, index));
  applyTourStop(activeStop);
  if (currentStage !== "threshold") setStage(activeGroupId ? "display" : "room");
}

function applyTourStop(index) {
  const stop = museum.tourStops[index];
  activeGroupId = stop.groupId ?? null;
  focusCamera(activeGroupId);
  const card = gallery.querySelector(".tour-card");
  card.classList.toggle("has-group", Boolean(activeGroupId));
  gallery.querySelector(".tour-count").textContent = `Stop ${pad(index + 1)} of ${pad(museum.tourStops.length)}`;
  gallery.querySelector(".tour-kicker").textContent = stop.kicker ?? "Guided visit";
  gallery.querySelector(".tour-title").textContent = stop.title;
  gallery.querySelector(".tour-narration").textContent = stop.narration;
  const previous = gallery.querySelector(".tour-previous");
  const next = gallery.querySelector(".tour-next");
  previous.disabled = index === 0;
  next.disabled = index === museum.tourStops.length - 1;
  next.firstChild.textContent = index === museum.tourStops.length - 2 ? "Conclude " : "Continue ";
  renderGroupObjectActions(activeGroupId ? groupById(activeGroupId) : null);
  updateMap();
}

function renderExploreCard(group) {
  const card = gallery.querySelector(".tour-card");
  card.classList.toggle("has-group", Boolean(group));
  gallery.querySelector(".tour-count").textContent = group ? "Selected grouping" : "Explore freely";
  gallery.querySelector(".tour-kicker").textContent = group?.kicker ?? "Room overview";
  gallery.querySelector(".tour-title").textContent = group?.title ?? exhibit.title;
  gallery.querySelector(".tour-narration").textContent = group?.description ?? museum.overview;
  renderGroupObjectActions(group);
}

function renderGroupObjectActions(group) {
  const container = gallery.querySelector(".group-object-actions");
  container.replaceChildren();
  if (!group) {
    container.hidden = true;
    return;
  }
  for (const artifact of groupArtifacts(group)) {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-label", `Inspect ${artifact.title}`);
    const thumbnail = document.createElement("span");
    thumbnail.className = `group-object-thumbnail kind-${presentationKind(artifact)}`;
    const image = document.createElement("img");
    image.src = imageUrl(artifact.images[0]);
    image.alt = "";
    applyImageFraming(image, artifact.images[0]);
    thumbnail.append(image);
    button.append(
      thumbnail,
      textElement("span", artifact.title, "group-object-title"),
      textElement("span", "→", "group-object-arrow"),
    );
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      openArtifact(findArtifactIndex(artifact.id));
    });
    container.append(button);
  }
  container.hidden = false;
}

function focusCamera(groupId) {
  const set = gallery.querySelector(".museum-set");
  const group = groupId ? groupById(groupId) : null;
  set.dataset.focus = group?.id ?? "overview";
  set.style.setProperty("--camera-x", `${group?.camera?.x ?? 0}%`);
  set.style.setProperty("--camera-y", `${group?.camera?.y ?? 0}%`);
  set.style.setProperty("--camera-scale", String(group?.camera?.scale ?? 1));
  gallery.querySelectorAll(".display-station").forEach((station) => {
    station.classList.toggle("is-active", station.dataset.groupId === groupId);
  });
}

function updateMap() {
  gallery.querySelector(".map-overview").classList.toggle("active", !activeGroupId);
  gallery.querySelectorAll(".map-stop").forEach((button) => {
    const active = button.dataset.groupId === activeGroupId;
    button.classList.toggle("active", active);
    button.setAttribute("aria-current", active ? "true" : "false");
  });
}

function handleRoomKeys(event) {
  if (event.key === "Escape" || event.key === "Home") {
    event.preventDefault();
    showOverview();
    return;
  }
  if (viewMode !== "guided") return;
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    goToStop(activeStop - 1);
  }
  if (event.key === "ArrowRight") {
    event.preventDefault();
    goToStop(activeStop + 1);
  }
}

function handleViewportClick(event) {
  if (currentStage !== "display" || dialog.open) return;
  if (event.target.closest(".display-station")) return;
  showOverview();
}

function openArtifact(index) {
  activeArtifact = index;
  activeImage = 0;
  inspectionView = presentationKind(exhibit.artifacts[index]) === "coin" ? "object" : "photo";
  renderDialog();
  setStage("object");
  dialog.showModal();
}

function renderDialog() {
  const artifact = exhibit.artifacts[activeArtifact];
  document.querySelector("#dialog-number").textContent = `Object ${pad(activeArtifact + 1)} of ${pad(exhibit.artifacts.length)}`;
  document.querySelector("#dialog-title").textContent = artifact.title;
  const subtitle = document.querySelector("#dialog-subtitle");
  subtitle.textContent = artifact.subtitle ?? "";
  subtitle.hidden = !artifact.subtitle;

  const facts = document.querySelector("#dialog-facts");
  facts.replaceChildren();
  [
    ["Date", artifact.date?.label],
    ["Origin", artifact.origin],
    ["Materials", artifact.materials],
    ["Dimensions", artifact.dimensions],
  ].forEach(([label, value]) => {
    if (!value) return;
    const term = document.createElement("dt");
    const description = document.createElement("dd");
    term.textContent = label;
    description.textContent = value;
    facts.append(term, description);
  });

  const description = document.querySelector("#dialog-description");
  description.textContent = artifact.description ?? "";
  description.hidden = !artifact.description;

  const research = document.querySelector("#dialog-research");
  const researchList = document.querySelector("#dialog-research-list");
  researchList.replaceChildren();
  for (const note of artifact.researchNotes ?? []) {
    researchList.append(textElement("p", note));
  }
  research.hidden = researchList.childElementCount === 0;

  const tags = document.querySelector("#dialog-tags");
  tags.replaceChildren();
  for (const tag of artifact.tags ?? []) tags.append(textElement("span", tag));
  tags.hidden = tags.childElementCount === 0;
  renderDialogImage();
}

function renderDialogImage() {
  const artifact = exhibit.artifacts[activeArtifact];
  const selectedImage = artifact.images[activeImage];
  const kind = presentationKind(artifact);
  const inspector = document.querySelector(".image-inspector");
  const image = document.querySelector("#dialog-image");
  image.src = imageUrl(selectedImage);
  image.alt = selectedImage.alt;
  applyImageFraming(image, selectedImage);
  inspector.dataset.view = inspectionView;
  inspector.dataset.kind = kind;
  document.querySelector("#object-view").classList.toggle("active", inspectionView === "object");
  document.querySelector("#object-view").setAttribute("aria-pressed", inspectionView === "object" ? "true" : "false");
  document.querySelector("#photo-view").classList.toggle("active", inspectionView === "photo");
  document.querySelector("#photo-view").setAttribute("aria-pressed", inspectionView === "photo" ? "true" : "false");
  document.querySelector("#object-view").hidden = kind !== "coin";
  const caption = document.querySelector("#image-caption");
  caption.textContent = [selectedImage.caption, selectedImage.credit].filter(Boolean).join(" · ");
  caption.hidden = !caption.textContent;

  const thumbnails = document.querySelector("#image-thumbnails");
  thumbnails.replaceChildren();
  artifact.images.forEach((item, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "thumbnail";
    button.classList.toggle("active", index === activeImage);
    button.setAttribute("aria-label", `View image ${index + 1} of ${artifact.images.length}`);
    button.setAttribute("aria-current", index === activeImage ? "true" : "false");
    const thumbnail = document.createElement("img");
    thumbnail.src = imageUrl(item);
    thumbnail.alt = "";
    button.append(thumbnail);
    button.addEventListener("click", () => {
      activeImage = index;
      renderDialogImage();
    });
    thumbnails.append(button);
  });

  const hasMultiple = artifact.images.length > 1;
  document.querySelector("#image-previous").hidden = !hasMultiple;
  document.querySelector("#image-next").hidden = !hasMultiple;
  document.querySelector("#turn-object").hidden = !hasMultiple || inspectionView !== "object";
  thumbnails.hidden = !hasMultiple;
  resetObjectTilt();
}

function stepImage(delta) {
  const count = exhibit.artifacts[activeArtifact].images.length;
  activeImage = (activeImage + delta + count) % count;
  renderDialogImage();
}

document.querySelector("#dialog-close").addEventListener("click", () => dialog.close());
document.querySelector("#image-previous").addEventListener("click", () => stepImage(-1));
document.querySelector("#image-next").addEventListener("click", () => stepImage(1));
document.querySelector("#turn-object").addEventListener("click", () => stepImage(1));
document.querySelector("#object-view").addEventListener("click", () => setInspectionView("object"));
document.querySelector("#photo-view").addEventListener("click", () => setInspectionView("photo"));
document.querySelector("#image-stage").addEventListener("pointermove", tiltObject);
document.querySelector("#image-stage").addEventListener("pointerleave", resetObjectTilt);
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});
dialog.addEventListener("close", () => {
  if (currentStage === "object") setStage(activeGroupId ? "display" : "room");
});
dialog.addEventListener("keydown", (event) => {
  if (event.key === "ArrowLeft") stepImage(-1);
  if (event.key === "ArrowRight") stepImage(1);
});

function groupArtifacts(group) {
  return group.artifactIds.map((id) => exhibit.artifacts.find((artifact) => artifact.id === id)).filter(Boolean);
}

function groupById(id) {
  return museum.groups.find((group) => group.id === id);
}

function findArtifactIndex(id) {
  return exhibit.artifacts.findIndex((artifact) => artifact.id === id);
}

function textElement(tagName, text, className) {
  const element = document.createElement(tagName);
  element.textContent = text ?? "";
  if (className) element.className = className;
  return element;
}

function setAll(root, field, value) {
  root.querySelectorAll(`[data-field="${field}"]`).forEach((element) => {
    element.textContent = value ?? "";
  });
}

function imageUrl(image) {
  return new URL(image.src, exhibitUrl).href;
}

function presentationKind(artifact) {
  return artifact.presentation?.kind ?? "object";
}

function applyImageFraming(element, image) {
  const framing = image.presentation ?? {};
  element.style.setProperty("--object-scale", String(framing.scale ?? 1.38));
  const positionImage = () => {
    const defaultY = element.naturalHeight > element.naturalWidth ? 68 : 55;
    const focusX = framing.focusX ?? 50;
    const focusY = framing.focusY ?? defaultY;
    element.style.setProperty("--focus-x", `${focusX}%`);
    element.style.setProperty("--focus-y", `${focusY}%`);
    element.style.objectPosition = `${focusX}% ${focusY}%`;
  };
  if (element.complete && element.naturalWidth) positionImage();
  else element.addEventListener("load", positionImage, { once: true });
}

function setInspectionView(view) {
  const artifact = exhibit.artifacts[activeArtifact];
  inspectionView = view === "object" && presentationKind(artifact) === "coin" ? "object" : "photo";
  renderDialogImage();
}

function tiltObject(event) {
  const artifact = exhibit.artifacts[activeArtifact];
  if (inspectionView !== "object" || presentationKind(artifact) !== "coin" || reducedMotion()) return;
  const stage = event.currentTarget;
  const bounds = stage.getBoundingClientRect();
  const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
  const y = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
  const lift = document.querySelector("#object-lift");
  lift.style.setProperty("--tilt-x", `${(0.5 - y) * 12}deg`);
  lift.style.setProperty("--tilt-y", `${(x - 0.5) * 16}deg`);
  lift.style.setProperty("--light-x", `${x * 100}%`);
  lift.style.setProperty("--light-y", `${y * 100}%`);
}

function resetObjectTilt() {
  const lift = document.querySelector("#object-lift");
  lift.style.setProperty("--tilt-x", "0deg");
  lift.style.setProperty("--tilt-y", "0deg");
  lift.style.setProperty("--light-x", "35%");
  lift.style.setProperty("--light-y", "25%");
}

function setStage(stage) {
  currentStage = ["threshold", "room", "display", "object"].includes(stage) ? stage : "room";
  gallery.dataset.stage = currentStage;
  document.body.dataset.exhibitStage = currentStage;
  updateJourney();
}

function updateJourney() {
  const order = ["threshold", "room", "display", "object"];
  const currentIndex = order.indexOf(currentStage);
  document.querySelectorAll(".journey-step").forEach((button) => {
    const stepIndex = order.indexOf(button.dataset.journey);
    button.classList.toggle("active", button.dataset.journey === currentStage);
    button.classList.toggle("complete", stepIndex < currentIndex);
    button.setAttribute("aria-current", button.dataset.journey === currentStage ? "step" : "false");
    button.disabled = stepIndex > currentIndex || (button.dataset.journey === "display" && !activeGroupId);
  });
}

function returnToThreshold() {
  if (dialog.open) dialog.close();
  closeObjectIndex();
  setStage("threshold");
}

function openObjectIndex() {
  gallery.querySelector(".object-index-section").classList.add("open");
  gallery.querySelector(".open-index").setAttribute("aria-expanded", "true");
  gallery.querySelector(".close-index").focus();
}

function closeObjectIndex(restoreFocus = false) {
  gallery.querySelector(".object-index-section")?.classList.remove("open");
  const trigger = gallery.querySelector(".open-index");
  trigger?.setAttribute("aria-expanded", "false");
  if (restoreFocus) trigger?.focus();
}

document.querySelectorAll(".journey-step").forEach((button) => {
  button.addEventListener("click", () => {
    const target = button.dataset.journey;
    if (target === "threshold") returnToThreshold();
    if (target === "room") {
      if (dialog.open) dialog.close();
      closeObjectIndex();
      showOverview();
    }
    if (target === "display" && activeGroupId) {
      if (dialog.open) dialog.close();
      closeObjectIndex();
      focusCamera(activeGroupId);
      setStage("display");
    }
  });
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && gallery.querySelector(".object-index-section")?.classList.contains("open")) {
    event.preventDefault();
    closeObjectIndex(true);
  }
});

function pad(value) {
  return String(value).padStart(2, "0");
}

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "long", timeZone: "UTC" }).format(
    new Date(`${value}T00:00:00Z`),
  );
}

function reducedMotion() {
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}
