import { mountArtifactMedia } from "/museum/object-media.js";

const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const directory = document.querySelector("#museum-program-list");

loadMuseumProgram();
wireAccessForm();

async function loadMuseumProgram() {
  try {
    const indexResponse = await fetch("/museum/exhibits/index.json");
    if (!indexResponse.ok) throw new Error(`Museum index returned ${indexResponse.status}`);
    const index = await indexResponse.json();
    const entries = Array.isArray(index?.exhibits)
      ? index.exhibits.filter((entry) => SAFE_ID.test(entry?.id) && entry?.title)
      : [];
    if (entries.length === 0) throw new Error("Museum index is empty");

    const records = (await Promise.all(entries.map(loadMuseumRecord))).filter(Boolean);
    if (records.length === 0) throw new Error("Museum records are unavailable");

    const curated = records.filter((record) => record.entry.exhibitType !== "collection");
    const collections = records.filter((record) => record.entry.exhibitType === "collection");
    const ordered = [...curated, ...collections];
    directory.replaceChildren(...ordered.map(createMuseumCard));
    renderFeaturedHero(records.find((record) => record.entry.id === "money-before-the-mint"));

    document.querySelector("#collection-count").textContent = String(collections.length);
    document.querySelector("#exhibition-count").textContent = String(curated.length);
    document.querySelector("#object-count").textContent = String(
      records.reduce((total, record) => total + record.exhibit.artifacts.length, 0),
    );
  } catch (error) {
    const fallback = document.createElement("a");
    fallback.className = "museum-loading";
    fallback.href = "/museum/";
    fallback.textContent = "Open the museum directory to browse current collections and exhibitions →";
    directory.replaceChildren(fallback);
    console.warn("The homepage museum directory could not be loaded.", error);
  }
}

function renderFeaturedHero(record) {
  if (!record) return;
  const featuredIds = record.exhibit.featuredArtifactIds ?? [];
  const featured = [
    [".hero-map", featuredIds[1] ?? "north-carolina-forty-shillings-1754"],
    [".hero-coin", featuredIds[0] ?? "gelderland-lion-dollar-1641"],
    [".hero-note", featuredIds[2] ?? "spanish-eight-reales"],
  ];

  for (const [selector, artifactId] of featured) {
    const container = document.querySelector(selector);
    const artifact = record.exhibit.artifacts.find((item) => item.id === artifactId);
    const image = artifact?.images?.[0];
    if (!container || !image) continue;
    container.replaceChildren();
    mountArtifactMedia(container, {
      artifact,
      image,
      src: `/museum/exhibits/${encodeURIComponent(record.entry.id)}/${image.src}`,
      alt: selector === ".hero-map" ? image.alt || artifact.title : "",
      loading: "eager",
    });
  }
}

async function loadMuseumRecord(entry) {
  try {
    const response = await fetch(`/museum/exhibits/${entry.id}/exhibit.json`);
    if (!response.ok) throw new Error(`Exhibit returned ${response.status}`);
    const exhibit = await response.json();
    if (!Array.isArray(exhibit?.artifacts) || exhibit.artifacts.length === 0) return null;
    const artifact = exhibit.artifacts.find((item) => item?.images?.[0]?.src);
    if (!artifact) return null;
    return { entry, exhibit, artifact };
  } catch (error) {
    console.warn(`Skipping unavailable museum entry: ${entry.id}`, error);
    return null;
  }
}

function createMuseumCard(record) {
  const { entry, exhibit, artifact } = record;
  const isCollection = entry.exhibitType === "collection";
  const link = document.createElement("a");
  link.className = `museum-program-card ${isCollection ? "is-collection" : "is-curated"}`;
  link.href = `/museum/exhibits/${encodeURIComponent(entry.id)}/`;
  link.setAttribute("aria-label", `${isCollection ? "Browse collection" : "Enter exhibition"}: ${entry.title}`);

  const preview = document.createElement("span");
  preview.className = "museum-card-preview";
  mountArtifactMedia(preview, {
    artifact,
    image: artifact.images[0],
    src: `/museum/exhibits/${encodeURIComponent(entry.id)}/${artifact.images[0].src}`,
    alt: artifact.images[0].alt || artifact.title || "",
  });

  const copy = document.createElement("span");
  copy.className = "museum-card-copy";
  copy.append(
    textElement("span", isCollection ? "Collection catalog" : "Curated exhibition", "museum-card-type"),
    textElement("span", `${exhibit.artifacts.length} ${exhibit.artifacts.length === 1 ? "object" : "objects"}`, "museum-card-count"),
    textElement("h3", entry.title),
    textElement("p", entry.summary || exhibit.summary || "Explore this public ArchiveSense collection."),
    textElement("span", `${isCollection ? "Browse the collection" : "Enter the exhibition"} →`, "museum-card-action"),
  );

  link.append(preview, copy);
  return link;
}

function textElement(tag, value, className) {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = value;
  return element;
}

function wireAccessForm() {
  const form = document.querySelector("#access-form");
  const status = document.querySelector("#access-status");
  if (!form || !status) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector("button");
    button.disabled = true;
    status.textContent = "Sending your request…";

    try {
      await fetch(form.action, { method: "POST", body: new FormData(form), mode: "no-cors" });
      form.reset();
      status.textContent = "Thank you. We’ll be in touch with an invitation to test ArchiveSense.";
    } catch (error) {
      status.textContent = "We couldn’t send that request. Please try again in a moment.";
      console.warn("The access request could not be sent.", error);
    } finally {
      button.disabled = false;
    }
  });
}
