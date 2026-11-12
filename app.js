(() => {
  const $ = (s) => document.querySelector(s);
  const grid = $("#appsGrid"), empty = $("#emptyState");
  const search = $("#searchInput"), sort = $("#sortSelect");
  $("#heroCount").textContent = `${APPS.length} aplikasi terdaftar`;
  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
  }
  function openAppCard(card) {
    const url = card?.dataset?.url;
    if (!url) return;
    window.location.href = url;
  }

  function render() {
    const q = search.value.trim().toLowerCase();
    let list = APPS.filter(a => [a.name, a.description, a.category].join(" ").toLowerCase().includes(q));
    if (sort.value === "az") list.sort((a,b) => a.name.localeCompare(b.name));
    if (sort.value === "newest") list.sort((a,b) => (b.updated || "").localeCompare(a.updated || ""));
    if (sort.value === "featured") list.sort((a,b) => Number(!!b.featured) - Number(!!a.featured) || a.name.localeCompare(b.name));
    $("#resultCount").textContent = list.length;
    grid.innerHTML = list.map((a, i) => `<article id="${escapeHtml(a.id)}" class="app-card${a.url ? " is-clickable" : " is-unavailable"}" tabindex="${a.url ? 0 : -1}" data-url="${escapeHtml(a.url || "")}" style="--delay:${i * 45}ms">
      <div class="card-top"><div class="app-icon ${escapeHtml(a.color || "blue")}">${escapeHtml(a.icon || "✳")}</div></div>
      <div class="card-category">${escapeHtml(a.category || "Other")}${a.featured ? '<span class="featured-tag">FEATURED</span>' : ""}</div>
      <h3>${escapeHtml(a.name)}</h3><p>${escapeHtml(a.description)}</p>
      </article>`).join("");
    empty.hidden = list.length !== 0; grid.hidden = list.length === 0;
  }

  grid.addEventListener("click", e => {
    const card = e.target.closest(".app-card.is-clickable");
    if (!card) return;
    openAppCard(card);
  });

  grid.addEventListener("keydown", e => {
    const card = e.target.closest(".app-card.is-clickable");
    if (!card) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openAppCard(card);
    }
  });

  search.addEventListener("input", render);
  sort.addEventListener("change", render);
  document.addEventListener("keydown", e => {
    if (e.key === "/" && !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) { e.preventDefault(); search.focus(); }
    if (e.key === "Escape") search.blur();
  });
  render();
})();
