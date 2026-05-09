// 06_init_events.js
// Asset loading, startup/init, mode switching, event listeners.
// Loaded in order by index.html. Keep the script tag order unless you fully refactor globals.

function loadImageElement(uri) {
    return new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = reject;
      im.src = uri;
    });
  }

  async function imageUriToCanvas(uri) {
    const im = await loadImageElement(uri);
    const c = document.createElement('canvas');
    c.width = GRID_W;
    c.height = GRID_H;
    const cctx = c.getContext('2d');
    cctx.drawImage(im, 0, 0, GRID_W, GRID_H);
    return c;
  }

  async function loadPrecomputedLayers() {
    setProgress('Loading NASADEM elevation grid…', 0.15);

    const dataImg = await loadImageElement(PRECOMP_DATA_URI);
    const dataCanvas = document.createElement('canvas');
    dataCanvas.width = GRID_W;
    dataCanvas.height = GRID_H;
    const dataCtx = dataCanvas.getContext('2d');
    dataCtx.drawImage(dataImg, 0, 0, GRID_W, GRID_H);
    const pix = dataCtx.getImageData(0, 0, GRID_W, GRID_H).data;

    height = new Float32Array(GRID_W * GRID_H);
    land = new Uint8Array(GRID_W * GRID_H);
    biomeId = new Uint8Array(GRID_W * GRID_H);
    dist = new Float32Array(GRID_W * GRID_H);

    bbox = { minX: GRID_W, minY: GRID_H, maxX: 0, maxY: 0 };

    for (let i = 0, p = 0; i < height.length; i++, p += 4) {
      const isLand = pix[p + 3] > 0;
      land[i] = isLand ? 1 : 0;
      biomeId[i] = pix[p + 2];
      height[i] = isLand ? (pix[p] * 256 + pix[p + 1]) : -1;

      if (isLand) {
        const x = i % GRID_W;
        const y = Math.floor(i / GRID_W);
        if (x < bbox.minX) bbox.minX = x;
        if (x > bbox.maxX) bbox.maxX = x;
        if (y < bbox.minY) bbox.minY = y;
        if (y > bbox.maxY) bbox.maxY = y;
      }

      if (i % 250000 === 0) {
        setProgress('Decoding NASADEM elevation grid…', 0.15 + i / height.length * 0.35);
        await sleepFrame();
      }
    }

    setProgress('Loading rendered heightmap layer…', 0.55);
    colorCanvas = await imageUriToCanvas(PRECOMP_RELIEF_URI);

    setProgress('Loading rendered biome layer…', 0.80);
    biomeCanvas = await imageUriToCanvas(PRECOMP_BIOME_URI);

    setProgress('Ready.', 1.0);
  }

  async function init() {
    resize();
    await loadPrecomputedLayers();
    ready = true;
    loading.style.display = 'none';
    resetView();
    refreshSelectionPanels();
    readout.textContent = 'NASA DEM loaded. Hover land to read elevation and biome.';
    requestAnimationFrame(animationLoop);
  }

  canvas.addEventListener('pointerdown', e => {
    if (!ready || e.button !== 0) return;
    pointerDown = true;
    isDragging = false;
    dragStartX = lastDragX = e.clientX;
    dragStartY = lastDragY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', e => {
    if (!ready) return;
    const worldPt = screenToWorld(e.clientX * dpr, e.clientY * dpr);
    const hh = sampleHeightBilinear(worldPt.x, worldPt.y);
    if (hh >= 0) {
      const km = gridToKm(worldPt.x, worldPt.y);
      const pending = pendingDestinationArmyId ? ' · click to set army destination' : '';
      const biome = biomeNameAt(worldPt.x, worldPt.y);
      readout.textContent = `Biome: ${biome} · Elevation: ~${Math.round(hh)}m · x ${Math.round(km.kmX)} km · y ${Math.round(km.kmY)} km${pending}`;
    } else {
      readout.textContent = pendingDestinationArmyId ? 'Sea / off-map area · destination selection still allowed' : 'Sea / off-map area';
    }

    if (pointerDown) {
      const dx = e.clientX - lastDragX;
      const dy = e.clientY - lastDragY;
      if (!isDragging) {
        const moved = Math.hypot(e.clientX - dragStartX, e.clientY - dragStartY);
        if (moved > 5) {
          isDragging = true;
          canvas.classList.add('dragging');
        }
      }
      if (isDragging) {
        world.cx -= (dx * dpr) / world.zoom;
        world.cy -= (dy * dpr) / world.zoom;
        draw();
      }
      lastDragX = e.clientX;
      lastDragY = e.clientY;
    }
  });

  canvas.addEventListener('pointerup', e => {
    if (!ready || e.button !== 0) return;
    const worldPt = screenToWorld(e.clientX * dpr, e.clientY * dpr);
    if (pointerDown && !isDragging) handleClick(worldPt);
    pointerDown = false;
    isDragging = false;
    canvas.classList.remove('dragging');
  });
  canvas.addEventListener('pointerleave', () => { pointerDown = false; isDragging = false; canvas.classList.remove('dragging'); });
  canvas.addEventListener('pointercancel', () => { pointerDown = false; isDragging = false; canvas.classList.remove('dragging'); });

  canvas.addEventListener('contextmenu', e => {
    e.preventDefault();
    if (!ready) return;
    const worldPt = screenToWorld(e.clientX * dpr, e.clientY * dpr);
    showContextMenu(e.clientX, e.clientY, worldPt);
  });

  canvas.addEventListener('wheel', e => {
    if (!ready) return;
    e.preventDefault();
    hideContextMenu();
    const mx = e.clientX * dpr;
    const my = e.clientY * dpr;
    const before = screenToWorld(mx, my);
    const factor = Math.exp(-e.deltaY * 0.00115);
    world.zoom = clamp(world.zoom * factor, 0.22, 120);
    const after = screenToWorld(mx, my);
    world.cx += before.x - after.x;
    world.cy += before.y - after.y;
    draw();
  }, { passive: false });

  function setMapMode(mode) {
    currentMapMode = mode;
    modeHeightBtn.classList.toggle('active', mode === 'height');
    modeBiomeBtn.classList.toggle('active', mode === 'biome');
    if (modeWindBtn) modeWindBtn.classList.toggle('active', mode === 'wind');
    if (mode === 'wind') {
      readout.textContent = 'Wind / sea mode: arrows show sea wind direction. Use Refresh wind for a new wind map.';
    }
    draw();
  }

  battlePanel.addEventListener('click', handleBattlePanelClick);
  battlePanel.addEventListener('change', e => {
    const sel = e.target.closest('.battleArmyStrategy');
    if (!sel) return;
    const army = armyById(sel.dataset.armyId);
    if (!army) return;
    army.strategy = sel.value;
    refreshBattlePanel(true);
    refreshSelectionPanels();
    draw();
  });

  modeHeightBtn.addEventListener('click', () => setMapMode('height'));
  modeBiomeBtn.addEventListener('click', () => setMapMode('biome'));
  if (modeWindBtn) modeWindBtn.addEventListener('click', () => setMapMode('wind'));
  if (refreshWindBtn) refreshWindBtn.addEventListener('click', refreshWindMap);

  menuArmiesBtn.addEventListener('click', () => setActiveMenu('armies'));
  menuEmpiresBtn.addEventListener('click', () => setActiveMenu('empires'));
  menuDiplomacyBtn.addEventListener('click', () => setActiveMenu('diplomacy'));
  menuGuideBtn.addEventListener('click', () => setActiveMenu('guide'));
  createEmpireBtn.addEventListener('click', createEmpireFromInput);
  empireNameInput.addEventListener('keydown', e => { if (e.key === 'Enter') createEmpireFromInput(); });
  assignSettlementBtn.addEventListener('click', assignSelectedSettlementToEmpire);
  setDiplomacyBtn.addEventListener('click', () => {
    const a = empireSelectA.value;
    const b = empireSelectB.value;
    if (!a || !b || a === b) return;
    diplomacyRelations[diplomacyKey(a, b)] = diplomacyStatusSelect.value;
    refreshDiplomacyPanel();
  });
  passTimeBtn.addEventListener('click', passTime);
  exportBtn.addEventListener('click', exportCampaignState);
  importBtn.addEventListener('click', () => importFileInput.click());
  importFileInput.addEventListener('change', async () => {
    const file = importFileInput.files && importFileInput.files[0];
    if (!file) return;
    try {
      const state = JSON.parse(await file.text());
      importCampaignState(state);
    } catch (err) {
      alert('Could not import campaign state: ' + err.message);
    } finally {
      importFileInput.value = '';
    }
  });

  addVillageBtn.addEventListener('click', () => addSettlement('village'));
  addCapitalBtn.addEventListener('click', () => addSettlement('capital'));
  addFortressBtn.addEventListener('click', () => addSettlement('fortress'));
  if (addHarborBtn) addHarborBtn.addEventListener('click', () => addSettlement('harbor'));
  zoomBtn.addEventListener('click', () => {
    if (!selectedContextPoint) return;
    const radius = clamp(parseFloat(radiusInput.value) || 20, 1, 300);
    createZoomPopup({ x: selectedContextPoint.x, y: selectedContextPoint.y }, radius);
    hideContextMenu();
  });
  addArmyBtn.addEventListener('click', createArmyAtSelectedSettlement);
  setDestinationBtn.addEventListener('click', () => {
    if (!selectedArmyId) return;
    pendingDestinationArmyId = selectedArmyId;
    const a = armyById(selectedArmyId);
    if (a) readout.textContent = `Choose a destination for “${a.name}” by clicking on the map.`;
  });

  resetBtn.addEventListener('click', resetView);
  clearAllBtn.addEventListener('click', () => {
    settlements = [];
    armies = [];
    empires = [];
    diplomacyRelations = {};
    encounters = [];
    ignoredEncounterPairs = {};
    activeBattle = null;
    selectedEncounterId = null;
    passedTimeCount = 0;
    selectedSettlementId = null;
    selectedArmyId = null;
    selectedEmpireId = null;
    pendingDestinationArmyId = null;
    refreshSelectionPanels();
    refreshEmpirePanels();
    draw();
  });

  document.addEventListener('click', e => {
    if (!contextMenu.contains(e.target)) hideContextMenu();
  });
  window.addEventListener('resize', resize);

  init().catch(err => {
    console.error(err);
    loadingStep.textContent = 'Error while building map: ' + err.message;
  });
