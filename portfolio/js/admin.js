const STORAGE_KEY = "portfolio_sites";
const SESSION_KEY = "portfolio_admin_session";
const MOCK_PASSWORD = "admin"; // TODO: substituir por login.php (password_hash + sessão PHP)

const TYPE_LABELS = {
  hostinger: "Hostinger",
  subdominio: "Subdomínio",
  externo: "Externo",
};

let sites = [];

const els = {
  loginScreen: document.getElementById("loginScreen"),
  loginForm: document.getElementById("loginForm"),
  passwordInput: document.getElementById("passwordInput"),
  loginError: document.getElementById("loginError"),
  panel: document.getElementById("panel"),
  logoutBtn: document.getElementById("logoutBtn"),
  siteForm: document.getElementById("siteForm"),
  siteId: document.getElementById("siteId"),
  nomeInput: document.getElementById("nomeInput"),
  urlInput: document.getElementById("urlInput"),
  tipoInput: document.getElementById("tipoInput"),
  categoriaInput: document.getElementById("categoriaInput"),
  categoriaOptions: document.getElementById("categoriaOptions"),
  submitBtn: document.getElementById("submitBtn"),
  cancelEditBtn: document.getElementById("cancelEditBtn"),
  tableSearch: document.getElementById("tableSearch"),
  tableTypeFilter: document.getElementById("tableTypeFilter"),
  tableCategoryFilter: document.getElementById("tableCategoryFilter"),
  tableBody: document.getElementById("tableBody"),
  tableEmpty: document.getElementById("tableEmpty"),
};

init();

async function init() {
  bindLoginEvents();
  bindPanelEvents();

  if (sessionStorage.getItem(SESSION_KEY) === "true") {
    await showPanel();
  }
}

/* ------------------------------ */
/* Auth                            */
/* ------------------------------ */

function bindLoginEvents() {
  els.loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (els.passwordInput.value === MOCK_PASSWORD) {
      sessionStorage.setItem(SESSION_KEY, "true");
      els.loginError.hidden = true;
      els.passwordInput.value = "";
      await showPanel();
    } else {
      els.loginError.hidden = false;
    }
  });

  els.logoutBtn.addEventListener("click", () => {
    sessionStorage.removeItem(SESSION_KEY);
    els.panel.hidden = true;
    els.loginScreen.hidden = false;
  });
}

async function showPanel() {
  els.loginScreen.hidden = true;
  els.panel.hidden = false;
  await loadSites();
  renderCategoryOptions();
  renderTable();
}

/* ------------------------------ */
/* Data                            */
/* ------------------------------ */

async function loadSites() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    sites = JSON.parse(stored);
    return;
  }

  try {
    const response = await fetch("data/sites.json");
    sites = await response.json();
  } catch (error) {
    console.error("Erro ao carregar sites:", error);
    sites = [];
  }

  saveSites();
}

function saveSites() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sites));
}

/* ------------------------------ */
/* Form (add / edit)               */
/* ------------------------------ */

function bindPanelEvents() {
  els.siteForm.addEventListener("submit", (event) => {
    event.preventDefault();

    const data = {
      nome: els.nomeInput.value.trim(),
      url: els.urlInput.value.trim(),
      tipo: els.tipoInput.value,
      categoria: els.categoriaInput.value.trim(),
    };

    if (!data.nome || !data.url || !data.tipo || !data.categoria) return;

    const editingId = els.siteId.value;

    if (editingId) {
      const site = sites.find((item) => item.id === editingId);
      Object.assign(site, data);
    } else {
      sites.push({
        id: crypto.randomUUID(),
        ...data,
        ativo: true,
        criado_em: new Date().toISOString(),
      });
    }

    saveSites();
    resetForm();
    renderCategoryOptions();
    renderTable();
  });

  els.cancelEditBtn.addEventListener("click", resetForm);

  els.tableSearch.addEventListener("input", renderTable);
  els.tableTypeFilter.addEventListener("change", renderTable);
  els.tableCategoryFilter.addEventListener("change", renderTable);
}

function resetForm() {
  els.siteForm.reset();
  els.siteId.value = "";
  els.submitBtn.textContent = "Adicionar";
  els.cancelEditBtn.hidden = true;
}

function startEdit(site) {
  els.siteId.value = site.id;
  els.nomeInput.value = site.nome;
  els.urlInput.value = site.url;
  els.tipoInput.value = site.tipo;
  els.categoriaInput.value = site.categoria;
  els.submitBtn.textContent = "Salvar";
  els.cancelEditBtn.hidden = false;
  els.nomeInput.focus();
}

/* ------------------------------ */
/* Categories                      */
/* ------------------------------ */

function renderCategoryOptions() {
  const categories = [...new Set(sites.map((site) => site.categoria).filter(Boolean))].sort();

  els.categoriaOptions.innerHTML = categories
    .map((category) => `<option value="${escapeHtml(category)}"></option>`)
    .join("");

  const currentFilter = els.tableCategoryFilter.value;
  els.tableCategoryFilter.innerHTML =
    `<option value="todos">Todas as categorias</option>` +
    categories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("");
  els.tableCategoryFilter.value = categories.includes(currentFilter) ? currentFilter : "todos";
}

/* ------------------------------ */
/* Table                           */
/* ------------------------------ */

function renderTable() {
  const search = els.tableSearch.value.trim().toLowerCase();
  const tipo = els.tableTypeFilter.value;
  const categoria = els.tableCategoryFilter.value;

  const filtered = sites.filter((site) => {
    if (search && !site.nome.toLowerCase().includes(search)) return false;
    if (tipo !== "todos" && site.tipo !== tipo) return false;
    if (categoria !== "todos" && site.categoria !== categoria) return false;
    return true;
  });

  els.tableEmpty.hidden = filtered.length > 0;
  els.tableBody.innerHTML = "";

  filtered.forEach((site) => {
    const row = document.createElement("tr");

    row.innerHTML = `
      <td>${escapeHtml(site.nome)}</td>
      <td class="url-cell"><a href="${escapeHtml(site.url)}" target="_blank" rel="noopener">${escapeHtml(site.url)}</a></td>
      <td>${TYPE_LABELS[site.tipo] || escapeHtml(site.tipo)}</td>
      <td>${escapeHtml(site.categoria)}</td>
      <td>
        <button class="status-toggle ${site.ativo ? "status-toggle--on" : "status-toggle--off"}" data-action="toggle" data-id="${site.id}">
          ${site.ativo ? "Ativo" : "Inativo"}
        </button>
      </td>
      <td class="actions">
        <button class="btn btn--ghost btn--small" data-action="edit" data-id="${site.id}">Editar</button>
        <button class="btn btn--danger btn--small" data-action="delete" data-id="${site.id}">Excluir</button>
      </td>
    `;

    els.tableBody.appendChild(row);
  });

  els.tableBody.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => handleTableAction(button.dataset.action, button.dataset.id));
  });
}

function handleTableAction(action, id) {
  const site = sites.find((item) => item.id === id);
  if (!site) return;

  if (action === "toggle") {
    site.ativo = !site.ativo;
    saveSites();
    renderTable();
  } else if (action === "edit") {
    startEdit(site);
  } else if (action === "delete") {
    if (confirm(`Excluir "${site.nome}"?`)) {
      sites = sites.filter((item) => item.id !== id);
      saveSites();
      renderCategoryOptions();
      renderTable();
    }
  }
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}
