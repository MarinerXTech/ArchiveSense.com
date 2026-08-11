
import {
  hasObjectView,
  mountArtifactMedia,
  objectRegion,
  preferredInspectionView,
  presentationKind,
} from "./object-media.js";

const SAFE_EXHIBIT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MUSEUM_ROOT_URL = new URL("./", document.baseURI);

const gallery = document.querySelector("#gallery");
const experienceTemplate = document.querySelector("#experience-template");
const dialog = document.querySelector("#artifact-dialog");
const imageLightbox = document.querySelector("#image-lightbox");
const imageLightboxViewport = document.querySelector("#image-lightbox-viewport");
const imageLightboxImage = document.querySelector("#image-lightbox-image");
const collectionTemplate = document.querySelector("#collection-template");
const museumHomeTemplate = document.querySelector("#museum-home-template");
const colonyMapTemplate = document.querySelector("#colony-map-template");

let exhibit;
let exhibitUrl;
let exhibitCatalog = [];
let museumExhibits = new Map();
let museum;
let viewMode = "guided";
let activeStop = 0;
let activeGroupId = null;
let activeArtifact = 0;
let activeImage = 0;
let inspectionView = "photo";
let currentStage = "threshold";
let activeMapSlotId = null;
let lightboxScale = 1;
let lightboxX = 0;
let lightboxY = 0;
let lightboxBaseWidth = 0;
let lightboxBaseHeight = 0;
let lightboxActualScale = 1;
let lightboxMaxScale = 8;
let lightboxDrag = null;
const PUBLIC_MUSEUM_URL = "https://archivesense.com/museum/";

initialize();

async function initialize() {
  const parameters = new URLSearchParams(location.search);
  const requested = document.querySelector('meta[name="archivesense-exhibit-id"]')?.content
    || parameters.get("exhibit");
  const exhibitId = requested && SAFE_EXHIBIT.test(requested) ? requested : null;

  try {
    await loadExhibitCatalog();
    if (!exhibitId) {
      if (exhibitCatalog.length === 0) throw new Error("The public museum contains no listed exhibits.");
      await loadMuseumExhibits();
      renderMuseumHome();
      renderMuseumSelector(null);
      return;
    }

    exhibitUrl = new URL(`exhibits/${exhibitId}/exhibit.json`, MUSEUM_ROOT_URL);
    const response = await fetch(exhibitUrl);
    if (!response.ok) throw new Error(`Exhibit request returned ${response.status}`);
    exhibit = await response.json();
    validatePublicExhibit(exhibit);
    ensureCurrentCatalogEntry(exhibitId);
    await loadMuseumExhibits(exhibitId);

    if (exhibit.exhibitType === "collection") {
      museum = null;
      renderCollectionExhibit();
    } else if (exhibit.mapExperience) {
      museum = null;
      renderColonyMapExhibit();
    } else {
      document.body.dataset.exhibitType = "curated";
      museum = exhibit.experience ?? createFallbackExperience(exhibit);
      renderExperience();
    }
    setPageMetadata({
      title: `${exhibit.title} · ArchiveSense Museum`,
      description: exhibit.summary,
      canonicalUrl: canonicalMuseumUrl(exhibitId),
      name: exhibit.title,
      itemCount: exhibit.artifacts.length,
    });
    renderMuseumSelector(exhibitId);
    openRequestedObject(parameters.get("object"));
  } catch (error) {
    setRobotsDirective("noindex, nofollow");
    gallery.innerHTML = `
      <section class="error-state">
        <p class="kicker">Museum unavailable</p>
        <h1>This part of the museum could not be opened.</h1>
        <p>Run this site through its local web server, or check that the selected collection or exhibit has been published.</p>
      </section>`;
    console.error(error);
  }
}

async function loadExhibitCatalog() {
  try {
    const response = await fetch(new URL("exhibits/index.json", MUSEUM_ROOT_URL));
    if (!response.ok) throw new Error(`Museum index request returned ${response.status}`);
    const catalog = await response.json();
    if (catalog?.schemaVersion !== "1.0" || !Array.isArray(catalog.exhibits)) {
      throw new Error("Unsupported museum index.");
    }
    exhibitCatalog = catalog.exhibits.filter((item) => SAFE_EXHIBIT.test(item?.id) && item?.title);
  } catch (error) {
    console.warn("The museum index could not be loaded.", error);
    exhibitCatalog = [];
  }
}

function ensureCurrentCatalogEntry(exhibitId) {
  if (exhibitCatalog.some((item) => item.id === exhibitId)) return;
  exhibitCatalog.push({
    id: exhibitId,
    title: exhibit.title,
    exhibitType: exhibit.exhibitType === "collection" ? "collection" : "curated",
    summary: exhibit.summary,
  });
}

async function loadMuseumExhibits(currentExhibitId = null) {
  const records = await Promise.all(exhibitCatalog.map(async (entry) => {
    const url = new URL(`exhibits/${entry.id}/exhibit.json`, MUSEUM_ROOT_URL);
    if (entry.id === currentExhibitId && exhibit) {
      return { ...entry, exhibit, url };
    }
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Exhibit request returned ${response.status}`);
      const manifest = await response.json();
      validatePublicExhibit(manifest);
      return { ...entry, exhibit: manifest, url };
    } catch (error) {
      console.warn(`Skipping unavailable museum entry: ${entry.id}`, error);
      return null;
    }
  }));
  museumExhibits = new Map(records.filter(Boolean).map((record) => [record.id, record]));
}

function renderMuseumSelector(exhibitId) {
  const selector = document.querySelector("#museum-exhibit-select");
  selector.replaceChildren();

  const prompt = document.createElement("option");
  prompt.value = "";
  prompt.textContent = "Choose a collection or exhibit";
  prompt.selected = !exhibitId;
  selector.append(prompt);

  for (const item of exhibitCatalog) {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = `${item.title} — ${item.exhibitType === "collection" ? "Collection" : "Curated exhibit"}`;
    option.selected = item.id === exhibitId;
    selector.append(option);
  }
  selector.addEventListener("change", () => {
    const nextExhibit = selector.value;
    if (!nextExhibit) {
      location.assign(MUSEUM_ROOT_URL);
      return;
    }
    if (!SAFE_EXHIBIT.test(nextExhibit) || nextExhibit === exhibitId) return;
    location.assign(exhibitHref(nextExhibit));
  });
}

function setHeaderStatus(label) {
  const roomStatus = document.querySelector(".room-status");
  if (!roomStatus) return;
  const statusLight = document.createElement("span");
  statusLight.className = "status-light";
  statusLight.setAttribute("aria-hidden", "true");
  roomStatus.replaceChildren(statusLight, document.createTextNode(` ${label}`));
}
function renderMuseumHome() {
  document.body.dataset.exhibitType = "home";
  document.body.dataset.exhibitStage = "home";
  gallery.dataset.stage = "home";
  const description = "Explore the ArchiveSense Museum through public collection catalogs, curated exhibitions, and the stories objects can tell.";
  setPageMetadata({
    title: "ArchiveSense Museum | Collections & Exhibitions",
    description,
    canonicalUrl: canonicalMuseumUrl(),
    name: "ArchiveSense Museum",
    records: [...museumExhibits.values()],
  });
  const fragment = museumHomeTemplate.content.cloneNode(true);
  const curated = [...museumExhibits.values()].filter((record) => record.exhibitType !== "collection");
  const collections = [...museumExhibits.values()].filter((record) => record.exhibitType === "collection");
  const featured = curated[0] ?? collections[0];

  if (featured) {
    fragment.querySelector("#museum-home-featured").append(createMuseumDirectoryCard(featured, true));
  }
  renderMuseumDirectory(fragment.querySelector("#museum-exhibits-grid"), curated);
  renderMuseumDirectory(fragment.querySelector("#museum-collections-grid"), collections);
  gallery.replaceChildren(fragment);

  setHeaderStatus("Public museum");
}

function setPageDescription(value) {
  const description = document.querySelector('meta[name="description"]');
  if (description && value) description.setAttribute("content", value);
}

function canonicalMuseumUrl(exhibitId = null) {
  const url = new URL(PUBLIC_MUSEUM_URL);
  if (exhibitId) url.pathname = `${url.pathname}exhibits/${exhibitId}/`;
  return url.href;
}

function setPageMetadata({ title, description, canonicalUrl, name, records = [], itemCount = null }) {
  document.title = title;
  setPageDescription(description);
  setMetaContent('meta[property="og:title"]', title);
  setMetaContent('meta[property="og:description"]', description);
  setMetaContent('meta[property="og:url"]', canonicalUrl);
  const shareImage = canonicalUrl.includes("/exhibits/")
    ? `${canonicalUrl}share.jpg`
    : "https://archivesense.com/og.png";
  setMetaContent('meta[property="og:image"]', shareImage);
  setMetaContent('meta[name="twitter:title"]', title);
  setMetaContent('meta[name="twitter:description"]', description);
  setMetaContent('meta[name="twitter:image"]', shareImage);
  setRobotsDirective("index, follow");

  let canonical = document.querySelector('link[rel="canonical"]');
  if (!canonical) {
    canonical = document.createElement("link");
    canonical.rel = "canonical";
    document.head.append(canonical);
  }
  canonical.href = canonicalUrl;

  const structuredData = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name,
    description,
    url: canonicalUrl,
    isPartOf: {
      "@type": "WebSite",
      name: "ArchiveSense",
      url: "https://archivesense.com/",
    },
  };
  if (Number.isInteger(itemCount)) {
    structuredData.mainEntity = {
      "@type": "ItemList",
      numberOfItems: itemCount,
    };
  } else if (records.length > 0) {
    structuredData.mainEntity = {
      "@type": "ItemList",
      numberOfItems: records.length,
      itemListElement: records.map((record, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: record.title,
        url: canonicalMuseumUrl(record.id),
      })),
    };
  }

  let dataBlock = document.querySelector("#page-structured-data");
  if (!dataBlock) {
    dataBlock = document.createElement("script");
    dataBlock.id = "page-structured-data";
    dataBlock.type = "application/ld+json";
    document.head.append(dataBlock);
  }
  dataBlock.textContent = JSON.stringify(structuredData);
}

function setMetaContent(selector, value) {
  const meta = document.querySelector(selector);
  if (meta && value) meta.setAttribute("content", value);
}

function setRobotsDirective(value) {
  let robots = document.querySelector('meta[name="robots"]');
  if (!robots) {
    robots = document.createElement("meta");
    robots.name = "robots";
    document.head.append(robots);
  }
  robots.content = value;
}

function renderMuseumDirectory(container, records) {
  records.forEach((record) => container.append(createMuseumDirectoryCard(record)));
  if (records.length === 0) {
    container.append(textElement("p", "More public displays will appear here as they are published.", "museum-directory-empty"));
  }
}

function createMuseumDirectoryCard(record, featured = false) {
  const link = document.createElement("a");
  link.className = `museum-directory-card ${featured ? "featured" : ""} type-${record.exhibitType}`;
  link.href = exhibitHref(record.id);
  link.setAttribute("aria-label", `${record.exhibitType === "collection" ? "Browse collection" : "Enter exhibit"}: ${record.title}`);

  const preview = document.createElement("span");
  preview.className = "museum-directory-preview";
  selectFeaturedArtifacts(record.exhibit, featured ? 4 : 3).forEach((artifact) => {
    const frame = document.createElement("span");
    frame.className = `museum-directory-object kind-${presentationKind(artifact)}`;
    mountArtifactMedia(frame, {
      artifact,
      image: artifact.images[0],
      src: museumImageUrl(record, artifact.images[0]),
      alt: "",
    });
    preview.append(frame);
  });

  const mapSlots = record.exhibit.mapExperience?.slots;
  const represented = mapSlots?.filter((slot) => slot.artifactId).length ?? 0;
  const typeLabel = mapSlots
    ? "Evolving map exhibition"
    : record.exhibitType === "collection" ? "Collection catalog" : "Curated exhibition";
  const actionLabel = mapSlots
    ? `${represented} of ${mapSlots.length} colonies · Explore map →`
    : `${record.exhibit.artifacts.length} objects · ${record.exhibitType === "collection" ? "Browse collection" : "Enter exhibit"} →`;
  const copy = document.createElement("span");
  copy.className = "museum-directory-copy";
  copy.append(
    textElement("span", typeLabel, "museum-directory-type"),
    textElement("h3", record.title),
    textElement("p", record.summary ?? record.exhibit.summary),
    textElement("span", actionLabel, "museum-directory-action"),
  );
  link.append(preview, copy);
  return link;
}

function exhibitHref(exhibitId, artifactId = null) {
  const url = new URL(`exhibits/${exhibitId}/`, MUSEUM_ROOT_URL);
  if (artifactId) url.searchParams.set("object", artifactId);
  return url.href;
}

function updateObjectUrl(objectId = null) {
  const url = new URL(location.href);
  if (objectId) url.searchParams.set("object", objectId);
  else url.searchParams.delete("object");
  history.replaceState(null, "", url);
}
function museumImageUrl(record, image) {
  return new URL(image.src, record.url).href;
}

function openRequestedObject(objectId) {
  if (!objectId || !SAFE_EXHIBIT.test(objectId)) return;
  const index = exhibit.artifacts.findIndex((artifact) => artifact.id === objectId);
  if (index >= 0) openArtifact(index);
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
    for (const image of artifact.images) {
      if (image?.presentation?.objectRegion && !objectRegion(image)) {
        throw new Error(`Artifact ${artifact.id} has an invalid object region.`);
      }
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
  if (value.mapExperience) validateMapExperience(value.mapExperience, artifactIds);
  if (value.featuredArtifactIds) {
    if (!Array.isArray(value.featuredArtifactIds)
      || value.featuredArtifactIds.length === 0
      || value.featuredArtifactIds.length > 4
      || new Set(value.featuredArtifactIds).size !== value.featuredArtifactIds.length
      || value.featuredArtifactIds.some((id) => !artifactIds.has(id))) {
      throw new Error("The featured artifact selection is invalid.");
    }
  }
}

function validateMapExperience(value, artifactIds) {
  if (!value.map || !/^images\/[a-z0-9-]+\.(?:jpg|png|webp)$/.test(value.map.src ?? "")) {
    throw new Error("The exhibit map is incomplete.");
  }
  if (!Array.isArray(value.slots) || value.slots.length === 0) {
    throw new Error("The exhibit map has no colony slots.");
  }
  const ids = new Set();
  for (const slot of value.slots) {
    if (!SAFE_EXHIBIT.test(slot.id ?? "") || ids.has(slot.id) || !slot.label) {
      throw new Error("A colony map slot is incomplete or duplicated.");
    }
    ids.add(slot.id);
    for (const coordinate of [slot.x, slot.y, slot.markerX ?? slot.x, slot.markerY ?? slot.y]) {
      if (typeof coordinate !== "number" || !Number.isFinite(coordinate) || coordinate < 0 || coordinate > 100) {
        throw new Error(`Colony map slot ${slot.id} has an invalid position.`);
      }
    }
    if (slot.artifactId && !artifactIds.has(slot.artifactId)) {
      throw new Error(`Colony map slot ${slot.id} references an unknown public artifact.`);
    }
  }
  for (const artifactId of value.relatedArtifactIds ?? []) {
    if (!artifactIds.has(artifactId)) {
      throw new Error(`The colony map references an unknown related artifact: ${artifactId}`);
    }
  }
}

function renderColonyMapExhibit() {
  document.body.dataset.exhibitType = "map";
  const fragment = colonyMapTemplate.content.cloneNode(true);
  const mapExperience = exhibit.mapExperience;
  const represented = mapExperience.slots.filter((slot) => slot.artifactId);

  setAll(fragment, "kicker", exhibit.kicker ?? "ArchiveSense · Evolving exhibition");
  setAll(fragment, "title", exhibit.title);
  setAll(fragment, "summary", exhibit.summary);
  setAll(fragment, "introduction", exhibit.introduction);
  setAll(fragment, "represented-count", `${represented.length} of ${mapExperience.slots.length}`);
  setAll(
    fragment,
    "related-introduction",
    mapExperience.interpretation?.relatedIntroduction
      ?? "Objects kept beside the checklist reveal colonial worlds the later national frame leaves out.",
  );
  setAll(
    fragment,
    "published-at",
    exhibit.publishedAt ? `Published ${formatDate(exhibit.publishedAt)}` : "",
  );

  const progress = fragment.querySelector(".colony-map-progress");
  progress.style.setProperty("--collection-progress", `${(represented.length / mapExperience.slots.length) * 360}deg`);
  const mapImage = fragment.querySelector(".colony-map-image");
  mapImage.src = new URL(mapExperience.map.src, exhibitUrl).href;
  mapImage.alt = mapExperience.map.alt;
  const credit = fragment.querySelector(".colony-map-credit");
  credit.href = mapExperience.map.sourceUrl;
  credit.textContent = `${mapExperience.map.credit} ↗`;

  renderColonyMapPoints(fragment.querySelector(".colony-map-points"));
  renderColonyMapList(fragment.querySelector(".colony-map-list"));
  renderCurrencyInterpretation(fragment, mapExperience.interpretation);
  renderRelatedMapArtifacts(fragment.querySelector(".colony-related-grid"));
  const relatedSection = fragment.querySelector(".colony-related");
  relatedSection.hidden = (mapExperience.relatedArtifactIds ?? []).length === 0;

  gallery.replaceChildren(fragment);
  activeMapSlotId = represented[0]?.id ?? mapExperience.slots[0].id;
  selectMapSlot(activeMapSlotId);
  setHeaderStatus("Evolving map exhibition");
  setStage("room");

  requestAnimationFrame(() => {
    const scroller = gallery.querySelector(".colony-map-scroll");
    if (scroller.scrollWidth > scroller.clientWidth) {
      scroller.scrollLeft = Math.max(0, scroller.scrollWidth * 0.43 - scroller.clientWidth * 0.35);
    }
  });
}

function renderCurrencyInterpretation(fragment, interpretation) {
  const rail = fragment.querySelector(".currency-info-rail");
  const drawer = fragment.querySelector(".currency-info-drawer");
  if (!interpretation) {
    rail.hidden = true;
    return;
  }

  for (const [index, concept] of (interpretation.concepts ?? []).entries()) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "currency-info-tab";
    button.dataset.infoIndex = String(index);
    button.setAttribute("aria-label", concept.title);
    button.title = concept.title;
    button.textContent = concept.tab ?? String(index + 1).padStart(2, "0");
    button.addEventListener("click", () => openCurrencyInfoCard(concept, button));
    rail.append(button);
  }
  drawer.querySelector(".currency-info-close").addEventListener("click", closeCurrencyInfoCard);
}

function appendParagraphs(container, paragraphs = []) {
  for (const paragraph of paragraphs ?? []) container.append(textElement("p", paragraph));
}

function createFactList(facts = []) {
  const list = document.createElement("dl");
  list.className = "currency-facts";
  for (const fact of facts ?? []) {
    list.append(textElement("dt", fact.label), textElement("dd", fact.text));
  }
  return list;
}

function openCurrencyInfoCard(content, sourceButton) {
  const drawer = gallery.querySelector(".currency-info-drawer");
  const card = drawer.querySelector(".currency-info-card");
  card.replaceChildren(
    textElement("p", content.eyebrow ?? "How to read the money", "currency-info-eyebrow"),
    textElement("h3", content.title),
  );
  appendParagraphs(card, content.paragraphs);
  if (content.facts?.length) card.append(createFactList(content.facts));
  if (content.callout) card.append(textElement("blockquote", content.callout));
  if (content.snapshot) {
    card.append(textElement("h4", content.snapshot.title));
    card.append(createFactList(content.snapshot.facts));
  }
  if (content.reading?.paragraphs?.length) {
    card.append(textElement("h4", content.reading.title ?? "Read the note"));
    appendParagraphs(card, content.reading.paragraphs);
  }
  if (content.lookClosely) {
    card.append(textElement("h4", "Look closely"), textElement("p", content.lookClosely));
  }
  if (content.collectingGoal) card.append(textElement("p", content.collectingGoal, "currency-info-goal"));

  gallery.querySelectorAll(".currency-info-tab, .colony-story-action").forEach((button) => {
    button.classList.toggle("active", button === sourceButton);
  });
  drawer.hidden = false;
  drawer.querySelector(".currency-info-close").focus({ preventScroll: true });
}

function closeCurrencyInfoCard() {
  const drawer = gallery.querySelector(".currency-info-drawer");
  if (!drawer) return;
  drawer.hidden = true;
  gallery.querySelectorAll(".currency-info-tab, .colony-story-action").forEach((button) => {
    button.classList.remove("active");
  });
}

function renderColonyMapPoints(container) {
  for (const slot of exhibit.mapExperience.slots) {
    const markerX = slot.markerX ?? slot.x;
    const markerY = slot.markerY ?? slot.y;
    const artifact = slot.artifactId ? artifactById(slot.artifactId) : null;
    const anchor = document.createElement("span");
    anchor.className = `colony-location-anchor ${artifact ? "represented" : "open"}`;
    anchor.style.left = `${slot.x}%`;
    anchor.style.top = `${slot.y}%`;
    anchor.setAttribute("aria-hidden", "true");
    container.append(anchor);

    if (markerX !== slot.x || markerY !== slot.y) {
      container.append(createColonyLeader(slot.x, slot.y, markerX, markerY, Boolean(artifact)));
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = `colony-map-marker ${artifact ? "represented" : "open"}`;
    button.dataset.slotId = slot.id;
    button.style.left = `${markerX}%`;
    button.style.top = `${markerY}%`;
    button.setAttribute(
      "aria-label",
      artifact ? `Inspect the ${slot.label} object: ${artifact.title}` : `${slot.label}: left to collect`,
    );

    if (artifact) {
      const specimen = document.createElement("span");
      specimen.className = "colony-marker-specimen";
      mountArtifactMedia(specimen, {
        artifact,
        image: artifact.images[0],
        src: imageUrl(artifact.images[0]),
        alt: "",
      });
      button.append(specimen, textElement("span", slot.label, "colony-marker-label"));
      button.addEventListener("click", () => {
        selectMapSlot(slot.id);
        openArtifact(findArtifactIndex(artifact.id));
      });
    } else {
      button.append(
        textElement("span", "+", "colony-marker-plus"),
        textElement("span", slot.label, "colony-marker-label"),
      );
      button.addEventListener("click", () => selectMapSlot(slot.id));
    }
    container.append(button);
  }
}

function createColonyLeader(x, y, markerX, markerY, represented) {
  const mapAspect = 2941 / 1997;
  const dx = markerX - x;
  const dy = (markerY - y) / mapAspect;
  const line = document.createElement("span");
  line.className = `colony-map-leader ${represented ? "represented" : "open"}`;
  line.style.left = `${x}%`;
  line.style.top = `${y}%`;
  line.style.width = `${Math.hypot(dx, dy)}%`;
  line.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
  line.setAttribute("aria-hidden", "true");
  return line;
}

function renderColonyMapList(container) {
  for (const slot of exhibit.mapExperience.slots) {
    const artifact = slot.artifactId ? artifactById(slot.artifactId) : null;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `colony-list-item ${artifact ? "represented" : "open"}`;
    button.dataset.slotId = slot.id;
    button.append(
      textElement("span", artifact ? "Collected" : "Open", "colony-list-state"),
      textElement("strong", slot.label),
      textElement("span", artifact ? artifact.date?.label ?? "In the collection" : "Representative still to collect", "colony-list-note"),
    );
    button.addEventListener("click", () => selectMapSlot(slot.id));
    container.append(button);
  }
}

function selectMapSlot(slotId) {
  const slot = exhibit.mapExperience.slots.find((item) => item.id === slotId);
  if (!slot) return;
  activeMapSlotId = slot.id;
  gallery.querySelectorAll("[data-slot-id]").forEach((element) => {
    const active = element.dataset.slotId === slot.id;
    element.classList.toggle("active", active);
    if (element.matches("button")) element.setAttribute("aria-pressed", active ? "true" : "false");
  });
  renderColonyMapDetail(slot);
}

function renderColonyMapDetail(slot) {
  const container = gallery.querySelector(".colony-map-detail");
  const artifact = slot.artifactId ? artifactById(slot.artifactId) : null;
  container.replaceChildren();

  if (!artifact) {
    const count = exhibit.mapExperience.slots.filter((item) => !item.artifactId).length;
    container.className = "colony-map-detail open";
    container.append(
      textElement("p", "Open collecting goal", "colony-detail-status"),
      textElement("h3", slot.label),
      textElement(
        "p",
        slot.story?.collectingGoal
          ?? `No representative has been selected yet. This open position remains visible alongside ${count - 1} other gaps in the current collection.`,
        "colony-detail-copy",
      ),
    );
    if (slot.story) container.append(createColonyStoryAction(slot));
    return;
  }

  container.className = "colony-map-detail represented";
  const media = document.createElement("div");
  media.className = "colony-detail-media";
  mountArtifactMedia(media, {
    artifact,
    image: artifact.images[0],
    src: imageUrl(artifact.images[0]),
    alt: artifact.images[0].alt,
  });
  const copy = document.createElement("div");
  copy.className = "colony-detail-record";
  copy.append(
    textElement("p", `${slot.label} · In the collection`, "colony-detail-status"),
    textElement("h3", artifact.title),
    textElement("p", artifact.subtitle ?? artifact.description ?? "", "colony-detail-copy"),
  );
  const action = document.createElement("button");
  action.type = "button";
  action.className = "colony-detail-action";
  action.textContent = "Examine the object →";
  action.addEventListener("click", () => openArtifact(findArtifactIndex(artifact.id)));
  copy.append(action);
  if (slot.story) copy.append(createColonyStoryAction(slot));
  container.append(media, copy);
}

function createColonyStoryAction(slot) {
  const action = document.createElement("button");
  action.type = "button";
  action.className = "colony-detail-action colony-story-action";
  action.textContent = slot.artifactId ? "Read its monetary story →" : "Read the colony story →";
  action.addEventListener("click", () => openCurrencyInfoCard({
    ...slot.story,
    eyebrow: `${slot.label} · ${slot.artifactId ? "Collected example" : "Open collecting goal"}`,
    title: slot.story.subtitle,
  }, action));
  return action;
}

function renderRelatedMapArtifacts(container) {
  for (const artifactId of exhibit.mapExperience.relatedArtifactIds ?? []) {
    const artifact = artifactById(artifactId);
    if (!artifact) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "colony-related-card";
    const media = document.createElement("span");
    media.className = "colony-related-media";
    mountArtifactMedia(media, {
      artifact,
      image: artifact.images[0],
      src: imageUrl(artifact.images[0]),
      alt: artifact.images[0].alt,
    });
    const copy = document.createElement("span");
    copy.className = "colony-related-copy";
    copy.append(
      textElement("span", artifact.origin ?? "Beyond the thirteen colonies", "colony-related-origin"),
      textElement("strong", artifact.title),
      textElement("span", artifact.subtitle ?? "Explore the wider colonial monetary world."),
      textElement("span", "Examine object →", "colony-related-action"),
    );
    button.append(media, copy);
    button.addEventListener("click", () => openArtifact(findArtifactIndex(artifact.id)));
    container.append(button);
  }
}

function artifactById(id) {
  return exhibit.artifacts.find((artifact) => artifact.id === id);
}

function renderCollectionExhibit() {
  document.body.dataset.exhibitType = "collection";
  const fragment = collectionTemplate.content.cloneNode(true);
  setAll(fragment, "kicker", exhibit.kicker ?? "ArchiveSense · Collection catalog");
  setAll(fragment, "title", exhibit.title);
  setAll(fragment, "summary", exhibit.summary);
  setAll(fragment, "introduction", exhibit.introduction);
  setAll(fragment, "artifact-count", `${exhibit.artifacts.length} objects`);
  setAll(
    fragment,
    "published-at",
    exhibit.publishedAt ? `Published ${formatDate(exhibit.publishedAt)}` : "",
  );
  const heroPreview = fragment.querySelector(".collection-hero-preview");
  const catalogLink = fragment.querySelector(".collection-catalog-link");
  renderCollectionHero(heroPreview);
  renderCollectionGrid(fragment.querySelector(".collection-grid"));
  renderCollectionJump(fragment.querySelector("#collection-object-select"));
  heroPreview.addEventListener("click", scrollToCollectionCatalog);
  catalogLink.addEventListener("click", scrollToCollectionCatalog);
  gallery.replaceChildren(fragment);

  setHeaderStatus("Collection catalog");
  setStage("room");
}

function scrollToCollectionCatalog() {
  const heading = gallery.querySelector("#collection-catalog-title");
  gallery.querySelector(".collection-catalog").scrollIntoView({
    behavior: reducedMotion() ? "auto" : "smooth",
    block: "start",
  });
  heading.setAttribute("tabindex", "-1");
  heading.focus({ preventScroll: true });
}
function renderCollectionHero(container) {
  for (const artifact of exhibit.artifacts.slice(0, 4)) {
    const frame = document.createElement("span");
    frame.className = `collection-preview-object kind-${presentationKind(artifact)}`;
    mountArtifactMedia(frame, {
      artifact,
      image: artifact.images[0],
      src: imageUrl(artifact.images[0]),
      alt: "",
    });
    container.append(frame);
  }
}

function renderCollectionGrid(container) {
  exhibit.artifacts.forEach((artifact, index) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "collection-card";
    card.id = `artifact-${artifact.id}`;
    card.dataset.artifactId = artifact.id;
    card.setAttribute("aria-label", `Inspect ${artifact.title}`);

    const frame = document.createElement("span");
    frame.className = `collection-card-image kind-${presentationKind(artifact)}`;
    mountArtifactMedia(frame, {
      artifact,
      image: artifact.images[0],
      src: imageUrl(artifact.images[0]),
      alt: artifact.images[0].alt,
    });
    frame.append(
      textElement("span", pad(index + 1), "collection-card-number"),
      textElement(
        "span",
        `${artifact.images.length} ${artifact.images.length === 1 ? "view" : "views"}`,
        "collection-card-views",
      ),
    );

    const copy = document.createElement("span");
    copy.className = "collection-card-copy";
    copy.append(
      textElement("span", artifact.tags?.[1] ?? "Collection object", "collection-card-type"),
      textElement("h3", artifact.title),
    );
    if (artifact.description) {
      copy.append(textElement("span", artifact.description, "collection-card-description"));
    }
    copy.append(textElement("span", "View object →", "collection-card-action"));
    card.append(frame, copy);
    card.addEventListener("click", () => openArtifact(index));
    container.append(card);
  });
}

function renderCollectionJump(selector) {
  exhibit.artifacts.forEach((artifact, index) => {
    const option = document.createElement("option");
    option.value = artifact.id;
    option.textContent = `${pad(index + 1)} · ${artifact.title}`;
    selector.append(option);
  });
  selector.addEventListener("change", () => {
    const card = gallery.querySelector(`.collection-card[data-artifact-id="${selector.value}"]`);
    if (!card) return;
    card.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "center" });
    card.focus({ preventScroll: true });
  });
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
  setHeaderStatus("Curated exhibition");

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
  for (const artifact of selectFeaturedArtifacts(exhibit, 3)) {
    const mount = document.createElement("span");
    mount.className = `preview-object kind-${presentationKind(artifact)}`;
    mountArtifactMedia(mount, {
      artifact,
      image: artifact.images[0],
      src: imageUrl(artifact.images[0]),
      alt: "",
    });
    container.append(mount);
  }
}

function selectFeaturedArtifacts(value, limit) {
  const byId = new Map(value.artifacts.map((artifact) => [artifact.id, artifact]));
  const selected = (value.featuredArtifactIds ?? []).map((id) => byId.get(id)).filter(Boolean);
  for (const artifact of value.artifacts) {
    if (selected.length >= limit) break;
    if (!selected.includes(artifact)) selected.push(artifact);
  }
  return selected.slice(0, limit);
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
  const objects = groupArtifacts(group).map((artifact) => ({
    artifact,
    image: artifact.images[0],
  }));
  const columns = Math.min(5, Math.max(1, objects.length));
  const rows = Math.max(1, Math.ceil(objects.length / columns));
  const slotCount = objects.length;
  tray.dataset.layout = `${columns}x${rows}`;
  tray.style.setProperty("--tray-columns", String(columns));
  tray.style.setProperty("--tray-rows", String(rows));
  tray.style.setProperty("--tray-slot-size", `${Math.max(22, 88 / rows)}cqh`);
  for (const { artifact, image } of objects) {
    tray.append(createObjectButton(artifact, image, "coin-recess"));
  }
  while (tray.childElementCount < slotCount) {
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
  mountArtifactMedia(button, {
    artifact,
    image,
    src: imageUrl(image),
    alt: image.alt,
  });
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
    imageFrame.classList.add(`kind-${presentationKind(artifact)}`);
    mountArtifactMedia(imageFrame, {
      artifact,
      image: artifact.images[0],
      src: imageUrl(artifact.images[0]),
      alt: artifact.images[0].alt,
    });
    imageFrame.append(textElement("span", pad(index + 1), "object-card-number"));
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
    mountArtifactMedia(thumbnail, {
      artifact,
      image: artifact.images[0],
      src: imageUrl(artifact.images[0]),
      alt: "",
    });
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
  inspectionView = preferredInspectionView(exhibit.artifacts[index].images[0]);
  renderDialog();
  setStage("object");
  updateObjectUrl(exhibit.artifacts[index].id);
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
  renderArtifactContext(artifact);
  renderDialogImage();
  updateArtifactSequence();
}

function renderArtifactContext(artifact) {
  const section = document.querySelector("#dialog-context");
  const links = document.querySelector("#dialog-context-links");
  const identity = artifact.objectId ?? artifact.id;
  links.replaceChildren();

  for (const record of museumExhibits.values()) {
    if (record.id === exhibit.id) continue;
    for (const appearance of record.exhibit.artifacts) {
      if ((appearance.objectId ?? appearance.id) !== identity) continue;
      const link = document.createElement("a");
      link.href = exhibitHref(record.id, appearance.id);
      const label = document.createElement("span");
      label.textContent = record.exhibitType === "collection" ? "Full collection" : "Curated exhibition";
      const title = document.createElement("strong");
      title.textContent = record.title;
      const action = document.createElement("span");
      action.textContent = record.exhibitType === "collection"
        ? "View this object in its collection →"
        : "See this object in the exhibition →";
      link.append(label, title, action);
      links.append(link);
    }
  }

  section.hidden = links.childElementCount === 0;
}
function updateArtifactSequence() {
  const previous = document.querySelector("#artifact-previous");
  const next = document.querySelector("#artifact-next");
  const position = document.querySelector("#artifact-position");
  const previousArtifact = exhibit.artifacts[activeArtifact - 1];
  const nextArtifact = exhibit.artifacts[activeArtifact + 1];

  previous.disabled = !previousArtifact;
  next.disabled = !nextArtifact;
  previous.setAttribute(
    "aria-label",
    previousArtifact ? `Previous object: ${previousArtifact.title}` : "No previous object",
  );
  next.setAttribute("aria-label", nextArtifact ? `Next object: ${nextArtifact.title}` : "No next object");
  position.textContent = `${activeArtifact + 1} of ${exhibit.artifacts.length}`;
}

function stepArtifact(delta) {
  const nextIndex = activeArtifact + delta;
  if (nextIndex < 0 || nextIndex >= exhibit.artifacts.length) return;
  activeArtifact = nextIndex;
  activeImage = 0;
  inspectionView = preferredInspectionView(exhibit.artifacts[nextIndex].images[0]);
  renderDialog();
  updateObjectUrl(exhibit.artifacts[nextIndex].id);
}

function renderDialogImage() {
  const artifact = exhibit.artifacts[activeArtifact];
  const selectedImage = artifact.images[activeImage];
  const kind = presentationKind(artifact);
  const inspector = document.querySelector(".image-inspector");
  if (inspectionView === "object" && !hasObjectView(selectedImage)) inspectionView = "photo";
  const media = document.querySelector("#dialog-media");
  mountArtifactMedia(media, {
    artifact,
    image: selectedImage,
    src: imageUrl(selectedImage),
    alt: selectedImage.alt,
    mode: inspectionView,
    loading: "eager",
    onReady: ({ aspect }) => inspector.style.setProperty("--inspection-aspect", String(aspect)),
  });
  inspector.dataset.view = inspectionView;
  inspector.dataset.kind = kind;
  document.querySelector("#object-view").classList.toggle("active", inspectionView === "object");
  document.querySelector("#object-view").setAttribute("aria-pressed", inspectionView === "object" ? "true" : "false");
  document.querySelector("#photo-view").classList.toggle("active", inspectionView === "photo");
  document.querySelector("#photo-view").setAttribute("aria-pressed", inspectionView === "photo" ? "true" : "false");
  document.querySelector("#object-view").hidden = !hasObjectView(selectedImage);
  const selectedRegion = objectRegion(selectedImage);
  const completeComposition = selectedRegion
    && selectedRegion.x === 0
    && selectedRegion.y === 0
    && selectedRegion.width === 100
    && selectedRegion.height === 100;
  document.querySelector("#inspection-note").textContent = completeComposition
    ? "Complete composition · full photograph preserved"
    : selectedRegion
      ? "Exact object crop · full photograph preserved"
      : hasObjectView(selectedImage)
        ? "Curated object focus · full photograph preserved"
        : "Full source photograph";
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
    mountArtifactMedia(button, {
      artifact,
      image: item,
      src: imageUrl(item),
      alt: "",
      mode: hasObjectView(item) ? "object" : "photo",
    });
    button.addEventListener("click", () => {
      activeImage = index;
      renderDialogImage();
    });
    thumbnails.append(button);
  });

  const hasMultiple = artifact.images.length > 1;
  const nextImage = artifact.images[(activeImage + 1) % artifact.images.length];
  document.querySelector("#image-previous").hidden = !hasMultiple;
  document.querySelector("#image-next").hidden = !hasMultiple;
  document.querySelector("#turn-object").hidden = !hasMultiple
    || inspectionView !== "object"
    || !hasObjectView(nextImage);
  thumbnails.hidden = !hasMultiple;
  resetObjectTilt();
}

function stepImage(delta) {
  const count = exhibit.artifacts[activeArtifact].images.length;
  activeImage = (activeImage + delta + count) % count;
  renderDialogImage();
}

function openFullResolutionImage() {
  if (!dialog.open) return;
  const artifact = exhibit.artifacts[activeArtifact];
  const selectedImage = artifact.images[activeImage];
  const caption = [selectedImage.caption, selectedImage.credit].filter(Boolean).join(" · ");

  document.querySelector("#image-lightbox-title").textContent = artifact.title;
  document.querySelector("#image-lightbox-caption").textContent = caption;
  imageLightboxImage.alt = selectedImage.alt ?? artifact.title;
  imageLightboxImage.onload = prepareFullResolutionImage;
  imageLightboxImage.src = imageUrl(selectedImage);
  imageLightbox.showModal();

  if (imageLightboxImage.complete && imageLightboxImage.naturalWidth) {
    requestAnimationFrame(prepareFullResolutionImage);
  }
  imageLightboxViewport.focus();
}

function prepareFullResolutionImage() {
  lightboxScale = 1;
  lightboxX = 0;
  lightboxY = 0;
  requestAnimationFrame(() => {
    const availableWidth = Math.max(1, imageLightboxViewport.clientWidth - 32);
    const availableHeight = Math.max(1, imageLightboxViewport.clientHeight - 32);
    const fitScale = Math.min(
      1,
      availableWidth / imageLightboxImage.naturalWidth,
      availableHeight / imageLightboxImage.naturalHeight,
    );
    lightboxBaseWidth = imageLightboxImage.naturalWidth * fitScale;
    lightboxBaseHeight = imageLightboxImage.naturalHeight * fitScale;
    imageLightboxImage.style.width = `${lightboxBaseWidth}px`;
    imageLightboxImage.style.height = `${lightboxBaseHeight}px`;
    lightboxActualScale = Math.max(1, Math.min(64, 1 / fitScale));
    lightboxMaxScale = Math.max(8, lightboxActualScale);
    document.querySelector("#image-lightbox-dimensions").textContent =
      `${imageLightboxImage.naturalWidth.toLocaleString()} × ${imageLightboxImage.naturalHeight.toLocaleString()} px`;
    applyLightboxTransform();
  });
}

function setLightboxScale(nextScale, focalX = null, focalY = null) {
  const previousScale = lightboxScale;
  lightboxScale = Math.max(1, Math.min(lightboxMaxScale, nextScale));
  if (focalX !== null && focalY !== null && previousScale > 0) {
    const bounds = imageLightboxViewport.getBoundingClientRect();
    const cursorX = focalX - bounds.left - bounds.width / 2;
    const cursorY = focalY - bounds.top - bounds.height / 2;
    const imageX = (cursorX - lightboxX) / previousScale;
    const imageY = (cursorY - lightboxY) / previousScale;
    lightboxX = cursorX - imageX * lightboxScale;
    lightboxY = cursorY - imageY * lightboxScale;
  }
  clampLightboxPan();
  applyLightboxTransform();
}

function setLightboxFit() {
  lightboxScale = 1;
  lightboxX = 0;
  lightboxY = 0;
  applyLightboxTransform();
}

function setLightboxActualSize() {
  setLightboxScale(lightboxActualScale);
}

function clampLightboxPan() {
  const width = imageLightboxViewport.clientWidth;
  const height = imageLightboxViewport.clientHeight;
  const maxX = Math.max(0, (lightboxBaseWidth * lightboxScale - width) / 2);
  const maxY = Math.max(0, (lightboxBaseHeight * lightboxScale - height) / 2);
  lightboxX = Math.max(-maxX, Math.min(maxX, lightboxX));
  lightboxY = Math.max(-maxY, Math.min(maxY, lightboxY));
}

function applyLightboxTransform() {
  imageLightboxImage.style.transform = `translate3d(${lightboxX}px, ${lightboxY}px, 0) scale(${lightboxScale})`;
  imageLightboxViewport.classList.toggle("can-pan", lightboxScale > 1);
  const zoomLabel = document.querySelector("#image-lightbox-zoom");
  if (Math.abs(lightboxScale - 1) < 0.01) zoomLabel.textContent = "Fit";
  else if (Math.abs(lightboxScale - lightboxActualScale) < 0.02) zoomLabel.textContent = "100%";
  else zoomLabel.textContent = `${Math.round(lightboxScale * 100)}%`;
  document.querySelector("#image-lightbox-zoom-out").disabled = lightboxScale <= 1;
  document.querySelector("#image-lightbox-zoom-in").disabled = lightboxScale >= lightboxMaxScale;
}

function handleLightboxWheel(event) {
  event.preventDefault();
  const factor = Math.exp(-event.deltaY * 0.0015);
  setLightboxScale(lightboxScale * factor, event.clientX, event.clientY);
}

function beginLightboxPan(event) {
  if (lightboxScale <= 1 || event.button !== 0) return;
  lightboxDrag = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    imageX: lightboxX,
    imageY: lightboxY,
  };
  imageLightboxViewport.setPointerCapture(event.pointerId);
  imageLightboxViewport.classList.add("is-panning");
}

function continueLightboxPan(event) {
  if (!lightboxDrag || lightboxDrag.pointerId !== event.pointerId) return;
  lightboxX = lightboxDrag.imageX + event.clientX - lightboxDrag.startX;
  lightboxY = lightboxDrag.imageY + event.clientY - lightboxDrag.startY;
  clampLightboxPan();
  applyLightboxTransform();
}

function endLightboxPan(event) {
  if (!lightboxDrag || lightboxDrag.pointerId !== event.pointerId) return;
  lightboxDrag = null;
  imageLightboxViewport.classList.remove("is-panning");
}

function handleLightboxKeydown(event) {
  const panStep = event.shiftKey ? 100 : 40;
  if (event.key === "+" || event.key === "=") setLightboxScale(lightboxScale * 1.35);
  else if (event.key === "-") setLightboxScale(lightboxScale / 1.35);
  else if (event.key === "0" || event.key.toLowerCase() === "f") setLightboxFit();
  else if (event.key === "1") setLightboxActualSize();
  else if (event.key === "ArrowLeft") lightboxX += panStep;
  else if (event.key === "ArrowRight") lightboxX -= panStep;
  else if (event.key === "ArrowUp") lightboxY += panStep;
  else if (event.key === "ArrowDown") lightboxY -= panStep;
  else return;
  event.preventDefault();
  clampLightboxPan();
  applyLightboxTransform();
}

document.querySelector("#dialog-close").addEventListener("click", () => dialog.close());
document.querySelector("#artifact-previous").addEventListener("click", () => stepArtifact(-1));
document.querySelector("#artifact-next").addEventListener("click", () => stepArtifact(1));
document.querySelector("#image-previous").addEventListener("click", () => stepImage(-1));
document.querySelector("#image-next").addEventListener("click", () => stepImage(1));
document.querySelector("#turn-object").addEventListener("click", () => stepImage(1));
document.querySelector("#object-view").addEventListener("click", () => setInspectionView("object"));
document.querySelector("#photo-view").addEventListener("click", () => setInspectionView("photo"));
document.querySelector("#image-stage").addEventListener("pointermove", tiltObject);
document.querySelector("#image-stage").addEventListener("pointerleave", resetObjectTilt);
document.querySelector("#dialog-media").addEventListener("click", openFullResolutionImage);
document.querySelector("#dialog-media").addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  openFullResolutionImage();
});
document.querySelector("#image-lightbox-close").addEventListener("click", () => imageLightbox.close());
document.querySelector("#image-lightbox-fit").addEventListener("click", setLightboxFit);
document.querySelector("#image-lightbox-actual").addEventListener("click", setLightboxActualSize);
document.querySelector("#image-lightbox-zoom-out").addEventListener("click", () => setLightboxScale(lightboxScale / 1.35));
document.querySelector("#image-lightbox-zoom-in").addEventListener("click", () => setLightboxScale(lightboxScale * 1.35));
imageLightboxViewport.addEventListener("wheel", handleLightboxWheel, { passive: false });
imageLightboxViewport.addEventListener("pointerdown", beginLightboxPan);
imageLightboxViewport.addEventListener("pointermove", continueLightboxPan);
imageLightboxViewport.addEventListener("pointerup", endLightboxPan);
imageLightboxViewport.addEventListener("pointercancel", endLightboxPan);
imageLightboxViewport.addEventListener("dblclick", (event) => {
  if (lightboxScale > 1) setLightboxFit();
  else setLightboxScale(Math.min(lightboxActualScale, 3), event.clientX, event.clientY);
});
imageLightbox.addEventListener("keydown", handleLightboxKeydown);
imageLightbox.addEventListener("click", (event) => {
  if (event.target === imageLightbox) imageLightbox.close();
});
imageLightbox.addEventListener("close", () => {
  lightboxDrag = null;
  imageLightboxViewport.classList.remove("is-panning");
});
window.addEventListener("resize", () => {
  if (!imageLightbox.open) return;
  prepareFullResolutionImage();
});
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});
dialog.addEventListener("close", () => {
  updateObjectUrl();
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

function setInspectionView(view) {
  const artifact = exhibit.artifacts[activeArtifact];
  const image = artifact.images[activeImage];
  inspectionView = view === "object" && hasObjectView(image) ? "object" : "photo";
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
