// ============================================================================
// GEJEMUZIK - Frontend (vanilla JS). Tanpa $$ (querySelectorAll pakai qa()).
// ============================================================================

const $ = (sel, root = document) => root.querySelector(sel)
const qa = (sel, root = document) => Array.from(root.querySelectorAll(sel))

// BASE_PATH (mis. "" untuk root, "/evo" untuk sub-path). Diisi server saat sajikan index.html.
const BASE = (typeof window !== "undefined" && typeof window.__BASE__ === "string") ? window.__BASE__ : ""
const U = (path) => BASE + (path.startsWith("/") ? path : "/" + path)

const state = {
  view: "create",
  models: [],
  uploadModels: [],
  geminiModels: [],
  songs: [],
  liked: [],
  selected: null,
  activeSrc: null,
  polls: new Map(),
  pollRetries: new Map(),
  lastLyricsInput: null,
  sortOrder: "newest", // "newest" | "oldest" | "title"
  searchQuery: "",
}

// ========================= THEME SYSTEM =========================
function getPreferredTheme() {
  const saved = localStorage.getItem("gejemuzik-theme")
  if (saved === "light" || saved === "dark") return saved
  // Auto-detect system preference
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"
}

function updateThemeLabels(theme) {
  const isLight = theme === "light"
  const icon = isLight ? "☀️" : "🌙"
  const label = isLight ? "Mode terang" : "Mode gelap"
  const toggle = isLight ? "🌙 Mode gelap" : "☀️ Mode terang"
  const btn1 = $("#theme-toggle-side")
  const btn2 = $("#theme-toggle-bn")
  const btn3 = $("#theme-toggle-set")
  if (btn1) btn1.innerHTML = icon + " " + label
  if (btn2) { btn2.innerHTML = '<span class="bn-ic">' + icon + '</span><span>' + label + '</span>' }
  if (btn3) btn3.innerHTML = toggle
  // Update meta theme-color
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.content = isLight ? "#ffffff" : "#0f0f14"
}


// ========================= SUNO-STYLE CREATE PAGE =========================
// Advanced options toggle (works for Create and Upload pages)
function initAdvancedOptionsToggle() {
  // Handle all advanced sections (Create and Upload pages)
  const advancedSections = document.querySelectorAll('.create-advanced')
  
  advancedSections.forEach(section => {
    const toggle = section.querySelector('.create-advanced-toggle')
    
    if (toggle) {
      toggle.addEventListener('click', () => {
        section.classList.toggle('expanded')
      })
    }
  })
}

// Style pills selection (multi-select)
function initStylePills() {
  const stylePills = qa('.style-pill')
  const mainPrompt = $('#f-style')
  
  stylePills.forEach(pill => {
    pill.addEventListener('click', () => {
      pill.classList.toggle('active')
      
      // Update main prompt with selected styles
      const selectedStyles = qa('.style-pill.active').map(p => p.dataset.style).join(', ')
      if (selectedStyles && mainPrompt) {
        const currentText = mainPrompt.value.trim()
        if (!currentText) {
          mainPrompt.value = `Lagu ${selectedStyles}`
        } else if (!currentText.toLowerCase().includes(selectedStyles.toLowerCase())) {
          mainPrompt.value = `${selectedStyles}, ${currentText}`
        }
      }
    })
  })
}

// Main prompt auto-resize and char counter
function initMainPromptResize() {
  const mainPrompt = $('.create-main-prompt textarea')
  const charCounter = $('#f-style-count')
  
  if (mainPrompt) {
    mainPrompt.addEventListener('input', function() {
      this.style.height = 'auto'
      this.style.height = Math.max(200, this.scrollHeight) + 'px'
      
      // Update char counter
      if (charCounter) {
        charCounter.textContent = this.value.length
      }
    })
  }
}

// ========================= UPLOAD PAGE INTERACTIONS =========================
// Upload drop zone drag & drop
function initUploadDropZone() {
  const dropZone = $('#upload-drop-zone')
  const fileInput = $('#u-file')
  const fileInfo = $('#upload-file-info')
  const fileName = $('#upload-file-name')
  const fileSize = $('#upload-file-size')
  const removeBtn = $('#upload-remove-file')
  
  if (!dropZone || !fileInput) return
  
  // Click to select file
  dropZone.addEventListener('click', () => fileInput.click())
  
  // Drag & drop events
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault()
    dropZone.classList.add('dragover')
  })
  
  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover')
  })
  
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault()
    dropZone.classList.remove('dragover')
    
    const files = e.dataTransfer.files
    if (files.length > 0) {
      fileInput.files = files
      showFileInfo(files[0])
    }
  })
  
  // File input change
  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      showFileInfo(e.target.files[0])
    }
  })
  
  // Remove file
  if (removeBtn) {
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      fileInput.value = ''
      hideFileInfo()
    })
  }
  
  function showFileInfo(file) {
    if (fileName) fileName.textContent = file.name
    if (fileSize) fileSize.textContent = formatFileSize(file.size)
    if (fileInfo) {
      fileInfo.classList.remove('hidden')
      dropZone.style.display = 'none'
    }
  }
  
  function hideFileInfo() {
    if (fileInfo) fileInfo.classList.add('hidden')
    dropZone.style.display = 'block'
  }
  
  function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  }
}

// Upload page char counters
function initUploadCharCounters() {
  const styleTextarea = $('#u-style')
  const styleCounter = $('#u-style-count')
  const promptTextarea = $('#u-prompt')
  const promptCounter = $('#u-prompt-count')
  
  if (styleTextarea && styleCounter) {
    styleTextarea.addEventListener('input', function() {
      styleCounter.textContent = this.value.length
    })
  }
  
  if (promptTextarea && promptCounter) {
    promptTextarea.addEventListener('input', function() {
      promptCounter.textContent = this.value.length
    })
  }
}

// Upload page style pills
function initUploadStylePills() {
  const uploadView = $('#view-upload')
  if (!uploadView) return
  
  const stylePills = qa('.upload-view .style-pill')
  const styleTextarea = $('#u-style')
  
  stylePills.forEach(pill => {
    pill.addEventListener('click', () => {
      pill.classList.toggle('active')
      
      const selectedStyles = qa('.upload-view .style-pill.active').map(p => p.dataset.style).join(', ')
      if (selectedStyles && styleTextarea) {
        const currentText = styleTextarea.value.trim()
        if (!currentText) {
          styleTextarea.value = `Ubah jadi ${selectedStyles}`
        } else if (!currentText.toLowerCase().includes(selectedStyles.toLowerCase())) {
          styleTextarea.value = `${selectedStyles}, ${currentText}`
        }
        // Trigger input event for char counter
        styleTextarea.dispatchEvent(new Event('input'))
      }
    })
  })
}



// ========================= LIBRARY PAGE STATS =========================
function updateLibraryStats() {
  const statTotal = $('#stat-total')
  const statCompleted = $('#stat-completed')
  const statProcessing = $('#stat-processing')

  if (!statTotal) return

  const total = state.songs.length
  const completed = state.songs.filter(s => s.status === 'success').length
  const processing = state.songs.filter(s => s.status === 'processing' || s.status === 'queued').length

  // Animate numbers
  if (statTotal) animateNumber(statTotal, total)
  if (statCompleted) animateNumber(statCompleted, completed)
  if (statProcessing) animateNumber(statProcessing, processing)
}

const _animTimers = new WeakMap()
function animateNumber(element, target) {
  if (!element) return
  const current = parseInt(element.textContent) || 0
  if (current === target) return

  // Cancel previous animation on this element
  const prev = _animTimers.get(element)
  if (prev) clearInterval(prev)

  const duration = 500
  const steps = 20
  const increment = (target - current) / steps
  const stepDuration = duration / steps

  let step = 0
  const timer = setInterval(() => {
    step++
    const value = Math.round(current + (increment * step))
    element.textContent = step === steps ? target : value

    if (step >= steps) { clearInterval(timer); _animTimers.delete(element) }
  }, stepDuration)
  _animTimers.set(element, timer)
}

// Update liked count badge
function updateLikedCount() {
  const likedCount = $('#liked-count')
  if (!likedCount) return
  
  const count = state.liked.length
  animateNumber(likedCount, count)
}


// ========================= GENERATE LIRIK PAGE INTERACTIONS =========================
function initLyricsPage() {
  // Char counters
  const themeInput = $('#l-theme')
  const themeCount = $('#l-theme-count')
  const extraInput = $('#l-extra')
  const extraCount = $('#l-extra-count')
  
  if (themeInput && themeCount) {
    themeInput.addEventListener('input', () => {
      themeCount.textContent = themeInput.value.length
    })
  }
  
  if (extraInput && extraCount) {
    extraInput.addEventListener('input', () => {
      extraCount.textContent = extraInput.value.length
    })
  }
  
  // Advanced toggle for lyrics page
  const lyricsAdvanced = $('.lyrics-advanced')
  if (lyricsAdvanced) {
    const advToggle = lyricsAdvanced.querySelector('.lyrics-advanced-toggle')
    const advContent = lyricsAdvanced.querySelector('.lyrics-advanced-content')
    
    if (advToggle && advContent) {
      advToggle.addEventListener('click', () => {
        advContent.classList.toggle('open')
      })
    }
  }
  
  // Quick pills
  const quickPills = document.querySelectorAll('.quick-pill')
  const genreInput = $('#l-genre')
  const moodInput = $('#l-mood')
  
  quickPills.forEach(pill => {
    pill.addEventListener('click', () => {
      const type = pill.dataset.type
      const value = pill.dataset.value
      
      // Toggle active state
      pill.classList.toggle('active')
      
      // Update corresponding input
      if (type === 'genre' && genreInput) {
        genreInput.value = pill.classList.contains('active') ? value : ''
      } else if (type === 'mood' && moodInput) {
        moodInput.value = pill.classList.contains('active') ? value : ''
      }
    })
  })
}


function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme)
  localStorage.setItem("gejemuzik-theme", theme)
  updateThemeLabels(theme)
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") || getPreferredTheme()
  setTheme(current === "light" ? "dark" : "light")
}

function initTheme() {
  const theme = getPreferredTheme()
  setTheme(theme)
  // Listen for system changes when no manual preference
  window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", (e) => {
    if (!localStorage.getItem("gejemuzik-theme")) {
      setTheme(e.matches ? "light" : "dark")
    }
  })
}

// ========================= FRONTPAGE =========================
function renderFrontpage(fp) {
  const fpTitle = $("#fp-title"); if (fpTitle) fpTitle.textContent = fp.title || "GEJEMUZIK"
  const fpSub = $("#fp-subtitle"); if (fpSub) fpSub.textContent = fp.subtitle || ""
  const fpDesc = $("#fp-description"); if (fpDesc) fpDesc.textContent = fp.description || ""
  const fpCta = $("#fp-cta"); if (fpCta) fpCta.textContent = fp.cta || "Mulai"
  const fpFooter = $("#fp-footer"); if (fpFooter) fpFooter.textContent = (fp.footer || "by Bangalimin").replace(/by\s+ulas/ig, "by Bangalimin")
  const fpBadge = $("#fp-badge"); if (fpBadge) fpBadge.textContent = "DARI IDE MENJADI MELODI"
  const feats = Array.isArray(fp.features) ? fp.features : []
  const html = feats.map((f) => `<div class="fp-feat"><span class="fp-fi">${escapeHtml(f.icon || "•")}</span> ${escapeHtml(f.text || "")}</div>`).join("")
  const fpFeats = $("#fp-features"); if (fpFeats) fpFeats.innerHTML = html || '<div class="fp-feat">🎵 GEJEMUZIK</div>'
}

async function loadFrontpage() {
  try {
    const fp = await api("/api/frontpage")
    renderFrontpage(fp)
    // The editor exists only on the separate administration page.
    if ($("#fp-ed-title")) {
    $("#fp-ed-title").value = fp.title || ""
    $("#fp-ed-subtitle").value = fp.subtitle || ""
    $("#fp-ed-desc").value = fp.description || ""
    $("#fp-ed-cta").value = fp.cta || ""
    $("#fp-ed-footer").value = (fp.footer || "by Bangalimin").replace(/by\s+ulas/ig, "by Bangalimin")
    const feats = Array.isArray(fp.features) ? fp.features : []
    $("#fp-ed-feats").value = feats.map((f) => (f.icon || "•") + "|" + (f.text || "")).join("\n")
    }
  } catch (e) { /* frontpage gagal load — pakai default */ }
  // Load blocks
  await renderBlocks()
  await loadBlockList()
}

// ========================= BLOK KONTEN =========================
function renderBlockOnFrontpage(block) {
  const c = block.content || {}
  if (block.type === "heading") {
    const level = c.level || "h2"
    const align = c.align || "center"
    const tag = level === "h4" ? "h4" : level === "h3" ? "h3" : "h2"
    return `<div class="blk blk-heading ${align}"><${tag}>${escapeHtml(c.text || "")}</${tag}></div>`
  }
  if (block.type === "divider") {
    const style = c.style || "line"
    return `<div class="blk blk-divider ${style}"></div>`
  }
  if (block.type === "text") {
    const align = c.align || "center"
    const size = c.size || "md"
    const text = escapeHtml(c.text || "").replace(/\n/g, "<br>")
    return `<div class="blk blk-text ${align} ${size}">${text}</div>`
  }
  if (block.type === "image") {
    const src = c.src || ""
    if (!src) return ""
    return `<div class="blk blk-image">
      <img src="${escapeHtml(src)}" alt="${escapeHtml(c.alt || "")}" loading="lazy" />
      ${c.caption ? `<div class="blk-cap">${escapeHtml(c.caption)}</div>` : ""}
    </div>`
  }
  if (block.type === "embed") {
    const url = c.url || ""
    if (!url) return ""
    let embedHtml = ""
    // YouTube (watch, shorts, embed, youtu.be)
    const yt = url.match(/(?:youtube\.com\/(?:watch\?.*v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/)
    if (yt) {
      embedHtml = `<div class="blk-resp-embed"><iframe src="https://www.youtube.com/embed/${yt[1]}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>`
    }
    // SoundCloud
    else if (url.includes("soundcloud.com")) {
      embedHtml = `<div class="blk-resp-embed sc"><iframe src="https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&color=%239d7bf5&auto_play=false&show_artwork=true" frameborder="0"></iframe></div>`
    }
    // TikTok
    else if (url.includes("tiktok.com")) {
      const tkId = url.match(/video\/(\d+)/)
      if (tkId) embedHtml = `<div class="blk-resp-embed tk"><iframe src="https://www.tiktok.com/embed/v2/${tkId[1]}" frameborder="0" allowfullscreen></iframe></div>`
      else embedHtml = `<div class="blk-resp-embed tk"><iframe src="${escapeHtml(url)}" frameborder="0" allowfullscreen></iframe></div>`
    }
    // Spotify
    else if (url.includes("spotify.com")) {
      const spPath = url.match(/spotify\.com\/(track|album|playlist|episode)\/([a-zA-Z0-9]+)/)
      if (spPath) embedHtml = `<div class="blk-resp-embed sp"><iframe src="https://open.spotify.com/embed/${spPath[1]}/${spPath[2]}" frameborder="0" allow="encrypted-media"></iframe></div>`
    }
    // Default: generic iframe
    else {
      embedHtml = `<div class="blk-resp-embed"><iframe src="${escapeHtml(url)}" frameborder="0" allowfullscreen></iframe></div>`
    }
    return `<div class="blk blk-embed">${embedHtml}${c.caption ? `<div class="blk-cap">${escapeHtml(c.caption)}</div>` : ""}</div>`
  }
  return ""
}

async function renderBlocks() {
  try {
    const { blocks } = await api("/api/blocks")
    const container = $("#fp-blocks")
    if (!blocks || !blocks.length) { container.innerHTML = ""; return }
    container.innerHTML = blocks.sort((a, b) => a.order - b.order).filter((b) => !b.hidden).map(renderBlockOnFrontpage).join("")
  } catch { /* blocks not available */ }
}

// Block editor
let blkEditingId = null // null = new block, string = editing existing

function renderBlockList(blocks) {
  const list = $("#blk-list")
  const empty = $("#blk-empty")
  if (!blocks || !blocks.length) { list.innerHTML = ""; empty.style.display = ""; return }
  empty.style.display = "none"
  list.innerHTML = blocks.map((b, i) => {
    const icons = { text: "📝", image: "🖼️", embed: "🔗", heading: "🔤", divider: "➖" }
    const labels = { text: (b.content?.text || "").slice(0, 40), image: (b.content?.alt || b.content?.src || "").slice(0, 40), embed: (b.content?.url || "").slice(0, 40), heading: (b.content?.text || "").slice(0, 40), divider: "—" }
    const icon = icons[b.type] || "📦"
    const label = labels[b.type] || b.type
    const first = i === 0
    const last = i === blocks.length - 1
    const hiddenCls = b.hidden ? " blk-item-hidden" : ""
    const eyeIcon = b.hidden ? "👁️‍🗨️" : "👁️"
    const eyeTitle = b.hidden ? "Tampilkan" : "Sembunyikan"
    return `<div class="blk-item${hiddenCls}" data-id="${b.id}">
      <span class="blk-icon">${icon}</span>
      <span class="blk-type">${b.type}</span>
      <span class="blk-label">${escapeHtml(label)}</span>
      ${b.hidden ? '<span class="blk-hidden-badge">hidden</span>' : ""}
      <span class="blk-acts">
        <button class="blk-up" title="Naik" ${first ? "disabled" : ""}>↑</button>
        <button class="blk-down" title="Turun" ${last ? "disabled" : ""}>↓</button>
        <button class="blk-toggle" title="${eyeTitle}">${eyeIcon}</button>
        <button class="blk-dup" title="Duplikat">📋</button>
        <button class="blk-edit" title="Edit">✎</button>
        <button class="blk-del danger" title="Hapus">✕</button>
      </span>
    </div>`
  }).join("")
  // Bind events
  qa(".blk-up", list).forEach((btn, i) => btn.addEventListener("click", () => moveBlock(i, i - 1)))
  qa(".blk-down", list).forEach((btn, i) => btn.addEventListener("click", () => moveBlock(i, i + 1)))
  qa(".blk-edit", list).forEach((btn, i) => btn.addEventListener("click", () => openBlockEditor(blocks[i])))
  qa(".blk-del", list).forEach((btn, i) => btn.addEventListener("click", () => deleteBlock(blocks[i].id)))
  qa(".blk-dup", list).forEach((btn, i) => btn.addEventListener("click", () => duplicateBlock(blocks[i].id)))
  qa(".blk-toggle", list).forEach((btn, i) => btn.addEventListener("click", () => toggleBlockVis(blocks[i].id)))
}

async function loadBlockList() {
  if (!$("#blk-list")) return
  try {
    const { blocks } = await api("/api/blocks")
    renderBlockList(blocks)
  } catch { renderBlockList([]) }
}

async function moveBlock(from, to) {
  const { blocks } = await api("/api/blocks")
  if (!blocks || from < 0 || to < 0 || to >= blocks.length) return
  const sorted = blocks.sort((a, b) => a.order - b.order)
  const ids = sorted.map((b) => b.id)
  // Swap positions
  ;[ids[from], ids[to]] = [ids[to], ids[from]]
  const { blocks: updated } = await api("/api/blocks/reorder", { method: "PUT", body: { ids } })
  renderBlockList(updated)
  renderBlocks()
}

async function deleteBlock(id) {
  if (!confirm("Hapus blok ini?")) return
  try {
    await api("/api/blocks/" + id, { method: "DELETE" })
    loadBlockList()
    renderBlocks()
  } catch (e) { toast(e.message, "error") }
}

async function duplicateBlock(id) {
  try {
    await api("/api/blocks/" + id + "/duplicate", { method: "POST" })
    loadBlockList()
    renderBlocks()
    toast("Blok diduplikat", "success")
  } catch (e) { toast(e.message, "error") }
}

async function toggleBlockVis(id) {
  try {
    await api("/api/blocks/" + id + "/toggle-visibility", { method: "POST" })
    loadBlockList()
    renderBlocks()
  } catch (e) { toast(e.message, "error") }
}

function openBlockEditor(block) {
  blkEditingId = block ? block.id : null
  const title = block ? "Edit Blok" : "Blok Baru"
  $("#blk-modal-title").textContent = title
  const type = block ? block.type : blkPendingType || "text"
  const c = block ? block.content || {} : { text: "", align: "center", size: "md", src: "", alt: "", caption: "", url: "", embedType: "url" }

  let body = ""
  if (type === "heading") {
    body = `<div class="blk-editor">
      <div class="form-row"><label>Teks Heading</label><input id="blk-e-text" type="text" value="${escapeHtml(c.text || "")}" placeholder="Judul Seksi" /></div>
      <div class="form-row"><label>Level</label><select id="blk-e-level"><option value="h2" ${(c.level || "h2") === "h2" ? "selected" : ""}>H2 (Besar)</option><option value="h3" ${c.level === "h3" ? "selected" : ""}>H3 (Sedang)</option><option value="h4" ${c.level === "h4" ? "selected" : ""}>H4 (Kecil)</option></select></div>
      <div class="form-row"><label>Alignment</label><select id="blk-e-align"><option value="left" ${c.align === "left" ? "selected" : ""}>Kiri</option><option value="center" ${(c.align || "center") === "center" ? "selected" : ""}>Tengah</option><option value="right" ${c.align === "right" ? "selected" : ""}>Kanan</option></select></div>
    </div>`
  } else if (type === "divider") {
    body = `<div class="blk-editor">
      <div class="form-row"><label>Gaya</label><select id="blk-e-style"><option value="line" ${(c.style || "line") === "line" ? "selected" : ""}>Garis</option><option value="dots" ${c.style === "dots" ? "selected" : ""}>Titik-titik</option><option value="space" ${c.style === "space" ? "selected" : ""}>Spasi kosong</option></select></div>
    </div>`
  } else if (type === "text") {
    body = `<div class="blk-editor">
      <div class="form-row"><label>Teks</label><textarea id="blk-e-text" rows="5">${escapeHtml(c.text || "")}</textarea></div>
      <div class="form-row"><label>Alignment</label><select id="blk-e-align"><option value="left" ${c.align === "left" ? "selected" : ""}>Kiri</option><option value="center" ${(c.align || "center") === "center" ? "selected" : ""}>Tengah</option><option value="right" ${c.align === "right" ? "selected" : ""}>Kanan</option></select></div>
      <div class="form-row"><label>Ukuran</label><select id="blk-e-size"><option value="sm" ${c.size === "sm" ? "selected" : ""}>Kecil</option><option value="md" ${(c.size || "md") === "md" ? "selected" : ""}>Sedang</option><option value="lg" ${c.size === "lg" ? "selected" : ""}>Besar</option></select></div>
    </div>`
  } else if (type === "image") {
    body = `<div class="blk-editor">
      <div class="form-row"><label>URL Gambar</label><input id="blk-e-src" type="text" value="${escapeHtml(c.src || "")}" placeholder="https://example.com/gambar.jpg" /></div>
      <div class="form-row" id="blk-e-preview-wrap"><img id="blk-e-preview" src="${escapeHtml(c.src || "")}" alt="" style="max-width:100%;max-height:160px;border-radius:8px;margin-top:4px;display:${c.src ? "block" : "none"}" onerror="this.style.display='none'" /></div>
      <div class="form-row"><label>Teks alternatif</label><input id="blk-e-alt" type="text" value="${escapeHtml(c.alt || "")}" /></div>
      <div class="form-row"><label>Keterangan (opsional)</label><input id="blk-e-caption" type="text" value="${escapeHtml(c.caption || "")}" /></div>
    </div>`
  } else if (type === "embed") {
    body = `<div class="blk-editor">
      <div class="form-row"><label>URL (YouTube / SoundCloud / TikTok / Spotify / dll)</label><input id="blk-e-url" type="text" value="${escapeHtml(c.url || "")}" placeholder="https://youtube.com/watch?v=..." /></div>
      <div class="form-row"><label>Keterangan (opsional)</label><input id="blk-e-caption" type="text" value="${escapeHtml(c.caption || "")}" /></div>
    </div>`
  }
  $("#blk-modal-body").innerHTML = body
  $("#blk-modal").classList.remove("hidden")
  // Live preview gambar
  const srcInput = $("#blk-e-src")
  const previewImg = $("#blk-e-preview")
  if (srcInput && previewImg) {
    srcInput.addEventListener("input", () => {
      const val = srcInput.value.trim()
      if (val) { previewImg.src = val; previewImg.style.display = "block" }
      else { previewImg.style.display = "none" }
    })
  }
}

let blkPendingType = "text"

function closeBlockEditor() {
  $("#blk-modal").classList.add("hidden")
  blkEditingId = null
}

async function saveBlockEditor() {
  const type = blkEditingId ? null : blkPendingType // new blocks know the type
  const body = {}
  // Read from form
  const eText = $("#blk-e-text")
  const eAlign = $("#blk-e-align")
  const eSize = $("#blk-e-size")
  const eLevel = $("#blk-e-level")
  const eStyle = $("#blk-e-style")
  const eSrc = $("#blk-e-src")
  const eAlt = $("#blk-e-alt")
  const eCaption = $("#blk-e-caption")
  const eUrl = $("#blk-e-url")

  if (eText) body.text = eText.value
  if (eAlign) body.align = eAlign.value
  if (eSize) body.size = eSize.value
  if (eLevel) body.level = eLevel.value
  if (eStyle) body.style = eStyle.value
  if (eSrc) body.src = eSrc.value
  if (eAlt) body.alt = eAlt.value
  if (eCaption) body.caption = eCaption.value
  if (eUrl) body.url = eUrl.value

  try {
    if (blkEditingId) {
      await api("/api/blocks/" + blkEditingId, { method: "PUT", body })
    } else {
      body.type = blkPendingType
      await api("/api/blocks", { method: "POST", body })
    }
    closeBlockEditor()
    loadBlockList()
    renderBlocks()
    toast("Blok tersimpan", "success")
  } catch (e) { toast(e.message, "error") }
}

// ------------------------------ Device/private storage ----------------------
function getClientId() {
  let id = localStorage.getItem("gjm_client")
  if (!id) {
    const rnd = (crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2))
    id = "c_" + rnd.replace(/[^a-zA-Z0-9._-]/g, "")
    localStorage.setItem("gjm_client", id)
  }
  // Cookie dipakai oleh audio stream/download yang tidak bisa mengirim custom header.
  document.cookie = "gjm_client=" + encodeURIComponent(id) + "; Path=/; Max-Age=31536000; SameSite=Lax; Secure"
  return id
}

// ------------------------------ API helper ----------------------------------
async function api(path, opts = {}) {
  const headers = { "X-GJM-Client": getClientId() }
  if (opts.body) headers["Content-Type"] = "application/json"
  const res = await fetch(U(path), {
    method: opts.method || "GET",
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
  let data = null
  try { data = await res.json() } catch { data = null }
  if (res.status === 413) throw new Error("File terlalu besar untuk dikirim sekaligus. Gunakan file di bawah 10 MB.")
  if (!res.ok) throw new Error((data && data.error) || ("HTTP " + res.status))
  return data
}

// ------------------------------ Toast ---------------------------------------
let toastTimer = null
function toast(msg, kind = "info") {
  const t = $("#toast")
  if (!t) return
  const safeKind = ["success", "error", "info", "warning"].includes(kind) ? kind : "info"
  const symbols = { success: "✓", error: "!", info: "i", warning: "!" }
  t.innerHTML = `<img class="pbm-toast-logo" src="${U("/icon-192.png")}" alt="pbmstudio"><span class="pbm-toast-symbol">${symbols[safeKind]}</span><span class="pbm-toast-message">${escapeHtml(msg)}</span><button class="pbm-toast-close" type="button" aria-label="Tutup notifikasi">×</button>`
  t.className = "toast pbm-toast " + safeKind
  t.setAttribute("role", safeKind === "error" ? "alert" : "status")
  const close = $(".pbm-toast-close", t)
  if (close) close.addEventListener("click", () => t.classList.add("hidden"), { once: true })
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => t.classList.add("hidden"), safeKind === "error" ? 6500 : 4200)
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>\"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]))
}
function statusLabel(s) {
  return { processing: "Memproses\u2026", queued: "Antre\u2026", success: "Selesai", failed: "Gagal" }[s] || s
}

// Waktu relatif singkat ala "10h ago" tapi berbahasa Indonesia ("10j lalu").
function timeAgo(ts) {
  if (!ts) return ""
  const diff = Math.max(0, Date.now() - ts)
  const min = Math.floor(diff / 60000)
  if (min < 1) return "Baru saja"
  if (min < 60) return min + "m lalu"
  const hr = Math.floor(min / 60)
  if (hr < 24) return hr + "j lalu"
  const day = Math.floor(hr / 24)
  if (day < 30) return day + "h lalu"
  const mo = Math.floor(day / 30)
  if (mo < 12) return mo + "bln lalu"
  return Math.floor(mo / 12) + "th lalu"
}

// Badge tipe lagu (Vokal/Instrumental) -- pengganti badge status mentah dari provider.
function typeBadgeHtml(s) {
  return s.type === "instrumental" ? '<span class="sc-type">\uD83C\uDFB9 Instrumental</span>' : '<span class="sc-type">\uD83C\uDFA4 Vokal</span>'
}

// Ambil src audio pertama yang tersedia dari sebuah lagu (untuk Putar/Unduh dari kartu).
function firstAudioSrc(s) {
  return s.audioUrl || (Array.isArray(s.tracks) && s.tracks[0] && s.tracks[0].audioUrl) || null
}

// ------------------------------ Navigasi ------------------------------------
function setView(view) {
  if (!view || !qa(".view").some(v => v.dataset.view === view)) return
  try { if(view !== "frontpage-admin") localStorage.setItem("pbm-last-view", view) } catch (_) {}
  state.view = view
  qa(".view").forEach((v) => v.classList.toggle("hidden", v.dataset.view !== view))
  qa(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.view === view))
  qa(".bn-item").forEach((b) => b.classList.toggle("active", b.dataset.view === view))
  // Sembunyikan topbar & bottom-nav di frontpage
  const isFp = view === "frontpage"
  const tb = $(".topbar")
  const bn = $(".bottom-nav")
  if (tb) tb.style.display = isFp ? "none" : ""
  if (bn) bn.style.display = isFp ? "none" : ""
  if (isFp) renderBlocks() // Refresh blocks setiap lihat frontpage
  if (view === "library") loadSongs(false).catch(() => {})
  if (view === "liked") loadSongs(true).catch(() => {})
  if (view === "settings") { loadKeys().catch(() => {}); loadUploadKeys().catch(() => {}); loadGeminiKeys().catch(() => {}); loadKieKeys().catch(() => {}); loadMusicApiKeys().catch(() => {}); loadCrunKeys().then(refreshLiveCrunCredits).catch(() => {}) }
  if (view === "mastering") populateMasteringSongSelect()
}

function segment(id, onChange) {
  const seg = $("#" + id)
  if (!seg) return
  qa("button", seg).forEach((btn) => {
    btn.addEventListener("click", () => {
      qa("button", seg).forEach((b) => b.classList.remove("active"))
      btn.classList.add("active")
      seg.dataset.value = btn.dataset.val
      if (onChange) onChange(btn.dataset.val)
    })
  })
}

// ------------------------------ Kredit --------------------------------------
async function refreshCredits() {
  try {
    const endpoints = ["/api/keys", "/api/upload-keys", "/api/kie-keys", "/api/musicapi-keys", "/api/crun-keys"]
    const results = await Promise.allSettled(endpoints.map((path) => api(path)))
    const connected = results.filter((r) => r.status === "fulfilled").map((r) => r.value || {})
    if (!connected.length) throw new Error("Semua endpoint kredit gagal")

    const totalCredits = connected.reduce((sum, item) => sum + Number(item.totalCredits || 0), 0)
    const totalKeys = connected.reduce((sum, item) => sum + Number(item.count || 0), 0)

    const desktopLabels = qa(".side-credits .cred span")
    if (desktopLabels[0]) desktopLabels[0].textContent = "Total kredit"
    if (desktopLabels[1]) desktopLabels[1].textContent = "API key"
    const mobileLabels = qa(".topbar .credits-label")
    if (mobileLabels[0]) mobileLabels[0].textContent = "Kredit"
    if (mobileLabels[1]) mobileLabels[1].textContent = "Key"

    const el1 = $("#credits-apiframe"); if (el1) el1.textContent = totalCredits
    const el2 = $("#credits-suno"); if (el2) el2.textContent = totalKeys
    const el3 = $("#credits-apiframe-m"); if (el3) el3.textContent = totalCredits
    const el4 = $("#credits-suno-m"); if (el4) el4.textContent = totalKeys
  } catch {
    ["#credits-apiframe", "#credits-suno", "#credits-apiframe-m", "#credits-suno-m"].forEach((id) => {
      const el = $(id); if (el) el.textContent = "—"
    })
  }
}

// ------------------------------ Model ---------------------------------------
async function loadModels() {
  const d = await api("/api/models")
  state.models = d.models || []
  state.uploadModels = d.uploadModels || []
  state.geminiModels = d.geminiModels || []
  $("#f-model").innerHTML = state.models.map((m) => `<option value="${m.id}">${escapeHtml(m.label)} \u00B7 ${m.credits} kredit</option>`).join("")
  updateCreateModelPill()
  renderUploadCoverModels()
  const lm = $("#l-model")
  if (lm) lm.innerHTML = state.geminiModels.map((m) => `<option value="${m.id}">${escapeHtml(m.label)}</option>`).join("")
}

// ------------------------------ Daftar lagu ---------------------------------
async function loadSongs(liked) {
  const d = await api("/api/songs" + (liked ? "?liked=true" : ""))
  if (liked) { state.liked = d.songs; renderSongs($("#liked-list"), d.songs) }
  else { state.songs = d.songs; renderSongs($("#library-list"), d.songs) }
  d.songs.forEach((s) => { if (s.status === "processing" || s.status === "queued") startPoll(s.id) })
}

function songCardHtml(s) {
  const cover = s.imageUrl || "/icon-192.png"
  const kind = s.isMastered ? "Mastering" : s.isUpload ? "Upload" : s.isExtend ? "Perpanjangan" : s.isCover ? "Aransemen" : s.provider === "kie" ? "KIE AI" : s.provider === "musicapi" ? "MusicAPI" : s.provider === "crun" ? "crun.ai" : (s.provider === "uploadcover" ? "sunoapi" : s.provider === "mastering" ? "Mastering" : "APIframe")
  const canPlay = s.status === "success" && Boolean(firstAudioSrc(s))
  const isFailed = s.status === "failed"
  const isBusy = s.status === "processing" || s.status === "queued"

  let statusLine = ""
  if (isBusy) {
    statusLine = `<div class="sc-status busy">\u23F3 ${statusLabel(s.status)}</div>`
  } else if (isFailed) {
    const reason = s.error || 'Gagal memproses. Klik "Ulang" untuk generate ulang.'
    statusLine = `<div class="sc-status err">\u26A0\uFE0F ${escapeHtml(reason)}</div>`
  }

  return `<div class="song-card" data-id="${s.id}">
    <div class="sc-cover" style="background-image:url('${cover}')">${s.liked ? '<span class="sc-like">\u2764\uFE0F</span>' : ""}</div>
    <div class="sc-body">
      <div class="sc-title">${escapeHtml(s.title)}</div>
      <div class="sc-sub">${escapeHtml(s.style || s.modelLabel || "")}</div>
      <div class="sc-foot">
        <span class="sc-kind">${kind}</span>
        ${typeBadgeHtml(s)}
        <span class="sc-time">${timeAgo(s.createdAt)}</span>
      </div>
      ${statusLine}
      <div class="sc-actions">
        <button class="sc-btn sc-play" data-act="play" ${canPlay ? "" : "disabled"} title="Putar">\u25B6\uFE0F Putar</button>
        <button class="sc-btn sc-dl" data-act="download" ${canPlay ? "" : "disabled"} title="Unduh">\u2B07\uFE0F Unduh</button>
        <button class="sc-btn sc-retry" data-act="retry" title="Generate ulang">\uD83D\uDD01 Ulang</button>
        <button class="sc-btn sc-del danger" data-act="delete" title="Hapus">\uD83D\uDDD1\uFE0F Hapus</button>
      </div>
    </div>
  </div>`
}
function renderSongs(root, songs) {
  if (!songs.length) { root.innerHTML = '<p class="empty">Belum ada lagu di sini.</p>'; return }
  // Filter by search query
  const q = state.searchQuery.toLowerCase().trim()
  if (q) {
    songs = songs.filter((s) =>
      (s.title || "").toLowerCase().includes(q) ||
      (s.style || "").toLowerCase().includes(q) ||
      (s.modelLabel || "").toLowerCase().includes(q)
    )
  }
  // Sort
  if (state.sortOrder === "oldest") songs = [...songs].sort((a, b) => a.createdAt - b.createdAt)
  else if (state.sortOrder === "title") songs = [...songs].sort((a, b) => (a.title || "").localeCompare(b.title || ""))
  else songs = [...songs].sort((a, b) => b.createdAt - a.createdAt) // newest default

  if (!songs.length && q) { root.innerHTML = '<p class="empty">Tidak ada lagu cocok dengan "' + escapeHtml(q) + '"</p>'; return }
  root.innerHTML = songs.map(songCardHtml).join("")
  qa(".song-card", root).forEach((c) => {
    const song = songs.find((s) => s.id === c.dataset.id)
    c.addEventListener("click", (e) => {
      if (e.target.closest(".sc-actions")) return
      openDetail(c.dataset.id)
    })
    qa(".sc-btn", c).forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation()
        if (btn.disabled || !song) return
        const act = btn.dataset.act
        if (act === "play") playCardSong(song)
        else if (act === "download") downloadCardSong(song)
        else if (act === "retry") retryCardSong(song)
        else if (act === "delete") deleteCardSong(song)
      })
    })
  })
}

// ------------------------------ Mini player (Putar dari kartu Library) ------
const miniAudio = new Audio()
let miniPlayingId = null
let miniPlaylist = [] // daftar lagu yang bisa diputar (urut sesuai tampilan)
let miniPlaylistIdx = -1

function updateMiniPlaylist() {
  // Ambil lagu yang bisa diputar dari state.songs (sesuai urutan render)
  let songs = [...state.songs].filter((s) => s.status === "success" && firstAudioSrc(s))
  if (state.sortOrder === "oldest") songs.sort((a, b) => a.createdAt - b.createdAt)
  else if (state.sortOrder === "title") songs.sort((a, b) => (a.title || "").localeCompare(b.title || ""))
  else songs.sort((a, b) => b.createdAt - a.createdAt)
  miniPlaylist = songs
}

function miniPlayerUI(song, playing) {
  const bar = $("#mini-player")
  if (!bar) return
  bar.classList.remove("hidden")
  const cov = $("#mp-cover"); if (cov) cov.src = song.imageUrl || U("/icon-192.png")
  const ti = $("#mp-title"); if (ti) ti.textContent = song.title || "(Tanpa judul)"
  const su = $("#mp-sub"); if (su) su.textContent = song.style || song.modelLabel || ""
  const playBtn = $("#mp-play")
  if (playBtn) playBtn.textContent = playing ? "⏸️" : "▶️"
}

function playCardSong(song) {
  if (!song) return
  const src = firstAudioSrc(song)
  if (!src) { toast("Audio belum siap", "error"); return }

  // Jika lagu yang sama sedang diputar → toggle pause/play
  if (miniPlayingId === song.id) {
    if (miniAudio.paused) {
      replayMiniAudio().catch(() => toast("Gagal memutar audio", "error"))
      miniPlayerUI(song, true)
    } else {
      miniAudio.pause()
      miniPlayerUI(song, false)
    }
    return
  }

  // Putar lagu baru
  miniAudio.src = U("/api/songs/" + song.id + "/stream?src=" + encodeURIComponent(src))
  miniAudio.play().catch(() => toast("Gagal memutar audio", "error"))
  miniPlayingId = song.id

  // Update playlist & cari index
  updateMiniPlaylist()
  miniPlaylistIdx = miniPlaylist.findIndex((s) => s.id === song.id)

  miniPlayerUI(song, true)
}

function playNextSong() {
  updateMiniPlaylist()
  if (!miniPlaylist.length) { stopMiniPlayer(); return }
  // Cari posisi saat ini
  let idx = miniPlaylist.findIndex((s) => s.id === miniPlayingId)
  idx = (idx + 1) % miniPlaylist.length // loop ke awal kalau sudah habis
  miniPlaylistIdx = idx
  const next = miniPlaylist[idx]
  if (next) {
    miniPlayingId = null // reset supaya playCardSong tidak toggle
    playCardSong(next)
  } else {
    stopMiniPlayer()
  }
}

function playPrevSong() {
  updateMiniPlaylist()
  if (!miniPlaylist.length) { stopMiniPlayer(); return }
  let idx = miniPlaylist.findIndex((s) => s.id === miniPlayingId)
  idx = idx <= 0 ? miniPlaylist.length - 1 : idx - 1
  miniPlaylistIdx = idx
  const prev = miniPlaylist[idx]
  if (prev) {
    miniPlayingId = null
    playCardSong(prev)
  } else {
    stopMiniPlayer()
  }
}

function replayMiniAudio() {
  if (miniAudio.ended || miniAudio.error) {
    const src = miniAudio.currentSrc || miniAudio.src
    miniAudio.src = src
    miniAudio.load()
  }
  return miniAudio.play()
}
function toggleMiniPlayPause() {
  if (!miniPlayingId) return
  if (miniAudio.paused) {
    replayMiniAudio().catch(() => toast("Gagal memutar audio", "error"))
    const song = (state.songs || []).find((s) => s.id === miniPlayingId)
    if (song) miniPlayerUI(song, true)
  } else {
    miniAudio.pause()
    const song = (state.songs || []).find((s) => s.id === miniPlayingId)
    if (song) miniPlayerUI(song, false)
  }
}

function stopMiniPlayer() {
  miniAudio.pause()
  miniAudio.removeAttribute("src")
  miniPlayingId = null
  miniPlaylistIdx = -1
  const bar = $("#mini-player")
  if (bar) bar.classList.add("hidden")
  const pb = $("#mp-progress-bar")
  if (pb) pb.style.width = "0%"
}

// Auto-play lagu berikutnya setelah lagu habis
miniAudio.addEventListener("ended", playNextSong)

// Update progress bar
miniAudio.addEventListener("timeupdate", () => {
  const pb = $("#mp-progress-bar")
  if (!pb || !miniAudio.duration) return
  const pct = (miniAudio.currentTime / miniAudio.duration) * 100
  pb.style.width = pct + "%"
})

// Bind tombol mini-player setelah DOM siap (dipanggil dari bindUI)
function bindMiniPlayerControls() {
  const playBtn = $("#mp-play")
  const nextBtn = $("#mp-next")
  const prevBtn = $("#mp-prev")
  const closeBtn = $("#mp-close")
  if (playBtn) playBtn.addEventListener("click", toggleMiniPlayPause)
  if (nextBtn) nextBtn.addEventListener("click", playNextSong)
  if (prevBtn) prevBtn.addEventListener("click", playPrevSong)
  if (closeBtn) closeBtn.addEventListener("click", stopMiniPlayer)
}

function downloadCardSong(song) {
  if (!song) return
  const src = firstAudioSrc(song)
  if (!src) { toast("Audio belum siap", "error"); return }
  toast("Menyiapkan unduhan\u2026", "info")
  window.open(U("/api/songs/" + song.id + "/download?src=" + encodeURIComponent(src)), "_blank")
}

// Generate ulang langsung dari kartu (tombol "Ulang") -- dipakai terutama saat status "failed".
async function retryCardSong(song) {
  if (!song) return
  try {
    const { song: updated } = await api("/api/songs/" + song.id + "/retry", { method: "POST" })
    toast("Generate ulang diproses\u2026", "success")
    updateSongInState(updated)
    if (state.selected && state.selected.id === updated.id) renderDetail(updated)
    refreshCredits()
    startPoll(updated.id)
  } catch (e) { toast(e.message, "error") }
}

async function deleteCardSong(song) {
  if (!song) return
  if (!confirm('Hapus lagu "' + (song.title || "") + '"?')) return
  try {
    await api("/api/songs/" + song.id, { method: "DELETE" })
    state.songs = state.songs.filter((s) => s.id !== song.id)
    state.liked = state.liked.filter((s) => s.id !== song.id)
    renderSongs($("#library-list"), state.songs)
    renderSongs($("#liked-list"), state.liked)
    if (miniPlayingId === song.id) stopMiniPlayer()
    toast("Lagu dihapus", "success")
  } catch (e) { toast(e.message, "error") }
}

// ------------------------------ Polling (max 150× = ~10 menit) --------------
const POLL_MAX = 150
const POLL_MS = 4000
function startPoll(id, key) {
  const k = key || id
  if (state.polls.has(k)) return
  state.pollRetries.set(k, 0)
  const tick = async () => {
    const tries = state.pollRetries.get(k) || 0
    if (tries >= POLL_MAX) { stopPoll(k); return }
    state.pollRetries.set(k, tries + 1)
    try {
      const data = await api("/api/songs/" + id)
      const song = data.song
      if (!song) { stopPoll(k); return }
      updateSongInState(song)
      if (Array.isArray(data.siblings)) data.siblings.forEach(updateSongInState)
      if (state.selected && state.selected.id === id) renderDetail(song)
      const done = song.status !== "processing" && song.status !== "queued"
      const stemDone = song.stemStatus !== "processing"
      const wavDone = song.wavStatus !== "processing"
      const videoDone = song.videoStatus !== "processing"
      if (done && stemDone && wavDone && videoDone) {
        stopPoll(k)
        await refreshCredits()
        if (song.status === "success") {
          const count = 1 + (Array.isArray(data.siblings) ? data.siblings.length : 0)
          toast(count > 1 ? count + " lagu berhasil dibuat" : `Lagu “${song.title || "Tanpa judul"}” berhasil dibuat`, "success")
        }
        else if (song.status === "failed") toast(song.error || "Generate lagu gagal", "error")
      }
    } catch { /* lanjut */ }
  }
  const timer = setInterval(tick, POLL_MS)
  state.polls.set(k, timer)
  tick()
}
function stopPoll(key) {
  const t = state.polls.get(key)
  if (t) { clearInterval(t); state.polls.delete(key) }
  state.pollRetries.delete(key)
}
function updateSongInState(song) {
  let found = false
  for (const arr of [state.songs, state.liked]) {
    const i = arr.findIndex((s) => s.id === song.id)
    if (i !== -1) { arr[i] = song; found = true }
  }
  if (!found) state.songs.unshift(song)
  // refresh kartu yang terlihat
  const card = $(`.song-card[data-id="${song.id}"]`)
  if (card) renderSongs(card.parentElement, card.parentElement === $("#liked-list") ? state.liked : state.songs)
  else if (state.view === "library") renderSongs($("#library-list"), state.songs)
}

// ------------------------------ Create UI helpers ---------------------------
function updateCreateModelPill() {
  const sel = $("#f-model")
  const pill = $("#create-model-pill")
  if (!sel || !pill) return
  const m = (state.models || []).find((x) => x.id === sel.value)
  pill.textContent = (m ? m.label : sel.value || "MODEL").replace(/Suno/i, "SUNO").toUpperCase()
}

function updateCreateCounts() {
  const pairs = [["f-title", "f-title-count"], ["f-lyrics", "f-lyrics-count"], ["f-style", "f-style-count"]]
  pairs.forEach(([inputId, countId]) => {
    const input = $("#" + inputId)
    const count = $("#" + countId)
    if (input && count) count.textContent = String(input.value.length)
  })
}

async function copyField(id) {
  const el = $("#" + id)
  if (!el) return
  const text = el.value || ""
  if (!text.trim()) { toast("Tidak ada teks untuk disalin", "error"); return }
  try {
    await navigator.clipboard.writeText(text)
    toast("Teks disalin", "success")
  } catch {
    el.focus(); el.select(); document.execCommand("copy")
    toast("Teks disalin", "success")
  }
}

function clearField(id) {
  const el = $("#" + id)
  if (!el) return
  el.value = ""
  updateCreateCounts()
  el.focus()
}

function clearCreateForm() {
  ["#f-title", "#f-style", "#f-lyrics"].forEach((id) => { const el = $(id); if (el) el.value = "" })
  updateCreateCounts()
  toast("Form create dibersihkan", "success")
}

function importLyricsToCreate() {
  const target = $("#f-lyrics")
  const result = $("#l-result")
  if (!target) return
  if (result && result.value.trim()) {
    target.value = result.value
    updateCreateCounts()
    toast("Lirik diimport", "success")
    return
  }
  toast("Belum ada lirik dari menu Generate Lirik", "error")
}

// ------------------------------ Buat lagu -----------------------------------
async function submitGenerate() {
  const btn = $("#btn-generate")
  btn.disabled = true
  $("#create-msg").textContent = ""
  try {
    const body = {
      title: $("#f-title").value.trim(),
      style: $("#f-style").value.trim(),
      lyrics: $("#f-lyrics").value,
      type: $("#f-type").dataset.value,
      vocalGender: $("#f-gender").dataset.value,
      model: $("#f-model").value,
      personaRef: window.pbmSelectedPersona?.("create") || null,
    }
    const { song } = await api("/api/songs", { method: "POST", body })
    toast("Lagu sedang dibuat\u2026", "success")
    $("#f-title").value = ""; $("#f-lyrics").value = ""
    updateCreateCounts()
    await refreshCredits()
    setView("library")
    startPoll(song.id)
    openDetail(song.id)
  } catch (e) {
    $("#create-msg").textContent = e.message
    toast(e.message, "error")
  } finally { btn.disabled = false }
}

// ------------------------------ Upload & cover ------------------------------
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = reject
    r.readAsDataURL(file)
  })
}
async function uploadCoverFile(file) {
  const chunkBytes = 1536 * 1024
  if (file.size <= 2 * 1024 * 1024) {
    const dataUrl = await fileToBase64(file)
    return { base64Data: String(dataUrl).replace(/^data:[^;]+;base64,/, "") }
  }
  const sessionId = crypto.randomUUID()
  const total = Math.ceil(file.size / chunkBytes)
  for (let index = 0; index < total; index++) {
    const piece = file.slice(index * chunkBytes, Math.min(file.size, (index + 1) * chunkBytes))
    const chunk = await blobToBase64(piece)
    await api("/api/upload-chunks", { method: "POST", body: { sessionId, index, total, fileName: file.name, chunk } })
    $("#upload-msg").textContent = "Mengunggah " + (index + 1) + "/" + total + "\u2026"
  }
  return { uploadSessionId: sessionId }
}
async function submitUpload() {
  const btn = $("#btn-upload")
  const file = $("#u-file").files[0]
  const provider = $("#u-provider")?.value || "sunoapi"
  
  if (!file) { 
    toast("Pilih file audio dulu", "error")
    return 
  }
  
  const style = $("#u-style").value.trim()
  if (!style) {
    toast("Gaya/genre baru wajib diisi", "error")
    return
  }
  
  if (file.size > 10 * 1024 * 1024) {
    toast("File maksimal 10 MB", "error")
    return
  }

  btn.disabled = true
  $("#upload-msg").textContent = "Mengunggah\u2026"
  
  try {
    const uploaded = await uploadCoverFile(file)
    const body = {
      ...uploaded,
      fileName: file.name,
      title: $("#u-title").value.trim(),
      style: style,
      prompt: $("#u-prompt").value.trim(),
      model: $("#u-model").value,
      instrumental: $("#u-instrumental").checked,
      provider: provider,
      personaRef: window.pbmSelectedPersona?.("upload") || null,
      vocalGender: $("#u-gender")?.value || "auto",
    }
    
    // Add optional parameters
    const audioWeight = $("#u-audio-weight")?.value
    if (audioWeight && !isNaN(parseFloat(audioWeight))) {
      body.audioWeight = parseFloat(audioWeight)
    }
    
    const negativeTags = $("#u-negative-tags")?.value.trim()
    if (negativeTags) {
      body.negativeTags = negativeTags
    }
    
    const { song } = await api("/api/upload-cover", { method: "POST", body })
    
    toast("Audio diunggah, aransemen diproses\u2026", "success")
    
    // Clear form
    $("#u-file").value = ""
    const fileInfo = $("#upload-file-info")
    if (fileInfo) fileInfo.classList.add("hidden")
    $("#u-title").value = ""
    $("#u-style").value = ""
    $("#u-prompt").value = ""
    $("#u-audio-weight").value = ""
    $("#u-negative-tags").value = ""
    $("#upload-msg").textContent = ""
    
    await refreshCredits()
    setView("library")
    startPoll(song.id)
    openDetail(song.id)
  } catch (e) {
    $("#upload-msg").textContent = e.message
    toast(e.message, "error")
  } finally { 
    btn.disabled = false 
  }
}

// ------------------------------ Detail modal --------------------------------
async function openDetail(id) {
  try {
    const data = await api("/api/songs/" + id)
    const song = data.song
    updateSongInState(song)
    if (Array.isArray(data.siblings)) data.siblings.forEach(updateSongInState)
    state.selected = song
    renderDetail(song)
    $("#detail").classList.remove("hidden")
    if (song.status === "processing" || song.status === "queued" || song.stemStatus === "processing" || song.wavStatus === "processing" || song.videoStatus === "processing") startPoll(id)
  } catch (e) { toast(e.message, "error") }
}
function closeDetail() {
  $("#detail").classList.add("hidden")
  const p = $("#player"); p.pause(); p.removeAttribute("src")
  state.selected = null
}
function setActiveTrack(src, imageUrl) {
  // Simpan URL asli untuk validasi download, tetapi putar audio lewat backend stream.
  // Ini menghindari provider/CDN yang memblokir hotlink langsung di <audio>.
  state.activeSrc = src || null
  const p = $("#player")
  if (src && state.selected) {
    p.src = U("/api/songs/" + state.selected.id + "/stream?src=" + encodeURIComponent(src))
  } else {
    p.removeAttribute("src")
  }
  const ok = Boolean(src) && state.selected && state.selected.status === "success"
  $("#btn-download").disabled = !ok
  if (imageUrl) $("#d-cover").src = imageUrl
}
function renderDetail(song) {
  state.selected = song
  const kind = song.isUpload ? "\uD83C\uDF99\uFE0F Upload & Cover" : song.isExtend ? "Perpanjangan" : song.isCover ? "\uD83C\uDFB8 Aransemen Ulang" : song.provider === "crun" ? "crun.ai" : (song.provider === "uploadcover" ? "sunoapi.org" : "APIframe")
  $("#d-kind").textContent = kind
  $("#d-title").textContent = song.title
  $("#d-style").textContent = song.style || song.modelLabel || ""
  $("#d-lyrics").textContent = song.lyrics || "(tanpa lirik)"
  $("#d-cover").src = song.imageUrl || U("/icon-192.png")
  const badge = $("#d-badge")
  badge.textContent = statusLabel(song.status)
  badge.className = "badge " + song.status

  // pemilih track
  const tracks = Array.isArray(song.tracks) ? song.tracks.filter((t) => t.audioUrl) : []
  const ts = $("#track-switch")
  if (tracks.length > 1) {
    ts.innerHTML = tracks.map((t, i) => `<button data-src="${t.audioUrl}" data-img="${t.imageUrl || ""}" class="${i === 0 ? "active" : ""}">Versi ${i + 1}</button>`).join("")
    qa("button", ts).forEach((b) => b.addEventListener("click", () => {
      qa("button", ts).forEach((x) => x.classList.remove("active"))
      b.classList.add("active")
      setActiveTrack(b.dataset.src, b.dataset.img)
    }))
  } else { ts.innerHTML = "" }

  const firstSrc = (tracks[0] && tracks[0].audioUrl) || song.audioUrl || null
  setActiveTrack(firstSrc, null)

  // tombol aksi
  $("#btn-like").textContent = song.liked ? "\uD83D\uDC94 Batal Favorit" : "\u2764\uFE0F Favorit"
  $("#btn-cover").disabled = song.status !== "success" || song.provider === "uploadcover"
  $("#btn-stem").disabled = song.status !== "success"
  ensureCrunActions(song)

  renderStemWav(song)
}

function renderStemWav(song) {
  const box = $("#stem-wav")
  const body = $("#stem-wav-body")
  const parts = []
  if (song.stemStatus) {
    if (song.stemStatus === "processing") parts.push('<p class="sw-row">\uD83C\uDF9B\uFE0F Memisahkan stem\u2026</p>')
    else if (song.stemStatus === "failed") parts.push(`<p class="sw-row err">Stem gagal: ${escapeHtml(song.stemError || "")}</p>`)
    else if (song.stemStatus === "success" && Array.isArray(song.stems)) {
      parts.push('<div class="sw-stems">' + song.stems.map((s) => `<div class="sw-stem"><span>${escapeHtml(s.name)}</span><audio controls preload="none" src="${s.url}"></audio><a class="sw-dl" href="${s.url}" download>\u2193</a></div>`).join("") + "</div>")
    }
  }
  if (song.videoStatus) {
    if (song.videoStatus === "processing") parts.push('<p class="sw-row">Membuat video\u2026</p>')
    else if (song.videoStatus === "failed") parts.push(`<p class="sw-row err">Video gagal: ${escapeHtml(song.videoError || "")}</p>`)
    else if (song.videoStatus === "success" && song.videoUrl) {
      const src = U("/api/songs/" + song.id + "/stream?src=" + encodeURIComponent(song.videoUrl))
      parts.push(`<div class="sw-row"><video controls preload="metadata" src="${src}" style="width:100%;max-height:240px"></video><a class="sw-dl" href="${src}" download>Unduh video</a></div>`)
    }
  }
  if (song.wavStatus) {
    if (song.wavStatus === "processing") parts.push('<p class="sw-row">\uD83C\uDFB5 Mengonversi WAV\u2026</p>')
    else if (song.wavStatus === "failed") parts.push(`<p class="sw-row err">WAV gagal: ${escapeHtml(song.wavError || "")}</p>`)
    else if (song.wavStatus === "success" && song.wavUrl) parts.push(`<p class="sw-row">\uD83C\uDFB5 WAV siap: <a href="${song.wavUrl}" download>Unduh WAV</a></p>`)
  }
  if (parts.length) { box.classList.remove("hidden"); body.innerHTML = parts.join("") }
  else { box.classList.add("hidden"); body.innerHTML = "" }
}

async function toggleLike() {
  if (!state.selected) return
  try {
    const { song } = await api("/api/songs/" + state.selected.id + "/like", { method: "PATCH" })
    renderDetail(song); updateSongInState(song)
  } catch (e) { toast(e.message, "error") }
}

async function doCover() {
  if (!state.selected) return
  const style = prompt("Gaya/genre baru untuk aransemen ulang:", state.selected.style || "")
  if (style === null) return
  if (!style.trim()) { toast("Gaya wajib diisi", "error"); return }
  try {
    const { song } = await api("/api/songs/" + state.selected.id + "/cover", { method: "POST", body: { style: style.trim() } })
    toast("Aransemen ulang diproses\u2026", "success")
    await refreshCredits()
    setView("library")
    startPoll(song.id)
    openDetail(song.id)
  } catch (e) { toast(e.message, "error") }
}

// ------------------------------ Stem / WAV modal ----------------------------
function openStem() {
  if (!state.selected) return
  $("#stem-src-title").textContent = state.selected.title
  $("#stem-status").textContent = ""
  const isSuno = state.selected.provider === "uploadcover"
  const isCrun = state.selected.provider === "crun"
  $("#wav-go").style.display = isSuno || isCrun ? "" : "none"
  $("#wav-go").textContent = isCrun ? "Konversi ke WAV" : "Konversi ke WAV (6 kredit)"
  $("#stem-go").textContent = isCrun ? "Pisah stem" : "Pisah stem (11 kredit)"
  $("#stem-note").textContent = isCrun
    ? "Stem, perpanjang, dan video lewat crun.ai. WAV dikonversi di browser dari audio yang sudah jadi."
    : isSuno
    ? "Stem & WAV via sunoapi.org. Memakai key yang sama dengan lagu sumber."
    : "Stem via APIframe. WAV API tidak tersedia untuk APIframe \u2014 gunakan Unduh MP3."
  $("#stem-modal").classList.remove("hidden")
}
function closeStem() { $("#stem-modal").classList.add("hidden") }

async function submitStem() {
  if (!state.selected) return
  $("#stem-status").textContent = "Memproses\u2026"
  try {
    const { song } = await api("/api/songs/" + state.selected.id + "/stems", { method: "POST", body: { type: $("#stem-type").value } })
    toast("Pemisahan stem diproses\u2026", "success")
    closeStem(); await refreshCredits(); renderDetail(song); startPoll(song.id)
  } catch (e) { $("#stem-status").textContent = e.message; toast(e.message, "error") }
}
async function convertCrunToWav(song) {
  const src = state.activeSrc || song.audioUrl
  if (!src) throw new Error("Audio belum siap")
  const res = await fetch(U("/api/songs/" + song.id + "/stream?src=" + encodeURIComponent(src)))
  if (!res.ok) throw new Error("Audio tidak bisa diambil")
  const ctx = new (window.AudioContext || window.webkitAudioContext)()
  const buffer = await ctx.decodeAudioData(await res.arrayBuffer())
  const blob = audioBufferToWav(buffer)
  const a = document.createElement("a")
  a.href = URL.createObjectURL(blob)
  a.download = (song.title || "lagu").replace(/[^\w.-]+/g, "_").slice(0, 60) + ".wav"
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 8000)
  try { ctx.close() } catch { /* abaikan */ }
}
function ensureCrunActions(song) {
  const bar = document.querySelector(".detail-actions")
  if (bar && !$("#btn-extend")) {
    const ext = document.createElement("button")
    ext.id = "btn-extend"
    ext.className = "btn-secondary"
    ext.textContent = "Perpanjang"
    const vid = document.createElement("button")
    vid.id = "btn-video"
    vid.className = "btn-secondary"
    vid.textContent = "Video"
    const stem = $("#btn-stem")
    if (stem) stem.after(vid)
    if (stem) stem.after(ext)
    ext.addEventListener("click", doExtend)
    vid.addEventListener("click", doVideo)
  }
  const show = song && song.provider === "crun"
  const extBtn = $("#btn-extend")
  const vidBtn = $("#btn-video")
  if (extBtn) { extBtn.style.display = show ? "" : "none"; extBtn.disabled = !show || song.status !== "success" }
  if (vidBtn) { vidBtn.style.display = show ? "" : "none"; vidBtn.disabled = !show || song.status !== "success" || song.videoStatus === "processing" }
}
async function doExtend() {
  if (!state.selected) return
  const sec = prompt("Perpanjang dari detik ke berapa?", "30")
  if (sec === null) return
  const style = prompt("Gaya lanjutan:", state.selected.style || "")
  if (style === null) return
  try {
    const { song } = await api("/api/songs/" + state.selected.id + "/extend", { method: "POST", body: { continueAt: Number(sec) || 30, style: style.trim() } })
    toast("Perpanjangan diproses\u2026", "success")
    await refreshCredits()
    setView("library")
    startPoll(song.id)
    openDetail(song.id)
  } catch (e) { toast(e.message, "error") }
}
async function doVideo() {
  if (!state.selected) return
  const author = prompt("Nama di video (kosongkan jika tidak perlu):", "")
  if (author === null) return
  try {
    const { song } = await api("/api/songs/" + state.selected.id + "/video", { method: "POST", body: { author: author.trim() } })
    toast("Video diproses\u2026", "success")
    renderDetail(song)
    startPoll(song.id)
  } catch (e) { toast(e.message, "error") }
}
async function submitWav() {
  if (!state.selected) return
  if (state.selected.provider === "crun") {
    $("#stem-status").textContent = "Mengonversi WAV di browser\u2026"
    try {
      await convertCrunToWav(state.selected)
      toast("WAV siap diunduh", "success")
      closeStem()
    } catch (e) { $("#stem-status").textContent = e.message; toast(e.message, "error") }
    return
  }
  $("#stem-status").textContent = "Memproses\u2026"
  try {
    const { song } = await api("/api/songs/" + state.selected.id + "/wav", { method: "POST", body: {} })
    toast("Konversi WAV diproses\u2026", "success")
    closeStem(); await refreshCredits(); renderDetail(song); startPoll(song.id)
  } catch (e) { $("#stem-status").textContent = e.message; toast(e.message, "error") }
}

// ------------------------------ Unduh MP3 (passthrough) ---------------------
function downloadMp3() {
  if (!state.selected || !state.activeSrc) { toast("Audio belum siap", "error"); return }
  const url = U("/api/songs/" + state.selected.id + "/download?src=" + encodeURIComponent(state.activeSrc))
  toast("Menyiapkan unduhan\u2026", "info")
  window.open(url, "_blank")
}

// ------------------------------ API keys (APIframe) -------------------------
function keyItemHtml(k, kind) {
  const cr = k.credits === null ? "belum dicek" : (k.credits + " kredit")
  return `<li class="key-item" data-id="${k.id}" data-kind="${kind}">
    <span class="k-mask">${escapeHtml(k.masked)}</span>
    <span class="k-cr">${cr}</span>
    <span class="k-act">
      <button class="k-check">Cek</button>
      <button class="k-reveal">Lihat</button>
      <button class="k-del danger">Hapus</button>
    </span>
  </li>`
}
function bindKeyItems(root, kind) {
  const base = kind === "apiframe" ? "/api/keys/"
    : kind === "suno" ? "/api/upload-keys/"
    : kind === "gemini" ? "/api/gemini-keys/"
    : kind === "kie" ? "/api/kie-keys/"
    : kind === "crun" ? "/api/crun-keys/"
    : "/api/musicapi-keys/"
  const refresh = kind === "apiframe" ? loadKeys
    : kind === "suno" ? loadUploadKeys
    : kind === "gemini" ? loadGeminiKeys
    : kind === "kie" ? loadKieKeys
    : kind === "crun" ? loadCrunKeys
    : loadMusicApiKeys
  const fmtCredits = (n) => {
    if (kind === "gemini") return n === 1 ? "\u2705 valid" : n === 0 ? "\u274C invalid" : "-"
    if (kind === "kie") return n === null || n === undefined ? "tersimpan" : (n === 0 ? "cek gagal" : (n + " kredit"))
    return (n ?? 0) + " kredit"
  }
  qa(".key-item", root).forEach((li) => {
    const id = li.dataset.id
    $(".k-check", li).addEventListener("click", async () => {
      try { const r = await api(base + id + "/check", { method: "POST" }); $(".k-cr", li).textContent = fmtCredits(r.credits) }
      catch (e) { toast(e.message, "error") }
    })
    $(".k-reveal", li).addEventListener("click", async () => {
      try { const r = await api(base + id + "/reveal"); $(".k-mask", li).textContent = r.key }
      catch (e) { toast(e.message, "error") }
    })
    $(".k-del", li).addEventListener("click", async () => {
      try { await api(base + id, { method: "DELETE" }); refresh() }
      catch (e) { toast(e.message, "error") }
    })
  })
}
function keySummary(d) {
  const unchecked = (d.keys || []).filter((k) => k.credits === null || k.credits === undefined).length
  return `${d.count} key \u00B7 total ${d.totalCredits ?? 0} kredit` + (unchecked ? ` \u00B7 ${unchecked} belum dicek` : "")
}
async function loadKeys() {
  const d = await api("/api/keys")
  $("#keys-summary").textContent = keySummary(d)
  const list = $("#keys-list")
  list.innerHTML = d.keys.length ? d.keys.map((k) => keyItemHtml(k, "apiframe")).join("") : '<li class="empty">Belum ada key.</li>'
  bindKeyItems(list, "apiframe")
}
async function loadUploadKeys() {
  const d = await api("/api/upload-keys")
  $("#upkeys-summary").textContent = keySummary(d)
  const list = $("#upkeys-list")
  list.innerHTML = d.keys.length ? d.keys.map((k) => keyItemHtml(k, "suno")).join("") : '<li class="empty">Belum ada key.</li>'
  bindKeyItems(list, "suno")
}
async function loadGeminiKeys() {
  const d = await api("/api/gemini-keys")
  const ok = d.keys.filter((k) => k.credits === 1).length
  const bad = d.keys.filter((k) => k.credits === 0).length
  $("#gkeys-summary").textContent = `${d.count} key \u00B7 valid ${ok}` + (bad ? ` \u00B7 invalid ${bad}` : "")
  const list = $("#gkeys-list")
  list.innerHTML = d.keys.length ? d.keys.map((k) => keyItemHtml(k, "gemini")).join("") : '<li class="empty">Belum ada key.</li>'
  bindKeyItems(list, "gemini")
}
async function loadKieKeys() {
  const d = await api("/api/kie-keys")
  $("#kiekeys-summary").textContent = keySummary(d)
  const list = $("#kiekeys-list")
  list.innerHTML = d.keys.length ? d.keys.map((k) => keyItemHtml(k, "kie")).join("") : '<li class="empty">Belum ada key.</li>'
  bindKeyItems(list, "kie")
}
async function loadMusicApiKeys() {
  const d = await api("/api/musicapi-keys")
  $("#musicapikeys-summary").textContent = keySummary(d)
  const list = $("#musicapikeys-list")
  list.innerHTML = d.keys.length ? d.keys.map((k) => keyItemHtml(k, "musicapi")).join("") : '<li class="empty">Belum ada key.</li>'
  bindKeyItems(list, "musicapi")
}
function renderCrunKeys(d) {
  $("#crunkeys-summary").textContent = keySummary(d)
  const list = $("#crunkeys-list")
  list.innerHTML = d.keys.length ? d.keys.map((k) => keyItemHtml(k, "crun")).join("") : '<li class="empty">Belum ada key.</li>'
  bindKeyItems(list, "crun")
}
async function loadCrunKeys() {
  renderCrunKeys(await api("/api/crun-keys"))
}
async function refreshLiveCrunCredits() {
  const r = await api("/api/crun-keys/check", { method: "POST" })
  renderCrunKeys(r)
  refreshCredits()
  return r
}

// ------------------------------ Generate Lirik (Gemini) ---------------------
function collectLyricsInput() {
  return {
    theme:    $("#l-theme").value.trim(),
    language: $("#l-language").value,
    genre:    $("#l-genre").value.trim(),
    mood:     $("#l-mood").value.trim(),
    extra:    $("#l-extra").value.trim(),
    model:    $("#l-model").value,
  }
}
async function submitLyrics() {
  const btn = $("#btn-lyrics")
  const body = collectLyricsInput()
  if (!body.theme) { toast("Tema lagu wajib diisi", "error"); return }
  state.lastLyricsInput = body
  btn.disabled = true
  $("#lyrics-msg").textContent = "\u2728 Gemini sedang menulis lirik\u2026"
  try {
    const r = await api("/api/lyrics/generate", { method: "POST", body })
    $("#l-result-wrap").style.display = ""
    $("#l-result").value = r.lyrics
    $("#lyrics-msg").textContent = "Lirik siap! Model: " + (r.model || "-")
    toast("Lirik selesai dibuat", "success")
  } catch (e) {
    $("#lyrics-msg").textContent = e.message
    toast(e.message, "error")
  } finally { btn.disabled = false }
}
function copyLyrics() {
  const v = $("#l-result").value
  if (!v) return
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(v).then(() => toast("Lirik disalin", "success"), () => fallbackCopyLyrics(v))
  } else { fallbackCopyLyrics(v) }
}
function fallbackCopyLyrics(v) {
  const ta = $("#l-result")
  ta.select(); document.execCommand("copy"); toast("Lirik disalin", "success")
}
function useLyricsInCreate() {
  const v = $("#l-result").value
  if (!v) return
  $("#f-lyrics").value = v
  updateCreateCounts()
  const inp = state.lastLyricsInput
  if (inp && inp.genre && !$("#f-style").value.trim()) $("#f-style").value = inp.genre
  updateCreateCounts()
  setView("create")
  toast("Lirik dimuat ke Buat lagu", "success")
  $("#f-style").focus()
}

// ------------------------------ Bind UI -------------------------------------
// Helper: safe addEventListener — tidak crash jika elemen null
function on(sel, evt, fn) { const el = typeof sel === "string" ? $(sel) : sel; if (el) el.addEventListener(evt, fn); return el }

function bindUI() {
  // NAVIGASI — paling kritis, harus jalan duluan
  qa(".nav-item, .bn-item").forEach((b) => { if (b.dataset.view) b.addEventListener("click", () => setView(b.dataset.view)) })
  // Theme toggles (harus terpisah dari navigasi karena bukan data-view)
  ;["#theme-toggle-side", "#theme-toggle-bn", "#theme-toggle-set"].forEach((sel) => on(sel, "click", toggleTheme))
  // Frontpage CTA
  on("#fp-cta", "click", () => setView("create"))

  // Sisa binding dibungkus try-catch agar navigasi tetap hidup meski ada error
  try { bindUIInner() } catch (e) { console.error("bindUI error (non-fatal):", e) }
}

async function boostLyrics() {
  const input = $("#f-lyrics")
  if (!input) return
  const title = ($("#f-title") && $("#f-title").value) || ""
  const style = ($("#f-style") && $("#f-style").value) || ""
  if (!input.value.trim() && !title.trim() && !style.trim()) {
    toast("Isi lirik, judul, atau gaya dulu", "error")
    input.focus()
    return
  }
  const btn = $("#boost-lyrics-btn")
  if (btn) btn.disabled = true
  toast("Memperkuat lirik\u2026", "info")
  try {
    const out = await api("/api/lyrics/boost", { method: "POST", body: { lyrics: input.value, title, style } })
    input.value = String(out.lyrics || "").slice(0, 5000)
    input.dispatchEvent(new Event("input", { bubbles: true }))
    toast(out.source === "gemini" ? "Lirik diperkuat dengan Gemini" : "Lirik diperkuat", "success")
  } catch (e) { toast(e.message, "error") }
  finally { if (btn) btn.disabled = false }
}
function bindUIInner() {
  segment("f-type"); segment("f-gender")
  const fModel = $("#f-model")
  if (fModel) fModel.addEventListener("change", updateCreateModelPill)
  ;["#f-title", "#f-style", "#f-lyrics"].forEach((sel) => {
    const el = $(sel)
    if (el) el.addEventListener("input", updateCreateCounts)
  })
  qa("[data-copy-target]").forEach((b) => b.addEventListener("click", () => copyField(b.dataset.copyTarget)))
  const boostLyricsBtn = $("#boost-lyrics-btn")
  if (boostLyricsBtn) boostLyricsBtn.addEventListener("click", boostLyrics)
  qa("[data-clear-target]").forEach((b) => b.addEventListener("click", () => clearField(b.dataset.clearTarget)))
  const clearBtn = $("#btn-create-clear")
  if (clearBtn) clearBtn.addEventListener("click", clearCreateForm)
  const importBtn = $("#btn-import-lyrics")
  if (importBtn) importBtn.addEventListener("click", importLyricsToCreate)
  updateCreateCounts()
  updateCreateModelPill()
  on("#btn-generate", "click", submitGenerate)
  on("#btn-upload", "click", submitUpload)
  on("#u-file", "change", (e) => {
    const f = e.target.files[0]
    const lbl = $("#u-file-label")
    if (lbl) lbl.textContent = f ? ("\uD83C\uDFB5 " + f.name) : "\uD83C\uDFB5 Pilih file audio (mp3/wav/m4a)"
  })
  on("#btn-clear", "click", async () => {
    if (!confirm("Hapus semua lagu?")) return
    try { await api("/api/songs", { method: "DELETE" }); loadSongs(false) } catch (e) { toast(e.message, "error") }
  })
  // detail
  on("#detail-close", "click", closeDetail)
  on("#detail", "click", (e) => { if (e.target.id === "detail") closeDetail() })
  on("#btn-like", "click", toggleLike)
  on("#btn-cover", "click", doCover)
  on("#btn-stem", "click", openStem)
  on("#btn-download", "click", downloadMp3)
  on("#btn-delete", "click", async () => {
    if (!state.selected) return
    if (!confirm("Hapus lagu \u201C" + (state.selected.title || "") + "\u201D?")) return
    try { await api("/api/songs/" + state.selected.id, { method: "DELETE" }); closeDetail(); loadSongs(false) }
    catch (e) { toast(e.message, "error") }
  })
  // stem modal
  on("#stem-close", "click", closeStem)
  on("#stem-cancel", "click", closeStem)
  on("#stem-go", "click", submitStem)
  on("#wav-go", "click", submitWav)
  // keys
  on("#keys-add", "click", async () => {
    const v = $("#keys-input").value.trim(); if (!v) { toast("API key APIframe belum diisi", "error"); return }
    try { const r = await api("/api/keys", { method: "POST", body: { keys: v } }); $("#keys-input").value = ""; toast(r.added + " key ditambahkan", "success"); loadKeys() }
    catch (e) { toast(e.message, "error") }
  })
  on("#keys-check", "click", async () => {
    toast("Mengecek kredit\u2026", "info")
    try { await api("/api/keys/check", { method: "POST" }); loadKeys() } catch (e) { toast(e.message, "error") }
  })
  on("#upkeys-add", "click", async () => {
    const v = $("#upkeys-input").value.trim(); if (!v) { toast("Kunci sunoapi.org kosong", "error"); return }
    try {
      const r = await api("/api/upload-keys", { method: "POST", body: { keys: v } })
      $("#upkeys-input").value = ""
      toast((r.added ?? 0) + " key sunoapi ditambahkan", "success")
      await loadUploadKeys()
    }
    catch (e) { toast(e.message || "Gagal tambah key sunoapi", "error") }
  })
  on("#upkeys-check", "click", async () => {
    toast("Mengecek kredit\u2026", "info")
    try { await api("/api/upload-keys/check", { method: "POST" }); loadUploadKeys() } catch (e) { toast(e.message, "error") }
  })
  // Gemini keys
  $("#gkeys-add").addEventListener("click", async () => {
    const v = $("#gkeys-input").value.trim(); if (!v) { toast("Key Gemini kosong", "error"); return }
    try {
      const r = await api("/api/gemini-keys", { method: "POST", body: { keys: v } })
      $("#gkeys-input").value = ""
      toast((r.added ?? 0) + " key Gemini ditambahkan", "success")
      await loadGeminiKeys()
    }
    catch (e) { toast(e.message || "Gagal tambah key Gemini", "error") }
  })
  $("#gkeys-check").addEventListener("click", async () => {
    toast("Memverifikasi key Gemini\u2026", "info")
    try { await api("/api/gemini-keys/check", { method: "POST" }); loadGeminiKeys(); toast("Verifikasi selesai", "success") } catch (e) { toast(e.message, "error") }
  })
  // KIE AI keys
  $("#kiekeys-add").addEventListener("click", async () => {
    const v = $("#kiekeys-input").value.trim(); if (!v) { toast("API key KIE AI kosong", "error"); return }
    try { const r = await api("/api/kie-keys", { method: "POST", body: { keys: v } }); $("#kiekeys-input").value = ""; toast((r.added ?? 0) + " key KIE AI ditambahkan", "success"); await loadKieKeys() }
    catch (e) { toast(e.message || "Gagal tambah key KIE AI", "error") }
  })
  $("#kiekeys-check").addEventListener("click", async () => {
    toast("Mengecek KIE AI key\u2026", "info")
    try {
      const r = await api("/api/kie-keys/check", { method: "POST" })
      await loadKieKeys(); await refreshCredits()
      if (r.invalidCount) toast(`${r.validCount} key valid, ${r.invalidCount} key gagal`, "warning")
      else toast(`${r.validCount} key KIE valid \u00B7 total ${r.totalCredits} kredit`, "success")
    } catch (e) { await loadKieKeys().catch(() => {}); await refreshCredits(); toast(e.message, "error") }
  })
  // MusicAPI.ai keys
  $("#musicapikeys-add").addEventListener("click", async () => {
    const v = $("#musicapikeys-input").value.trim(); if (!v) { toast("API key MusicAPI.ai kosong", "error"); return }
    try { const r = await api("/api/musicapi-keys", { method: "POST", body: { keys: v } }); $("#musicapikeys-input").value = ""; toast((r.added ?? 0) + " key MusicAPI ditambahkan", "success"); await loadMusicApiKeys() }
    catch (e) { toast(e.message || "Gagal tambah key MusicAPI", "error") }
  })
  $("#musicapikeys-check").addEventListener("click", async () => {
    toast("Mengecek kredit MusicAPI\u2026", "info")
    try { await api("/api/musicapi-keys/check", { method: "POST" }); loadMusicApiKeys(); toast("Cek MusicAPI selesai", "success") } catch (e) { toast(e.message, "error") }
  })
  $("#crunkeys-add").addEventListener("click", async () => {
    const v = $("#crunkeys-input").value.trim(); if (!v) { toast("API key crun.ai kosong", "error"); return }
    try { const r = await api("/api/crun-keys", { method: "POST", body: { keys: v } }); $("#crunkeys-input").value = ""; toast((r.added ?? 0) + " key crun.ai ditambahkan", "success"); await loadCrunKeys() }
    catch (e) { toast(e.message || "Gagal tambah key crun.ai", "error") }
  })
  $("#crunkeys-check").addEventListener("click", async () => {
    toast("Mengecek saldo crun.ai\u2026", "info")
    try {
      const r = await refreshLiveCrunCredits()
      toast(r.failed ? `${r.totalCredits ?? 0} kredit terbaca, ${r.failed} key gagal` : `Saldo crun.ai ${r.totalCredits ?? 0} kredit`, r.failed ? "warning" : "success")
    } catch (e) { toast(e.message, "error") }
  })
  // Search & sort
  $("#lib-search").addEventListener("input", (e) => {
    state.searchQuery = e.target.value
    renderSongs($("#library-list"), state.songs)
  })
  $("#btn-sort").addEventListener("click", () => {
    const orders = ["newest", "oldest", "title"]
    const idx = (orders.indexOf(state.sortOrder) + 1) % orders.length
    state.sortOrder = orders[idx]
    const labels = { newest: "📅 Terbaru", oldest: "📅 Terlama", title: "🔤 A-Z" }
    $("#btn-sort").textContent = labels[state.sortOrder]
    renderSongs($("#library-list"), state.songs)
  })
  // Generate Lirik (Gemini)
  on("#btn-lyrics", "click", submitLyrics)
  on("#btn-l-copy", "click", copyLyrics)
  on("#btn-l-use", "click", useLyricsInCreate)
  on("#btn-l-regen", "click", submitLyrics)
  // Frontpage editor
  $("#fp-ed-save")?.addEventListener("click", async () => {
    const btn = $("#fp-ed-save"); btn.disabled = true
    const lines = $("#fp-ed-feats").value.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 8)
    const features = lines.map((l) => {
      const pipe = l.indexOf("|")
      return pipe > 0 ? { icon: l.slice(0, pipe).trim(), text: l.slice(pipe + 1).trim() } : { icon: "•", text: l }
    })
    try {
      const fp = await api("/api/frontpage", { method: "PUT", body: {
        title: $("#fp-ed-title").value,
        subtitle: $("#fp-ed-subtitle").value,
        description: $("#fp-ed-desc").value,
        cta: $("#fp-ed-cta").value,
        footer: $("#fp-ed-footer").value,
        features,
      }})
      renderFrontpage(fp)
      $("#fp-ed-msg").textContent = "✅ Tersimpan!"
    } catch (e) { $("#fp-ed-msg").textContent = "❌ " + e.message }
    finally { btn.disabled = false; setTimeout(() => { $("#fp-ed-msg").textContent = "" }, 3000) }
  })
  $("#fp-ed-reset")?.addEventListener("click", async () => {
    if (!confirm("Reset halaman depan ke default?")) return
    const defaults = {
      title: "GEJEMUZIK",
      subtitle: "AI Song Generator",
      tagline: "",
      description: "Generate lagu dari teks, aransemen ulang, pisah stem, dan hasilkan lirik otomatis. Semua dari browser, tanpa ribet.",
      features: [
        { icon: "🎵", text: "Generate lagu dari judul + gaya + lirik" },
        { icon: "🎹", text: "Aransemen ulang (cover) dengan gaya baru" },
        { icon: "🎼", text: "Pisah stem vokal & instrumen" },
        { icon: "✍️", text: "Tulis lirik otomatis pakai Gemini" },
      ],
      cta: "Mulai Buat Lagu",
      footer: "by bangalimin",
    }
    try {
      const fp = await api("/api/frontpage", { method: "PUT", body: defaults })
      renderFrontpage(fp)
      loadFrontpage() // refresh editor fields
      $("#fp-ed-msg").textContent = "✅ Kembali ke default!"
    } catch (e) { $("#fp-ed-msg").textContent = "❌ " + e.message }
    finally { setTimeout(() => { $("#fp-ed-msg").textContent = "" }, 3000) }
  })
  // Block editor
  const setBlkPending = (type) => { blkPendingType = type; blkEditingId = null; openBlockEditor(null) }
  $("#blk-add-text")?.addEventListener("click", () => setBlkPending("text"))
  $("#blk-add-heading")?.addEventListener("click", () => setBlkPending("heading"))
  $("#blk-add-image")?.addEventListener("click", () => setBlkPending("image"))
  $("#blk-add-embed")?.addEventListener("click", () => setBlkPending("embed"))
  $("#blk-add-divider")?.addEventListener("click", () => setBlkPending("divider"))
  $("#blk-modal-save")?.addEventListener("click", saveBlockEditor)
  $("#blk-modal-cancel")?.addEventListener("click", closeBlockEditor)
  $("#blk-modal-close")?.addEventListener("click", closeBlockEditor)
  $("#blk-modal")?.addEventListener("click", (e) => { if (e.target.id === "blk-modal") closeBlockEditor() })
  // Mini player controls
  bindMiniPlayerControls()
  // Homofon & Mastering (menu baru)
  bindHomofonUI()
  bindMasteringUI()
}

// ============================== HOMOFON =====================================
// Kamus homofon: kata -> daftar pasangan homofon (bunyi sama, tulisan & arti beda).
const HOMOFON_ID = {
  // === H luluh (h di awal tidak diucapkan dalam percakapan sehari-hari) ===
  "handal": ["andal"], "andal": ["handal"],
  "harum": ["arum"], "arum": ["harum"],
  "hutang": ["utang"], "utang": ["hutang"],
  "hembus": ["embus"], "embus": ["hembus"],
  "himpit": ["impit"], "impit": ["himpit"],
  "himbau": ["imbau"], "imbau": ["himbau"],
  "hafal": ["hapal", "apal"], "hapal": ["hafal", "apal"], "apal": ["hafal", "hapal"],
  "hewan": ["ewan"],
  "hiruk": ["iruk"],
  "hingga": ["ingga"],

  // === Kh vs K (serapan Arab) ===
  "khas": ["kas"], "kas": ["khas"],
  "khusus": ["kusus"], "kusus": ["khusus"],
  "khianat": ["kianat"], "kianat": ["khianat"],
  "khayal": ["kayal"], "kayal": ["khayal"],
  "khawatir": ["kawatir"], "kawatir": ["khawatir"],
  "khilaf": ["kilaf"], "kilaf": ["khilaf"],
  "khotbah": ["kotbah"], "kotbah": ["khotbah"],
  "khidmat": ["kidmat"], "kidmat": ["khidmat"],
  "khatulistiwa": ["katulistiwa"],
  "khalayak": ["kalayak"],
  "khasiat": ["kasiat"], "kasiat": ["khasiat"],
  "khitan": ["kitan"], "kitan": ["khitan"],
  "khatam": ["katam"], "katam": ["khatam"],

  // === Konsonan akhir luluh (k/ng, n/ng, t/d) ===
  "bank": ["bang"], "bang": ["bank"],
  "tank": ["tang"], "tang": ["tank"],
  "rok": ["rock"], "rock": ["rok"],

  // === Bunyi sama, ejaan beda (konvensi lama vs baru) ===
  "masa": ["massa"], "massa": ["masa"],
  "sangsi": ["sanksi"], "sanksi": ["sangsi"],
  "syarat": ["sarat"], "sarat": ["syarat"],
  "hikmat": ["hikmah"], "hikmah": ["hikmat"],
  "kualitas": ["kwalitas"], "kwalitas": ["kualitas"],
  "dzikir": ["zikir"], "zikir": ["dzikir"],
  "salat": ["shalat", "solat"], "shalat": ["salat", "solat"], "solat": ["salat", "shalat"],
  "jumat": ["jum'at"], "jum'at": ["jumat"],
  "karena": ["karna"], "karna": ["karena"],
  "akhir": ["akir"], "akir": ["akhir"],
  "tuju": ["tujuh"], "tujuh": ["tuju"],

  // === Vokal sama, konsonan mirip (f/p, v/f, z/j) ===
  "aktif": ["aktip"], "aktip": ["aktif"],
  "kreatif": ["kreatip"], "kreatip": ["kreatif"],
  "positif": ["positip"], "positip": ["positif"],
  "efektif": ["efektip"], "efektip": ["efektif"],
  "sportif": ["sportip"], "sportip": ["sportif"],
  "produktif": ["produktip"], "produktip": ["produktif"],
  "pasif": ["pasip"], "pasip": ["pasif"],
  "definitif": ["definitip"], "definitip": ["definitif"],
  "tarif": ["tarip"], "tarip": ["tarif"],
  "maaf": ["maap"], "maap": ["maaf"],
  "zaman": ["jaman"], "jaman": ["zaman"],
  "izin": ["ijin"], "ijin": ["izin"],
  "azab": ["ajab"],
  "lazim": ["lajim"],

  // === Serapan Inggris/asing yang bunyi mirip kata Indonesia ===
  "fiber": ["faiber"],
  "file": ["fail"],

  // === Bunyi sama, arti beda (homonim ganda — sering membingungkan) ===
  "bisa": ["bias"], "bias": ["bisa"],
  "tahu": ["tau"], "tau": ["tahu"],
  "baru": ["baharu"], "baharu": ["baru"],
  "air": ["aer"], "aer": ["air"],
  "pakai": ["pake"], "pake": ["pakai"],
  "tidak": ["tak", "nggak"], "tak": ["tidak", "nggak"], "nggak": ["tidak", "tak"],
  "sudah": ["udah"], "udah": ["sudah"],
  "saja": ["aja"], "aja": ["saja"],
  "kalau": ["kalo"], "kalo": ["kalau"],
  "mereka": ["mreka"],
  "dengan": ["degan"],
  "kepada": ["kpada"],

  // === Bunyi sehari-hari sama, ejaan resmi beda ===
  "apotek": ["apotik"], "apotik": ["apotek"],
  "praktik": ["praktek"], "praktek": ["praktik"],
  "risiko": ["resiko"], "resiko": ["risiko"],
  "nasihat": ["nasehat"], "nasehat": ["nasihat"],
  "sistem": ["sistim"], "sistim": ["sistem"],
  "metode": ["metoda"], "metoda": ["metode"],
  "analisis": ["analisa"], "analisa": ["analisis"],
  "teknik": ["tehnik"], "tehnik": ["teknik"],
  "teknologi": ["tekhnologi"],
  "standar": ["standard"], "standard": ["standar"],
  "objek": ["obyek"], "obyek": ["objek"],
  "subjek": ["subyek"], "subyek": ["subjek"],
  "kompleks": ["komplek"], "komplek": ["kompleks"],
  "efisien": ["efesien"], "efesien": ["efisien"],
  "insaf": ["insyaf"], "insyaf": ["insaf"],
  "provinsi": ["propinsi"], "propinsi": ["provinsi"],
  "februari": ["pebruari"], "pebruari": ["februari"],
  "november": ["nopember"], "nopember": ["november"],
  "karier": ["karir"], "karir": ["karier"],
  "kreativitas": ["kreatifitas"], "kreatifitas": ["kreativitas"],

  // === Serapan Arab bunyi sama ===
  "sholat": ["salat"], "solawat": ["shalawat"], "shalawat": ["solawat"],
  "surga": ["sorga"], "sorga": ["surga"],
  "jenazah": ["jenasah"],
  "mushola": ["musala", "musholla"], "musala": ["mushola", "musholla"], "musholla": ["mushola", "musala"],
  "zakat": ["jakat"],
  "rezeki": ["rejeki", "rizki"], "rejeki": ["rezeki", "rizki"], "rizki": ["rezeki", "rejeki"],
  "insyaallah": ["insya allah", "insyallah"],
  "alhamdulillah": ["alhamdulilah"],
  "doa": ["do'a"], "do'a": ["doa"],

  // === Awalan/akhiran informal ===
  "tetapi": ["tapi"], "tapi": ["tetapi"],
  "bagaimana": ["gimana"], "gimana": ["bagaimana"],
  "begitu": ["gitu"], "gitu": ["begitu"],
  "kemarin": ["kemaren"], "kemaren": ["kemarin"],
  "memang": ["emang"], "emang": ["memang"],
  "sebentar": ["bentar"], "bentar": ["sebentar"],
  "sekarang": ["skrg"],
  "belum": ["blum"], "blum": ["belum"],
  "habis": ["abis"], "abis": ["habis"],
  "pintar": ["pinter"], "pinter": ["pintar"],
  "benar": ["bener"], "bener": ["benar"],
  "banget": ["sangat"], "sangat": ["banget"],

  // === Kata serapan ganda (Belanda/Inggris vs Indonesia) ===
  "karcis": ["tiket"], "tiket": ["karcis"],
  "sopir": ["supir"], "supir": ["sopir"],
  "dongkrak": ["dongkrek"],
  "bengkel": ["bengkil"],

  // === Bunyi /e/ vs /i/ (pepet vs taling) ===
  "sekedar": ["sekadar"], "sekadar": ["sekedar"],
  "teladan": ["tauladan"], "tauladan": ["teladan"],
  "dompet": ["dompit"],
  "anter": ["antar"], "antar": ["anter"],
  "persen": ["persin"],

  // === Bunyi /u/ vs /o/ ===
  "ketoprak": ["ketuprak"],
  "toko": ["tuku"],
  "obat": ["ubat"], "ubat": ["obat"],

  // === Konsonan ganda/rangkap ===
  "jadwal": ["jadual"], "jadual": ["jadwal"],
  "ijazah": ["ijasah"], "ijasah": ["ijazah"],
  "safar": ["sapar"],
  "ziarah": ["jiarah"],
}

const HOMOFON_EN = {
  "there": ["their", "they're"], "their": ["there", "they're"], "they're": ["there", "their"],
  "to": ["too", "two"], "too": ["to", "two"], "two": ["to", "too"],
  "your": ["you're"], "you're": ["your"],
  "its": ["it's"], "it's": ["its"],
  "flower": ["flour"], "flour": ["flower"],
  "knight": ["night"], "night": ["knight"],
  "write": ["right", "rite"], "right": ["write", "rite"], "rite": ["write", "right"],
  "sea": ["see"], "see": ["sea"],
  "buy": ["by", "bye"], "by": ["buy", "bye"], "bye": ["buy", "by"],
  "here": ["hear"], "hear": ["here"],
  "where": ["wear", "ware"], "wear": ["where", "ware"], "ware": ["where", "wear"],
  "peace": ["piece"], "piece": ["peace"],
  "break": ["brake"], "brake": ["break"],
  "meat": ["meet"], "meet": ["meat"],
  "plain": ["plane"], "plane": ["plain"],
  "pair": ["pear", "pare"], "pear": ["pair", "pare"], "pare": ["pair", "pear"],
  "road": ["rode", "rowed"], "rode": ["road", "rowed"], "rowed": ["road", "rode"],
  "sun": ["son"], "son": ["sun"],
  "whole": ["hole"], "hole": ["whole"],
  "weak": ["week"], "week": ["weak"],
  "threw": ["through"], "through": ["threw"],
  "know": ["no"], "no": ["know"],
  "new": ["knew"], "knew": ["new"],
  "eight": ["ate"], "ate": ["eight"],
  "aisle": ["isle", "i'll"], "isle": ["aisle", "i'll"], "i'll": ["aisle", "isle"],
  "cell": ["sell"], "sell": ["cell"],
  "cent": ["scent", "sent"], "scent": ["cent", "sent"], "sent": ["cent", "scent"],
  "fair": ["fare"], "fare": ["fair"],
  "hair": ["hare"], "hare": ["hair"],
  "heal": ["heel", "he'll"], "heel": ["heal", "he'll"], "he'll": ["heal", "heel"],
  "made": ["maid"], "maid": ["made"],
  "mail": ["male"], "male": ["mail"],
  "main": ["mane"], "mane": ["main"],
  "none": ["nun"], "nun": ["none"],
  "pause": ["paws"], "paws": ["pause"],
  "pray": ["prey"], "prey": ["pray"],
  "raise": ["rays", "raze"], "rays": ["raise", "raze"], "raze": ["raise", "rays"],
  "read": ["red"], "red": ["read"],
  "real": ["reel"], "reel": ["real"],
  "steak": ["stake"], "stake": ["steak"],
  "tail": ["tale"], "tale": ["tail"],
  "waist": ["waste"], "waste": ["waist"],
  "weather": ["whether"], "whether": ["weather"],
  "which": ["witch"], "witch": ["which"],
  "wood": ["would"], "would": ["wood"],
  "one": ["won"], "won": ["one"],
  "cereal": ["serial"], "serial": ["cereal"],
  "principal": ["principle"], "principle": ["principal"],
  "complement": ["compliment"], "compliment": ["complement"],
  "desert": ["dessert"], "dessert": ["desert"],
  "stationary": ["stationery"], "stationery": ["stationary"],
}

// Pilih pasangan homofon secara deterministik (biar konsisten kalau kata sama muncul berkali-kali di 1 teks)
function pickHomofon(list, seedIdx) {
  if (!list || !list.length) return null
  return list[seedIdx % list.length]
}

// Samakan pola kapitalisasi kata pengganti dengan kata asli (Title Case / UPPERCASE / lowercase)
function matchCase(original, replacement) {
  if (original === original.toUpperCase() && /[A-Za-z]/.test(original)) return replacement.toUpperCase()
  if (original[0] === original[0].toUpperCase() && original.slice(1) === original.slice(1).toLowerCase()) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1)
  }
  return replacement
}

// Konversi teks bebas menjadi versi homofon. lang: "id" | "en" | "auto"
function convertToHomofon(text, lang) {
  if (!text) return ""
  let dict
  if (lang === "id") dict = HOMOFON_ID
  else if (lang === "en") dict = HOMOFON_EN
  else dict = { ...HOMOFON_EN, ...HOMOFON_ID } // auto/campur: gabung dua kamus, ID menang jika bentrok

  let counter = 0
  // Tokenisasi: pisahkan kata (huruf/apostrof) dari tanda baca & spasi, keduanya dipertahankan persis.
  const tokens = text.match(/[A-Za-zÀ-ÿ']+|[^A-Za-zÀ-ÿ']+/g) || []
  const out = tokens.map((tok) => {
    const lower = tok.toLowerCase()
    const candidates = dict[lower]
    if (!candidates) return tok
    const chosen = pickHomofon(candidates, counter++)
    if (!chosen) return tok
    return matchCase(tok, chosen)
  })
  return out.join("")
}

function bindHomofonUI() {
  segment("hf-lang")
  segment("hf-mode", (val) => {
    const aiOpts = $("#hf-ai-options")
    if (aiOpts) aiOpts.classList.toggle("hidden", val !== "ai")
    const btnConvert = $("#hf-convert")
    if (btnConvert) btnConvert.textContent = val === "ai" ? "✨ Ubah dengan AI" : "🔤 Ubah ke Homofon"
  })

  const btnConvert = $("#hf-convert")
  const btnClear = $("#hf-clear")
  const btnCopy = $("#hf-copy")
  const btnDownload = $("#hf-download")

  if (btnConvert) btnConvert.addEventListener("click", async () => {
    const input = $("#hf-input").value
    if (!input.trim()) { toast("Tulis teks dulu ya", "error"); return }
    const lang = $("#hf-lang").dataset.value || "id"
    const mode = $("#hf-mode").dataset.value || "manual"

    if (mode === "manual") {
      // Mode kamus lokal
      const result = convertToHomofon(input, lang)
      $("#hf-output").value = result
      $("#hf-status").textContent = "✅ Selesai diubah ke homofon (kamus lokal)"
      setTimeout(() => { const s = $("#hf-status"); if (s) s.textContent = "" }, 3000)
    } else {
      // Mode AI (Gemini)
      btnConvert.disabled = true
      $("#hf-status").textContent = "✨ Gemini sedang memproses…"
      try {
        const model = $("#hf-model").value || "gemini-2.5-flash"
        const extra = $("#hf-extra").value.trim()
        const r = await api("/api/homofon/ai", {
          method: "POST",
          body: { text: input, language: lang, model, extra }
        })
        $("#hf-output").value = r.result
        $("#hf-status").textContent = "✅ Selesai diubah dengan AI (model: " + (r.model || model) + ")"
        setTimeout(() => { const s = $("#hf-status"); if (s) s.textContent = "" }, 4000)
      } catch (e) {
        $("#hf-status").textContent = "❌ " + e.message
        toast(e.message, "error")
      } finally {
        btnConvert.disabled = false
      }
    }
  })
  if (btnClear) btnClear.addEventListener("click", () => {
    $("#hf-input").value = ""
    $("#hf-output").value = ""
    $("#hf-status").textContent = ""
  })
  if (btnCopy) btnCopy.addEventListener("click", async () => {
    const out = $("#hf-output").value
    if (!out) { toast("Belum ada hasil untuk disalin", "error"); return }
    try { await navigator.clipboard.writeText(out); toast("Tersalin ke clipboard", "success") }
    catch { toast("Gagal menyalin", "error") }
  })
  if (btnDownload) btnDownload.addEventListener("click", () => {
    const out = $("#hf-output").value
    if (!out) { toast("Belum ada hasil untuk diunduh", "error"); return }
    const blob = new Blob([out], { type: "text/plain;charset=utf-8" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = "homofon.txt"
    document.body.appendChild(a); a.click(); a.remove()
  })
}

// ============================== MASTERING ===================================
const MASTER_PRESETS = {
  netral: { eq: { low: 0, lowMid: 0, highMid: 0, high: 0 }, comp: { thresh: -24, ratio: 3, attack: 10, release: 250, makeup: 0 }, ceiling: -1, width: 100, hpf: 30, saturation: 0, multiband: false },
  pop: { eq: { low: 1.5, lowMid: 0, highMid: 2, high: 2.5 }, comp: { thresh: -20, ratio: 4, attack: 6, release: 180, makeup: 3 }, ceiling: -1, width: 115, hpf: 35, saturation: 10, multiband: false },
  hiphop: { eq: { low: 4, lowMid: 1, highMid: -1, high: 1.5 }, comp: { thresh: -18, ratio: 5, attack: 5, release: 200, makeup: 4 }, ceiling: -0.8, width: 105, hpf: 25, saturation: 15, multiband: true },
  edm: { eq: { low: 3.5, lowMid: -1, highMid: 1, high: 3 }, comp: { thresh: -16, ratio: 6, attack: 3, release: 150, makeup: 5 }, ceiling: -0.5, width: 140, hpf: 30, saturation: 20, multiband: true },
  rock: { eq: { low: 2, lowMid: 1.5, highMid: 2.5, high: 1.5 }, comp: { thresh: -20, ratio: 4.5, attack: 8, release: 200, makeup: 3.5 }, ceiling: -1, width: 120, hpf: 40, saturation: 12, multiband: false },
  akustik: { eq: { low: 0.5, lowMid: 0.5, highMid: 1, high: 1 }, comp: { thresh: -26, ratio: 2.5, attack: 15, release: 300, makeup: 1.5 }, ceiling: -1.5, width: 100, hpf: 30, saturation: 5, multiband: false },
  spotify: { eq: { low: 1, lowMid: 0, highMid: 1.5, high: 2 }, comp: { thresh: -20, ratio: 3.5, attack: 8, release: 200, makeup: 2.5 }, ceiling: -1, width: 110, hpf: 30, saturation: 8, multiband: false, targetLufs: -14 },
  youtube: { eq: { low: 1.5, lowMid: 0, highMid: 2, high: 2 }, comp: { thresh: -18, ratio: 4, attack: 6, release: 180, makeup: 3 }, ceiling: -1, width: 110, hpf: 30, saturation: 10, multiband: false, targetLufs: -13 },
  cd: { eq: { low: 2, lowMid: 0.5, highMid: 2, high: 2.5 }, comp: { thresh: -16, ratio: 5, attack: 5, release: 150, makeup: 5 }, ceiling: -0.3, width: 115, hpf: 25, saturation: 15, multiband: true, targetLufs: -9 },
  custom: null,
}

const mst = {
  ctx: null,
  buffer: null,
  sourceLabel: "",
  sourceKind: "", // "library" | "upload"
  sourceSongId: null,
  sourceFileName: "",
  previewCtx: null,
  previewSource: null,
  isPreviewing: false,
  abMode: "processed", // "processed" | "original"
}

function mstParams() {
  return {
    eq: {
      low: parseFloat($("#mst-eq-low")?.value || 0),
      lowMid: parseFloat($("#mst-eq-lowmid")?.value || 0),
      highMid: parseFloat($("#mst-eq-highmid")?.value || 0),
      high: parseFloat($("#mst-eq-high")?.value || 0),
    },
    comp: {
      thresh: parseFloat($("#mst-comp-thresh")?.value || -24),
      ratio: parseFloat($("#mst-comp-ratio")?.value || 3),
      attack: parseFloat($("#mst-comp-attack")?.value || 10) / 1000,
      release: parseFloat($("#mst-comp-release")?.value || 250) / 1000,
      makeup: parseFloat($("#mst-comp-makeup")?.value || 0),
    },
    ceiling: parseFloat($("#mst-limiter-ceiling")?.value || -1),
    width: parseFloat($("#mst-width")?.value || 100),
    outGain: parseFloat($("#mst-outgain")?.value || 0),
    hpf: parseFloat($("#mst-hpf")?.value || 30),
    saturation: parseFloat($("#mst-saturation")?.value || 0),
    multiband: $("#mst-multiband")?.checked || false,
  }
}

function mstApplyParamsToUI(p) {
  const set = (id, val) => { const el = $(id); if (el) el.value = val }
  const setV = (id, val) => { const el = $(id); if (el) el.textContent = val }
  set("#mst-eq-low", p.eq.low); setV("#mst-eq-low-v", p.eq.low)
  set("#mst-eq-lowmid", p.eq.lowMid); setV("#mst-eq-lowmid-v", p.eq.lowMid)
  set("#mst-eq-highmid", p.eq.highMid); setV("#mst-eq-highmid-v", p.eq.highMid)
  set("#mst-eq-high", p.eq.high); setV("#mst-eq-high-v", p.eq.high)
  set("#mst-comp-thresh", p.comp.thresh); setV("#mst-comp-thresh-v", p.comp.thresh)
  set("#mst-comp-ratio", p.comp.ratio); setV("#mst-comp-ratio-v", p.comp.ratio)
  // Preset dan hasil Auto Mastering memakai milidetik, sama seperti nilai slider.
  // Konversi ke detik hanya dilakukan oleh mstParams() saat membangun Web Audio graph.
  set("#mst-comp-attack", p.comp.attack); setV("#mst-comp-attack-v", p.comp.attack)
  set("#mst-comp-release", p.comp.release); setV("#mst-comp-release-v", p.comp.release)
  set("#mst-comp-makeup", p.comp.makeup); setV("#mst-comp-makeup-v", p.comp.makeup)
  set("#mst-limiter-ceiling", p.ceiling); setV("#mst-limiter-ceiling-v", p.ceiling)
  set("#mst-width", p.width); setV("#mst-width-v", p.width)
  if (p.outGain !== undefined) { set("#mst-outgain", p.outGain); setV("#mst-outgain-v", p.outGain) }
  if (p.hpf !== undefined) { set("#mst-hpf", p.hpf); setV("#mst-hpf-v", p.hpf) }
  if (p.saturation !== undefined) { set("#mst-saturation", p.saturation); setV("#mst-saturation-v", p.saturation) }
  const mbEl = $("#mst-multiband")
  if (mbEl && p.multiband !== undefined) mbEl.checked = p.multiband
}

// Bangun graph Web Audio dengan semua fitur mastering
function buildMasterGraph(ctx, params) {
  const numChannels = (mst.buffer && mst.buffer.numberOfChannels) || 2
  const isMono = numChannels < 2

  // 1. High-pass filter (rumble cut)
  const hpf = ctx.createBiquadFilter()
  hpf.type = "highpass"
  hpf.frequency.value = params.hpf || 30
  hpf.Q.value = 0.707 // Butterworth

  // 2. EQ 4-band
  const low = ctx.createBiquadFilter(); low.type = "lowshelf"; low.frequency.value = 100; low.gain.value = params.eq.low
  const lowMid = ctx.createBiquadFilter(); lowMid.type = "peaking"; lowMid.frequency.value = 400; lowMid.Q.value = 1; lowMid.gain.value = params.eq.lowMid
  const highMid = ctx.createBiquadFilter(); highMid.type = "peaking"; highMid.frequency.value = 2500; highMid.Q.value = 1; highMid.gain.value = params.eq.highMid
  const high = ctx.createBiquadFilter(); high.type = "highshelf"; high.frequency.value = 8000; high.gain.value = params.eq.high

  // 3. Saturation (waveshaper soft-clip)
  const satNode = ctx.createWaveShaper()
  const satAmount = (params.saturation || 0) / 100 // 0-1
  if (satAmount > 0) {
    const n = 256
    const curve = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1
      // Soft-clip tanh-style curve, adjustable drive
      const drive = 1 + satAmount * 4
      curve[i] = Math.tanh(x * drive) / Math.tanh(drive)
    }
    satNode.curve = curve
    satNode.oversample = "4x"
  } else {
    satNode.curve = null
  }

  // 4. Multiband compression (3-band: low < 200Hz, mid 200-4000Hz, high > 4000Hz)
  let multibandOutput
  if (params.multiband) {
    const mbSplit1 = ctx.createBiquadFilter(); mbSplit1.type = "lowpass"; mbSplit1.frequency.value = 200; mbSplit1.Q.value = 0.5
    const mbSplit1Hi = ctx.createBiquadFilter(); mbSplit1Hi.type = "highpass"; mbSplit1Hi.frequency.value = 200; mbSplit1Hi.Q.value = 0.5
    const mbSplit2 = ctx.createBiquadFilter(); mbSplit2.type = "lowpass"; mbSplit2.frequency.value = 4000; mbSplit2.Q.value = 0.5
    const mbSplit2Hi = ctx.createBiquadFilter(); mbSplit2Hi.type = "highpass"; mbSplit2Hi.frequency.value = 4000; mbSplit2Hi.Q.value = 0.5

    const mbCompLow = ctx.createDynamicsCompressor()
    mbCompLow.threshold.value = params.comp.thresh + 2; mbCompLow.ratio.value = Math.min(params.comp.ratio + 1, 20)
    mbCompLow.attack.value = params.comp.attack * 1.5; mbCompLow.release.value = params.comp.release * 1.2; mbCompLow.knee.value = 6

    const mbCompMid = ctx.createDynamicsCompressor()
    mbCompMid.threshold.value = params.comp.thresh; mbCompMid.ratio.value = params.comp.ratio
    mbCompMid.attack.value = params.comp.attack; mbCompMid.release.value = params.comp.release; mbCompMid.knee.value = 6

    const mbCompHigh = ctx.createDynamicsCompressor()
    mbCompHigh.threshold.value = params.comp.thresh - 2; mbCompHigh.ratio.value = Math.max(params.comp.ratio - 0.5, 1)
    mbCompHigh.attack.value = params.comp.attack * 0.7; mbCompHigh.release.value = params.comp.release * 0.8; mbCompHigh.knee.value = 6

    const mbMerge = ctx.createGain(); mbMerge.gain.value = 1

    // Connect: input -> split -> compress per band -> merge
    satNode.connect(mbSplit1); satNode.connect(mbSplit1Hi)
    mbSplit1.connect(mbCompLow); mbCompLow.connect(mbMerge)
    mbSplit1Hi.connect(mbSplit2); mbSplit1Hi.connect(mbSplit2Hi)
    mbSplit2.connect(mbCompMid); mbCompMid.connect(mbMerge)
    mbSplit2Hi.connect(mbCompHigh); mbCompHigh.connect(mbMerge)

    multibandOutput = mbMerge
  }

  // 5. Single-band compressor (used when multiband is off)
  const comp = ctx.createDynamicsCompressor()
  comp.threshold.value = params.comp.thresh
  comp.ratio.value = params.comp.ratio
  comp.attack.value = params.comp.attack
  comp.release.value = params.comp.release
  comp.knee.value = 6

  const makeup = ctx.createGain(); makeup.gain.value = Math.pow(10, params.comp.makeup / 20)

  // 6. Limiter (brickwall)
  const limiter = ctx.createDynamicsCompressor()
  limiter.threshold.value = params.ceiling
  limiter.ratio.value = 20
  limiter.attack.value = 0.001
  limiter.release.value = 0.05
  limiter.knee.value = 0

  // 7. Output gain
  const outGain = ctx.createGain(); outGain.gain.value = Math.pow(10, (params.outGain || 0) / 20)

  // === Connect chain ===
  // HPF -> EQ -> Saturation
  hpf.connect(low); low.connect(lowMid); lowMid.connect(highMid); highMid.connect(high); high.connect(satNode)

  if (params.multiband) {
    // Saturation -> Multiband comp -> Makeup -> Limiter
    multibandOutput.connect(makeup)
  } else {
    // Saturation -> Single comp -> Makeup -> Limiter
    satNode.connect(comp); comp.connect(makeup)
  }

  makeup.connect(limiter)

  // 8. Stereo widener (skip untuk mono)
  if (isMono) {
    limiter.connect(outGain)
  } else {
    const splitter = ctx.createChannelSplitter(2)
    const merger = ctx.createChannelMerger(2)
    const widthFactor = params.width / 100

    const midGainL = ctx.createGain(); midGainL.gain.value = 0.5
    const midGainR = ctx.createGain(); midGainR.gain.value = 0.5
    const midSum = ctx.createGain(); midSum.gain.value = 1

    const sideGainL = ctx.createGain(); sideGainL.gain.value = 0.5
    const sideGainR = ctx.createGain(); sideGainR.gain.value = -0.5
    const sideSum = ctx.createGain(); sideSum.gain.value = 1
    const widthGain = ctx.createGain(); widthGain.gain.value = widthFactor
    const negWidthGain = ctx.createGain(); negWidthGain.gain.value = -widthFactor

    const outLSum = ctx.createGain(); outLSum.gain.value = 1
    const outRSum = ctx.createGain(); outRSum.gain.value = 1

    limiter.connect(splitter)
    splitter.connect(midGainL, 0); splitter.connect(midGainR, 1)
    midGainL.connect(midSum); midGainR.connect(midSum)
    splitter.connect(sideGainL, 0); splitter.connect(sideGainR, 1)
    sideGainL.connect(sideSum); sideGainR.connect(sideSum)
    sideSum.connect(widthGain); sideSum.connect(negWidthGain)
    midSum.connect(outLSum); widthGain.connect(outLSum)
    midSum.connect(outRSum); negWidthGain.connect(outRSum)
    outLSum.connect(merger, 0, 0)
    outRSum.connect(merger, 0, 1)
    merger.connect(outGain)
  }

  return { input: hpf, output: outGain }
}

// Analisis loudness (RMS, peak, dan estimasi LUFS) dari AudioBuffer.
function analyzeLoudness(buffer) {
  let sumSquares = 0, count = 0, peak = 0
  const step = Math.max(1, Math.floor(buffer.length / 200000))
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch)
    for (let i = 0; i < data.length; i += step) {
      const v = data[i]
      sumSquares += v * v
      count++
      const a = Math.abs(v)
      if (a > peak) peak = a
    }
  }
  const rms = Math.sqrt(sumSquares / Math.max(1, count))
  const rmsDb = rms > 0 ? 20 * Math.log10(rms) : -60
  const peakDb = peak > 0 ? 20 * Math.log10(peak) : -60
  // Estimasi LUFS (approx: RMS dB - 0.691 untuk mono/stereo sederhana)
  // Ini bukan ITU-R BS.1770 akurat, tapi cukup dekat untuk indikator UI.
  const lufs = rmsDb - 0.7
  return { rmsDb, peakDb, lufs }
}

// Mode Otomatis: analisis loudness lalu setel parameter secara otomatis (rule-based) menuju target streaming (~-14 LUFS RMS perkiraan).
function autoMasterAnalyze(buffer, targetLufs) {
  const { rmsDb, peakDb, lufs } = analyzeLoudness(buffer)
  const target = targetLufs || -14
  const neededGain = Math.min(12, Math.max(0, target - lufs))
  const preset = MASTER_PRESETS.pop
  const params = {
    eq: { ...preset.eq },
    comp: {
      thresh: Math.max(-40, Math.min(-12, rmsDb - 4)),
      ratio: peakDb - rmsDb > 18 ? 5 : 3.5,
      attack: 8,
      release: 220,
      makeup: Math.round(neededGain * 10) / 10,
    },
    ceiling: -1,
    width: 115,
    outGain: 0,
    hpf: 30,
    saturation: neededGain > 4 ? 12 : 6,
    multiband: peakDb - rmsDb > 15,
  }
  return params
}

// Tampilkan meter LUFS di UI
function mstUpdateLufsMeter(buffer, elementId) {
  const el = $(elementId)
  if (!el || !buffer) return
  const { rmsDb, peakDb, lufs } = analyzeLoudness(buffer)
  el.innerHTML = `<span class="lufs-val">${lufs.toFixed(1)} LUFS</span> <span class="lufs-detail">(RMS: ${rmsDb.toFixed(1)} dB | Peak: ${peakDb.toFixed(1)} dB)</span>`
}

function mstSetStudioVisible(show, label) {
  const studio = $("#mst-studio")
  if (studio) studio.classList.toggle("hidden", !show)
  const nameEl = $("#mst-source-name")
  if (nameEl && label) nameEl.textContent = label
}

async function populateMasteringSongSelect() {
  const sel = $("#mst-song-select")
  if (!sel) return
  if (!state.songs || !state.songs.length) { try { await loadSongs(false) } catch {} }
  const playable = (state.songs || []).filter((s) => s.status === "success" && firstAudioSrc(s))
  sel.innerHTML = '<option value="">— Pilih lagu dari Library —</option>' +
    playable.map((s) => `<option value="${s.id}">${escapeHtml(s.title || "Tanpa judul")}</option>`).join("")
}

async function mstDecodeArrayBuffer(arrayBuffer) {
  if (!mst.ctx) mst.ctx = new (window.AudioContext || window.webkitAudioContext)()
  return await mst.ctx.decodeAudioData(arrayBuffer.slice(0))
}

async function loadMasteringSourceFromSong(songId) {
  const song = (state.songs || []).find((s) => s.id === songId)
  if (!song) return
  const src = firstAudioSrc(song)
  if (!src) { toast("Lagu ini belum punya audio", "error"); return }
  $("#mst-source-status").textContent = "⏳ Mengambil audio dari Library…"
  try {
    const streamUrl = "/api/songs/" + song.id + "/stream?src=" + encodeURIComponent(src)
    const res = await fetch(streamUrl)
    if (!res.ok) throw new Error("Gagal mengambil audio (HTTP " + res.status + ")")
    const arrBuf = await res.arrayBuffer()
    mst.buffer = await mstDecodeArrayBuffer(arrBuf)
    mst.sourceKind = "library"
    mst.sourceSongId = song.id
    mst.sourceFileName = (song.title || "lagu") + ".wav"
    mst.sourceLabel = "📚 " + (song.title || "Tanpa judul")
    $("#mst-audio-preview").src = streamUrl
    $("#mst-source-status").textContent = "✅ Audio siap dimaster"
    mstUpdateLufsMeter(mst.buffer, "#mst-lufs-before")
    $("#mst-lufs-after").textContent = "— LUFS"
    mstSetStudioVisible(true, mst.sourceLabel)
  } catch (e) {
    $("#mst-source-status").textContent = ""
    toast(e.message || "Gagal memuat audio", "error")
  }
}

async function loadMasteringSourceFromFile(file) {
  if (!file) return
  $("#mst-source-status").textContent = "⏳ Membaca file…"
  try {
    const arrBuf = await file.arrayBuffer()
    mst.buffer = await mstDecodeArrayBuffer(arrBuf)
    mst.sourceKind = "upload"
    mst.sourceSongId = null
    mst.sourceFileName = file.name
    mst.sourceLabel = "📤 " + file.name
    $("#mst-audio-preview").src = URL.createObjectURL(file)
    $("#mst-source-status").textContent = "✅ Audio siap dimaster"
    mstUpdateLufsMeter(mst.buffer, "#mst-lufs-before")
    $("#mst-lufs-after").textContent = "— LUFS"
    $("#mst-file-label").textContent = file.name
    mstSetStudioVisible(true, mst.sourceLabel)
  } catch (e) {
    $("#mst-source-status").textContent = ""
    toast("File audio tidak bisa dibaca: " + e.message, "error")
  }
}

function mstStopPreview() {
  if (mst.previewSource) { try { mst.previewSource.stop() } catch {} mst.previewSource = null }
  mst.isPreviewing = false
  const btn = $("#mst-preview-btn")
  if (btn) btn.textContent = "▶️ Preview"
}

function mstStartPreview() {
  if (!mst.buffer) { toast("Pilih sumber audio dulu", "error"); return }
  if (!mst.previewCtx) mst.previewCtx = new (window.AudioContext || window.webkitAudioContext)()
  const ctx = mst.previewCtx
  const src = ctx.createBufferSource()
  src.buffer = mst.buffer

  if (mst.abMode === "original") {
    // A/B: langsung tanpa processing
    src.connect(ctx.destination)
  } else {
    // A/B: dengan processing
    const graph = buildMasterGraph(ctx, mstParams())
    src.connect(graph.input)
    graph.output.connect(ctx.destination)
  }

  src.start()
  src.onended = () => { if (mst.previewSource === src) mstStopPreview() }
  mst.previewSource = src
  mst.isPreviewing = true
  const btn = $("#mst-preview-btn")
  if (btn) btn.textContent = "⏹️ Stop Preview"
}

// Encode AudioBuffer ke WAV 16-bit PCM dengan TPDF dithering.
function audioBufferToWav(buffer) {
  const numCh = buffer.numberOfChannels
  const sampleRate = buffer.sampleRate
  const numFrames = buffer.length
  const bytesPerSample = 2
  const blockAlign = numCh * bytesPerSample
  const dataSize = numFrames * blockAlign
  const bufferArr = new ArrayBuffer(44 + dataSize)
  const view = new DataView(bufferArr)
  const writeStr = (offset, str) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)) }
  writeStr(0, "RIFF"); view.setUint32(4, 36 + dataSize, true); writeStr(8, "WAVE")
  writeStr(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true)
  view.setUint16(22, numCh, true); view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true); view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true); writeStr(36, "data"); view.setUint32(40, dataSize, true)

  const channels = []
  for (let ch = 0; ch < numCh; ch++) channels.push(buffer.getChannelData(ch))

  // TPDF dithering: tambah noise segitiga sebesar 1 LSB sebelum quantize ke 16-bit.
  // Ini mengurangi distorsi kuantisasi di bagian audio yang pelan.
  let offset = 44
  for (let i = 0; i < numFrames; i++) {
    for (let ch = 0; ch < numCh; ch++) {
      let s = channels[ch][i]
      // TPDF: dua random uniform dijumlah → distribusi segitiga ±1 LSB
      const r1 = Math.random() - 0.5
      const r2 = Math.random() - 0.5
      const dither = (r1 + r2) / 0x7fff // 1 LSB di 16-bit
      s = s + dither
      s = Math.max(-1, Math.min(1, s))
      s = s < 0 ? s * 0x8000 : s * 0x7fff
      view.setInt16(offset, Math.round(s), true)
      offset += 2
    }
  }
  return new Blob([bufferArr], { type: "audio/wav" })
}

async function mstRender() {
  if (!mst.buffer) { toast("Pilih sumber audio dulu", "error"); return null }
  const statusEl = $("#mst-render-status")
  if (statusEl) statusEl.textContent = "⏳ Merender audio…"
  const buffer = mst.buffer
  const offline = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, buffer.sampleRate)
  const src = offline.createBufferSource()
  src.buffer = buffer
  const graph = buildMasterGraph(offline, mstParams())
  src.connect(graph.input)
  graph.output.connect(offline.destination)
  src.start()
  const rendered = await offline.startRendering()
  const blob = audioBufferToWav(rendered)
  if (statusEl) statusEl.textContent = "✅ Render selesai"
  // Update LUFS meter after render
  mstUpdateLufsMeter(rendered, "#mst-lufs-after")
  return blob
}

function mstDownloadBlob(blob, filename) {
  const a = document.createElement("a")
  a.href = URL.createObjectURL(blob)
  a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
}

// Encode AudioBuffer ke MP3 224kbps menggunakan lamejs
function audioBufferToMp3(buffer) {
  const numCh = buffer.numberOfChannels
  const sampleRate = buffer.sampleRate
  const numFrames = buffer.length
  const kbps = 224

  // lamejs expects Int16 samples
  const left = new Int16Array(numFrames)
  const right = numCh > 1 ? new Int16Array(numFrames) : null
  const leftData = buffer.getChannelData(0)
  const rightData = numCh > 1 ? buffer.getChannelData(1) : null

  for (let i = 0; i < numFrames; i++) {
    let s = leftData[i]
    s = Math.max(-1, Math.min(1, s))
    left[i] = Math.round(s < 0 ? s * 0x8000 : s * 0x7fff)
    if (right && rightData) {
      let r = rightData[i]
      r = Math.max(-1, Math.min(1, r))
      right[i] = Math.round(r < 0 ? r * 0x8000 : r * 0x7fff)
    }
  }

  const mp3encoder = new lamejs.Mp3Encoder(numCh, sampleRate, kbps)
  const mp3Data = []
  const blockSize = 1152

  for (let i = 0; i < numFrames; i += blockSize) {
    const leftChunk = left.subarray(i, Math.min(i + blockSize, numFrames))
    const rightChunk = right ? right.subarray(i, Math.min(i + blockSize, numFrames)) : null
    let mp3buf
    if (numCh === 1) {
      mp3buf = mp3encoder.encodeBuffer(leftChunk)
    } else {
      mp3buf = mp3encoder.encodeBuffer(leftChunk, rightChunk)
    }
    if (mp3buf.length > 0) mp3Data.push(mp3buf)
  }

  const end = mp3encoder.flush()
  if (end.length > 0) mp3Data.push(end)

  return new Blob(mp3Data, { type: "audio/mpeg" })
}

// Get selected format and render accordingly
function mstGetFormat() {
  const fmtEl = $("#mst-format")
  return (fmtEl && fmtEl.dataset.value) || "wav"
}

async function mstRenderToFormat() {
  if (!mst.buffer) { toast("Pilih sumber audio dulu", "error"); return null }
  const statusEl = $("#mst-render-status")
  const format = mstGetFormat()

  if (statusEl) statusEl.textContent = "⏳ Merender audio…"
  const buffer = mst.buffer
  const offline = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, buffer.sampleRate)
  const src = offline.createBufferSource()
  src.buffer = buffer
  const graph = buildMasterGraph(offline, mstParams())
  src.connect(graph.input)
  graph.output.connect(offline.destination)
  src.start()
  const rendered = await offline.startRendering()

  // Update LUFS meter after render
  mstUpdateLufsMeter(rendered, "#mst-lufs-after")

  let blob
  if (format === "mp3") {
    if (typeof lamejs === "undefined") {
      toast("Library lamejs belum dimuat, coba refresh halaman", "error")
      return null
    }
    if (statusEl) statusEl.textContent = "⏳ Encoding MP3 224kbps…"
    blob = audioBufferToMp3(rendered)
    if (statusEl) statusEl.textContent = "✅ Render MP3 selesai"
  } else {
    blob = audioBufferToWav(rendered)
    if (statusEl) statusEl.textContent = "✅ Render WAV selesai"
  }
  return { blob, format }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(String(reader.result).split(",")[1] || "")
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

function bindMasteringUI() {
  segment("mst-source-tabs", (val) => {
    qa(".mst-source-panel").forEach((p) => p.classList.toggle("hidden", p.dataset.srcPanel !== val))
  })
  segment("mst-format")
  segment("mst-mode", (val) => {
    if (val === "auto" && mst.buffer) {
      const targetSel = $("#mst-target")
      const targetLufs = targetSel ? parseFloat(targetSel.value) : -14
      const params = autoMasterAnalyze(mst.buffer, targetLufs)
      mstApplyParamsToUI(params)
      $("#mst-preset").value = "custom"
      toast("🤖 Analisis otomatis diterapkan", "success")
    }
  })

  const songSelect = $("#mst-song-select")
  if (songSelect) songSelect.addEventListener("change", (e) => {
    mstStopPreview()
    if (e.target.value) loadMasteringSourceFromSong(e.target.value)
  })

  const fileInput = $("#mst-file")
  const dropZone = $("#mst-drop-zone")
  if (dropZone && fileInput) {
    dropZone.addEventListener("click", () => fileInput.click())
    dropZone.addEventListener("dragover", (e) => { e.preventDefault(); dropZone.classList.add("dragover") })
    dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"))
    dropZone.addEventListener("drop", (e) => {
      e.preventDefault(); dropZone.classList.remove("dragover")
      const f = e.dataTransfer.files[0]
      if (f) { mstStopPreview(); loadMasteringSourceFromFile(f) }
    })
  }
  if (fileInput) fileInput.addEventListener("change", (e) => {
    const f = e.target.files[0]
    if (f) { mstStopPreview(); loadMasteringSourceFromFile(f) }
  })

  const presetSel = $("#mst-preset")
  if (presetSel) presetSel.addEventListener("change", (e) => {
    const preset = MASTER_PRESETS[e.target.value]
    if (preset) mstApplyParamsToUI({ ...preset, outGain: preset.outGain || 0 })
  })

  // Loudness target selector
  const targetSel = $("#mst-target")
  if (targetSel) targetSel.addEventListener("change", () => {
    const mode = $("#mst-mode")
    if (mode && mode.dataset.value === "auto" && mst.buffer) {
      const targetLufs = parseFloat(targetSel.value)
      const params = autoMasterAnalyze(mst.buffer, targetLufs)
      mstApplyParamsToUI(params)
      $("#mst-preset").value = "custom"
      toast("Target diperbarui", "success")
    }
  })

  // A/B comparison toggle
  const abBtn = $("#mst-ab-btn")
  if (abBtn) abBtn.addEventListener("click", () => {
    mst.abMode = mst.abMode === "processed" ? "original" : "processed"
    abBtn.textContent = mst.abMode === "processed" ? "🔀 A/B: Processed" : "🔀 A/B: Original"
    abBtn.classList.toggle("ab-original", mst.abMode === "original")
    if (mst.isPreviewing) { mstStopPreview(); mstStartPreview() }
  })

  // Range sliders - live update values + restart preview
  qa("#mst-studio input[type=range]").forEach((input) => {
    input.addEventListener("input", (e) => {
      const label = $("#" + e.target.id + "-v")
      if (label) label.textContent = e.target.value
      if (mst.isPreviewing) { mstStopPreview(); mstStartPreview() }
    })
  })

  // Multiband checkbox
  const mbCheck = $("#mst-multiband")
  if (mbCheck) mbCheck.addEventListener("change", () => {
    if (mst.isPreviewing) { mstStopPreview(); mstStartPreview() }
  })

  const previewBtn = $("#mst-preview-btn")
  if (previewBtn) previewBtn.addEventListener("click", () => {
    if (mst.isPreviewing) mstStopPreview()
    else mstStartPreview()
  })

  const downloadBtn = $("#mst-download-btn")
  if (downloadBtn) downloadBtn.addEventListener("click", async () => {
    downloadBtn.disabled = true
    try {
      const result = await mstRenderToFormat()
      if (result) {
        const ext = result.format === "mp3" ? ".mp3" : ".wav"
        const basename = (mst.sourceFileName || "mastered").replace(/\.[^.]+$/, "")
        mstDownloadBlob(result.blob, basename + "-mastered" + ext)
      }
    } catch (e) { toast("Gagal merender: " + e.message, "error") }
    finally { downloadBtn.disabled = false }
  })

  const saveBtn = $("#mst-save-btn")
  if (saveBtn) saveBtn.addEventListener("click", async () => {
    saveBtn.disabled = true
    try {
      const result = await mstRenderToFormat()
      if (!result) return
      const base64Data = await blobToBase64(result.blob)
      const ext = result.format === "mp3" ? ".mp3" : ".wav"
      const title = (mst.sourceKind === "library"
        ? (state.songs.find((s) => s.id === mst.sourceSongId) || {}).title
        : (mst.sourceFileName || "").replace(/\.[^.]+$/, "")) || "Mastered Track"
      const r = await api("/api/mastering/save", { method: "POST", body: {
        base64Data,
        fileName: (mst.sourceFileName || "mastered").replace(/\.[^.]+$/, "") + "-mastered" + ext,
        title: title + " (Mastered)",
        sourceSongId: mst.sourceSongId || null,
      } })
      toast("💾 Tersimpan ke Library", "success")
      $("#mst-render-status").textContent = "✅ Tersimpan ke Library sebagai \"" + (r.song && r.song.title) + "\""
      loadSongs(false)
    } catch (e) { toast("Gagal menyimpan: " + e.message, "error") }
    finally { saveBtn.disabled = false }
  })
}


// ------------------------------ Init ----------------------------------------
async function init() {
  initTheme()
  getClientId()
  window.addEventListener("error", (event) => toast(event.message || "Terjadi kesalahan pada aplikasi", "error"))
  window.addEventListener("unhandledrejection", (event) => toast((event.reason && event.reason.message) || "Permintaan tidak dapat diproses", "error"))
  bindUI()
  initAdvancedOptionsToggle()
  initStylePills()
  initMainPromptResize()
  initUploadDropZone()
  initUploadCharCounters()
  initUploadStylePills()
  initLyricsPage()

  // Set view dulu agar navigasi langsung aktif meski API gagal
  let initialView = "frontpage"
  try { initialView = localStorage.getItem("pbm-last-view") || initialView } catch (_) {}
  if (!qa(".view").some(v => v.dataset.view === initialView)) initialView = "frontpage"
  if(document.body.dataset.pbmAdmin === "frontpage") initialView = "frontpage-admin"
  setView(initialView)

  // API calls wrapped — gagal fetch tidak boleh matikan UI
  try { await loadFrontpage() } catch (e) { console.warn("loadFrontpage:", e) }
  try { await loadModels() } catch (e) { console.warn("loadModels:", e) }
  try { await refreshCredits() } catch (e) { console.warn("refreshCredits:", e) }

  updateLikedCount()

  try { await loadSongs(false) } catch (e) { console.warn("loadSongs:", e) }

  // Update library stats after songs are loaded
  updateLibraryStats()
}
init().catch((e) => { console.error("Init failed:", e); toast && toast("Gagal memuat aplikasi: " + e.message, "error") })


;
(function () {
  'use strict';

  const labels = {
    frontpage: '⌂  Beranda',
    create: '✦  Buat Lagu',
    upload: '↥  Upload Cover',
    library: '♫  Library',
    mastering: '◉  Mastering',
    homofon: 'Aa  Homofon',
    liked: '♡  Disukai',
    lyrics: '✎  Buat Lirik',
    settings: '⚙  Pengaturan'
  };

  function setBrand() {
    document.title = 'pbmstudio';
    document.querySelectorAll('.brand-name').forEach(el => { el.textContent = 'pbmstudio'; });
    document.querySelectorAll('.brand-sub').forEach(el => { el.textContent = 'by Bangalimin'; });
    document.querySelectorAll('.side-nav .nav-item').forEach(btn => {
      const view = btn.dataset.view;
      if (labels[view]) btn.textContent = labels[view];
    });
    document.querySelectorAll('.bn-item').forEach(btn => {
      const view = btn.dataset.view;
      const text = btn.querySelector('span:last-child');
      if (text && labels[view]) text.textContent = labels[view].replace(/^[^A-Za-zÀ-ÿ]+/, '').trim();
    });
  }

  function routeForModel(value) {
    if (/^kie-/i.test(value)) return 'kie';
    if (/^crun-/i.test(value)) return 'crun';
    if (/^suno-/i.test(value)) return 'suno';
    if (/^(lyria|producer|udio)/i.test(value)) return 'apiframe';
    if (/^musicapi-/i.test(value)) return 'musicapi';
    return 'kie';
  }

  function addRouteSelector() {
    if (document.querySelector('.kampung-route')) return;
    const create = document.querySelector('#view-create .create-hero');
    const model = document.querySelector('#f-model');
    if (!create || !model) return;
    const wrap = document.createElement('div');
    wrap.className = 'kampung-route';
    wrap.innerHTML = '<label>Jalur API<small>Pilih penyedia musik</small></label><select id="kampung-route" aria-label="Jalur API"><option value="kie">Kie.ai</option><option value="suno">SunoAPI.org</option><option value="apiframe">Apiframe</option><option value="musicapi">MusicAPI</option><option value="crun">crun.ai</option></select>';
    create.insertBefore(wrap, create.querySelector('.create-form'));
    const route = wrap.querySelector('select');
    route.value = routeForModel(model.value);
    route.addEventListener('change', () => {
      const candidates = Array.from(model.options);
      const found = candidates.find(o => routeForModel(o.value) === route.value);
      if (found) {
        model.value = found.value;
        model.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    model.addEventListener('change', () => { route.value = routeForModel(model.value); });
  }

  function addBoostStyle() {
    if (document.querySelector('#boost-style-btn')) return;
    const box = document.querySelector('.create-main-prompt');
    const input = document.querySelector('#f-style');
    const pills = box && box.querySelector('.style-pills');
    if (!box || !input || !pills) return;

    const bar = document.createElement('div');
    bar.className = 'boost-style-bar';
    bar.innerHTML = '<button type="button" id="boost-style-btn" class="boost-style-btn">✦ Boost Style</button><span>Perjelas genre, mood, tempo, instrumen, vokal, dan dinamika</span>';
    box.insertBefore(bar, pills);

    bar.querySelector('button').addEventListener('click', () => {
      const original = input.value.trim();
      if (!original) {
        if (typeof toast === 'function') toast('Tulis deskripsi lagu terlebih dahulu', 'error');
        input.focus();
        return;
      }

      const low = original.toLowerCase();
      const details = [];
      if (!/\b(bpm|tempo)\b/.test(low)) details.push(/sedih|melankolis|ballad|sendu/.test(low) ? 'tempo lambat 76–86 BPM' : /dance|enerjik|semangat|rock|dangdut/.test(low) ? 'tempo energik 112–128 BPM' : 'tempo sedang 92–108 BPM');
      if (!/instrumen|instrument|piano|gitar|drum|bass|synth|string|biola/.test(low)) details.push('aransemen berlapis dengan piano hangat, gitar yang jelas, bass bulat, dan drum dinamis');
      if (!/vokal|vocal|suara/.test(low)) details.push('vokal utama ekspresif dengan artikulasi jelas dan harmoni lembut pada chorus');
      if (!/verse|chorus|bridge|intro|outro|struktur/.test(low)) details.push('struktur intro singkat, verse intim, pre-chorus membangun, chorus kuat dan mudah diingat, bridge kontras, lalu outro emosional');
      if (!/mix|master|stereo|reverb|produksi/.test(low)) details.push('produksi modern yang bersih, stereo lebar, reverb natural, dinamika bertahap, dan hasil akhir siap streaming');
      if (!/hook|catchy|mudah diingat/.test(low)) details.push('hook melodis yang kuat dan mudah diingat');

      const boosted = details.length ? original.replace(/[.\s]+$/, '') + '. ' + details.join(', ') + '.' : original;
      input.value = boosted.slice(0, 1000);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      if (typeof toast === 'function') toast('Style berhasil diperkuat', 'success');
    });
  }

  function refineHome() {}

  function boot() {
    setBrand();
    addRouteSelector();
    addBoostStyle();
    refineHome();
    setTimeout(refineHome, 600);
    setTimeout(refineHome, 1600);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

function renderUploadCoverModels() {
 const select = document.querySelector('#u-model'); if(!select) return;
 const kie = document.querySelector('#u-provider')?.value === 'kie';
 const models = kie ? [{id:'V4_5PLUS',label:'Suno V4.5 Plus — KIE'},{id:'V5',label:'Suno V5 — KIE'},{id:'V5_5',label:'Suno V5.5 — KIE'},{id:'V4_5',label:'Suno V4.5 — KIE'},{id:'V4_5ALL',label:'Suno V4.5 All — KIE'},{id:'V4',label:'Suno V4 — KIE'}] : state.uploadModels.map(m => typeof m === 'string' ? {id:m,label:m} : m);
 const previous = select.value;
 select.innerHTML = models.map(m=>`<option value="${m.id}">${escapeHtml(m.label)}</option>`).join('');
 if(models.some(m=>m.id===previous))select.value=previous;
}
document.querySelector('#u-provider')?.addEventListener('change', renderUploadCoverModels);
