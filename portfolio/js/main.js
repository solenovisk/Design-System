const TYPE_LABELS = {
  hostinger: "Hostinger",
  subdominio: "Subdomínio",
  externo: "Externo",
};

const state = {
  sites: [],
  categories: [],
  category: "todos",
  tipo: "todos",
  search: "",
};

const els = {
  loading: document.getElementById("loading"),
  rows: document.getElementById("rows"),
  grid: document.getElementById("grid"),
  empty: document.getElementById("empty"),
  categoryFilters: document.getElementById("categoryFilters"),
  typeFilter: document.getElementById("typeFilter"),
  searchInput: document.getElementById("searchInput"),
};

init();

async function init() {
  bindFilterEvents();
  await loadSites();
}

async function loadSites() {
  try {
    const response = await fetch("data/sites.json");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    state.sites = data.filter((site) => site.ativo);
  } catch (error) {
    console.error("Erro ao carregar sites:", error);
    state.sites = [];
  }

  state.categories = [...new Set(state.sites.map((site) => site.categoria || "Sem Categoria"))];
  renderCategoryChips();
  render();
}

function bindFilterEvents() {
  els.typeFilter.addEventListener("change", (event) => {
    state.tipo = event.target.value;
    render();
  });

  els.searchInput.addEventListener("input", (event) => {
    state.search = event.target.value.trim().toLowerCase();
    render();
  });
}

function renderCategoryChips() {
  els.categoryFilters.innerHTML = "";

  const allChip = createChip("Todos", "todos");
  els.categoryFilters.appendChild(allChip);

  state.categories.forEach((category) => {
    els.categoryFilters.appendChild(createChip(category, category));
  });
}

function createChip(label, value) {
  const button = document.createElement("button");
  button.className = "chip" + (state.category === value ? " chip--active" : "");
  button.textContent = label;
  button.dataset.category = value;
  button.addEventListener("click", () => {
    state.category = value;
    document
      .querySelectorAll("#categoryFilters .chip")
      .forEach((chip) => chip.classList.toggle("chip--active", chip.dataset.category === value));
    render();
  });
  return button;
}

function getFilteredSites() {
  return state.sites.filter((site) => {
    if (state.category !== "todos" && (site.categoria || "Sem Categoria") !== state.category) return false;
    if (state.tipo !== "todos" && site.tipo !== state.tipo) return false;
    if (state.search && !site.nome.toLowerCase().includes(state.search)) return false;
    return true;
  });
}

function isFilterActive() {
  return state.category !== "todos" || state.tipo !== "todos" || state.search !== "";
}

function render() {
  els.loading.hidden = true;

  if (state.sites.length === 0) {
    els.rows.hidden = true;
    els.grid.hidden = true;
    els.empty.hidden = false;
    return;
  }

  if (isFilterActive()) {
    renderGrid();
  } else {
    renderRows();
  }
}

function renderRows() {
  els.grid.hidden = true;
  els.rows.hidden = false;
  els.rows.innerHTML = "";

  let hasContent = false;

  state.categories.forEach((category) => {
    const sitesInCategory = state.sites.filter((site) => (site.categoria || "Sem Categoria") === category);
    if (sitesInCategory.length === 0) return;

    hasContent = true;

    const row = document.createElement("section");
    row.className = "row";

    const title = document.createElement("h2");
    title.className = "row__title";
    title.textContent = category;

    const track = document.createElement("div");
    track.className = "row__track";
    sitesInCategory.forEach((site) => track.appendChild(createCard(site)));

    row.appendChild(title);
    row.appendChild(track);
    els.rows.appendChild(row);
  });

  els.empty.hidden = hasContent;
}

function renderGrid() {
  els.rows.hidden = true;
  els.grid.hidden = false;
  els.grid.innerHTML = "";

  const filtered = getFilteredSites();

  if (filtered.length === 0) {
    els.empty.hidden = false;
    return;
  }

  els.empty.hidden = true;
  filtered.forEach((site) => els.grid.appendChild(createCard(site)));
}

function createCard(site) {
  const card = document.createElement("article");
  card.className = "card";
  card.addEventListener("click", () => window.open(site.url, "_blank"));

  const img = document.createElement("img");
  img.className = "card__image";
  img.loading = "lazy";
  img.alt = site.nome;
  img.src = `https://image.thum.io/get/width/600/${site.url}`;
  img.onerror = () => {
    const placeholder = document.createElement("div");
    placeholder.className = "card__placeholder";
    placeholder.textContent = "🌐";
    img.replaceWith(placeholder);
  };

  const overlay = document.createElement("div");
  overlay.className = "card__overlay";

  const name = document.createElement("p");
  name.className = "card__name";
  name.textContent = site.nome;

  const badges = document.createElement("div");
  badges.className = "card__badges";

  const typeBadge = document.createElement("span");
  typeBadge.className = `badge badge--${site.tipo}`;
  typeBadge.textContent = TYPE_LABELS[site.tipo] || site.tipo;

  const categoryBadge = document.createElement("span");
  categoryBadge.className = "badge badge--categoria";
  categoryBadge.textContent = site.categoria || "Sem Categoria";

  badges.appendChild(typeBadge);
  badges.appendChild(categoryBadge);
  overlay.appendChild(name);
  overlay.appendChild(badges);

  card.appendChild(img);
  card.appendChild(overlay);

  return card;
}
