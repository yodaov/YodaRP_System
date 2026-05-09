// 05_interactions_popups_routes.js
// Main draw, click/selection handling, movement routes, context menu, frozen zoom popups, animation loop.
// Loaded in order by index.html. Keep the script tag order unless you fully refactor globals.

function draw() {
    if (!canvas.width || !canvas.height) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ced7df';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!ready) return;

    const drawX = canvas.width / 2 - world.cx * world.zoom;
    const drawY = canvas.height / 2 - world.cy * world.zoom;
    ctx.imageSmoothingEnabled = true;
    const activeCanvas = currentMapMode === 'biome' ? biomeCanvas : colorCanvas;
    ctx.drawImage(activeCanvas, drawX, drawY, GRID_W * world.zoom, GRID_H * world.zoom);
    drawSettlements(ctx, worldToScreen, 1, 'all');
    drawArmies(ctx, worldToScreen, 1);
    drawEncounterPings(ctx, worldToScreen, 1);
  }

  function findSettlementNear(worldPt, pxRadius = 11) {
    const threshold = (pxRadius * dpr) / world.zoom;
    let best = null, bestDist = Infinity;
    for (const s of settlements) {
      const d = Math.hypot(s.x - worldPt.x, s.y - worldPt.y);
      if (d < threshold && d < bestDist) { best = s; bestDist = d; }
    }
    return best;
  }
  function findArmyNear(worldPt, pxRadius = 12) {
    const threshold = (pxRadius * dpr) / world.zoom;
    let best = null, bestDist = Infinity;
    for (const a of armies) {
      const d = Math.hypot(a.x - worldPt.x, a.y - worldPt.y);
      if (d < threshold && d < bestDist) { best = a; bestDist = d; }
    }
    return best;
  }

  function selectSettlement(id) {
    selectedSettlementId = id;
    selectedArmyId = null;
    pendingDestinationArmyId = null;
    refreshSelectionPanels();
    draw();
  }
  function selectArmy(id) {
    selectedArmyId = id;
    selectedSettlementId = null;
    refreshSelectionPanels();
    draw();
  }

  function addSettlement(type) {
    if (!selectedContextPoint) return;
    const h = sampleHeightBilinear(selectedContextPoint.x, selectedContextPoint.y);
    if (h < 0) return;
    const defaultName = type === 'capital'
      ? `Capital ${settlements.filter(s => s.type === 'capital').length + 1}`
      : type === 'fortress'
        ? `Fortress ${settlements.filter(s => s.type === 'fortress').length + 1}`
        : `Village ${settlements.filter(s => s.type === 'village').length + 1}`;
    const name = prompt(`Name this ${type}:`, defaultName);
    if (name === null) return;
    const s = {
      id: generateId('settlement'),
      type,
      name: name.trim() || defaultName,
      x: selectedContextPoint.x,
      y: selectedContextPoint.y,
      elevation: h,
      biome: biomeNameAt(selectedContextPoint.x, selectedContextPoint.y),
      economy: defaultSettlementEconomy(type)
    };
    settlements.push(s);
    selectedSettlementId = s.id;
    selectedArmyId = null;
    hideContextMenu();
    refreshSelectionPanels();
    refreshEmpirePanels();
    draw();
  }

  function createArmyAtSelectedSettlement() {
    const s = settlementById(selectedSettlementId);
    if (!s) return;
    const defaultName = `Army ${armies.length + 1}`;
    const name = prompt('Name this army:', defaultName);
    if (name === null) return;
    const army = {
      id: generateId('army'),
      name: name.trim() || defaultName,
      x: s.x,
      y: s.y,
      stationedSettlementId: s.id,
      homeSettlementId: s.id,
      route: null,
      units: defaultArmyUnits(),
      strategy: 'neutral',
      counters: UNIT_COUNTERS
    };
    armies.push(army);
    selectedArmyId = army.id;
    pendingDestinationArmyId = army.id;
    selectedSettlementId = null;
    refreshSelectionPanels();
    readout.textContent = `Army “${army.name}” created. Click a destination on the map.`;
    draw();
  }

  function computeRouteStats(ax, ay, bx, by, army = null) {
    const dxKm = (bx - ax) * KM_PER_CELL_X;
    const dyKm = (by - ay) * KM_PER_CELL_Y;
    const distanceKm = Math.hypot(dxKm, dyKm);
    const steps = Math.max(8, Math.ceil(distanceKm / 6));
    let totalSlope = 0;
    let prevH = sampleHeightBilinear(ax, ay);
    let avgAltitude = 0;
    let seaSamples = 0;

    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = lerp(ax, bx, t);
      const y = lerp(ay, by, t);
      const h = sampleHeightBilinear(x, y);
      if (h < 0) seaSamples++;
      const hh = h < 0 ? 0 : h;
      avgAltitude += hh;
      const segKm = distanceKm / steps || 1;
      totalSlope += Math.abs(hh - Math.max(0, prevH)) / segKm;
      prevH = hh;
    }
    avgAltitude /= steps;
    const avgSlope = totalSlope / steps; // meters rise/fall per km
    const seaFraction = seaSamples / steps;
    const terrainPenalty = clamp(avgSlope / 140, 0, 0.35);
    const altitudePenalty = clamp((avgAltitude - 700) / 3000, 0, 0.18);
    const seaPenalty = clamp(seaFraction * 1.15, 0, 0.68);
    const baseArmySpeed = army ? averageArmySpeedKmPerDay(army) : BASE_INFANTRY_SPEED;
    const speedKmPerDay = clamp(baseArmySpeed * (1 - terrainPenalty - altitudePenalty - seaPenalty), 5, Math.max(6, baseArmySpeed));
    const marchDays = distanceKm / speedKmPerDay;
    const restDays = Math.floor(marchDays / 6);
    const seaExtraDays = seaFraction > 0.1 ? Math.ceil((distanceKm * seaFraction) / 35) : 0;
    const totalDays = marchDays + restDays + seaExtraDays;
    return { distanceKm, speedKmPerDay, restDays, seaExtraDays, totalDays, seaPenalty: seaFraction > 0.1, seaFraction };
  }

  function assignArmyDestination(army, destX, destY) {
    const stats = computeRouteStats(army.x, army.y, destX, destY, army);
    const destSettlement = findSettlementNear({ x: destX, y: destY }, 15);
    const startName = army.stationedSettlementId ? (settlementById(army.stationedSettlementId)?.name || 'field') : 'field';
    const destName = destSettlement ? destSettlement.name : 'destination';
    army.route = {
      startX: army.x,
      startY: army.y,
      destX,
      destY,
      startTime: performance.now(),
      endTime: performance.now() + stats.totalDays * GAME_DAY_MS,
      distanceKm: stats.distanceKm,
      speedKmPerDay: stats.speedKmPerDay,
      restDays: stats.restDays,
      totalDays: stats.totalDays,
      startName,
      destName
    };
    army.stationedSettlementId = null;
    pendingDestinationArmyId = null;
    selectedArmyId = army.id;
    const seaNote = stats.seaPenalty ? ` Sea travel included (+${stats.seaExtraDays} extra day${stats.seaExtraDays === 1 ? '' : 's'}).` : '';
    readout.textContent = `${army.name} marching to ${destName} — ${stats.distanceKm.toFixed(1)} km · ${stats.totalDays.toFixed(1)} days.${seaNote}`;
    refreshSelectionPanels();
    draw();
  }

  function updateArmies(now) {
    let changed = false;
    armies.forEach(a => {
      if (!a.route) return;
      const duration = a.route.endTime - a.route.startTime;
      const t = duration <= 0 ? 1 : clamp((now - a.route.startTime) / duration, 0, 1);
      a.x = lerp(a.route.startX, a.route.destX, t);
      a.y = lerp(a.route.startY, a.route.destY, t);
      if (t >= 1) {
        a.x = a.route.destX;
        a.y = a.route.destY;
        const destSettlement = findSettlementNear({ x: a.x, y: a.y }, 15);
        a.stationedSettlementId = destSettlement ? destSettlement.id : null;
        a.route = null;
        changed = true;
        if (a.id === selectedArmyId) {
          readout.textContent = `${a.name} has arrived${destSettlement ? ' at ' + destSettlement.name : ''}.`;
        }
      }
    });
    if (changed) refreshSelectionPanels();
    return changed;
  }

  function showContextMenu(clientX, clientY, worldPt) {
    const h = sampleHeightBilinear(worldPt.x, worldPt.y);
    if (h < 0) return;
    selectedContextPoint = { x: worldPt.x, y: worldPt.y };
    const km = gridToKm(worldPt.x, worldPt.y);
    menuTitle.textContent = `${biomeNameAt(worldPt.x, worldPt.y)} · ~${Math.round(h)}m · x ${Math.round(km.kmX)}km · y ${Math.round(km.kmY)}km`;
    contextMenu.style.display = 'block';
    let x = clientX, y = clientY;
    document.body.appendChild(contextMenu);
    const rect = contextMenu.getBoundingClientRect();
    if (x + rect.width > innerWidth - 8) x = innerWidth - rect.width - 8;
    if (y + rect.height > innerHeight - 8) y = innerHeight - rect.height - 8;
    contextMenu.style.left = x + 'px';
    contextMenu.style.top = y + 'px';
  }
  function hideContextMenu() { contextMenu.style.display = 'none'; }

  function makePopupDraggable(el, handle, ignoredSelector) {
    let active = false, sx = 0, sy = 0, startL = 0, startT = 0;
    handle.addEventListener('pointerdown', e => {
      if (ignoredSelector && e.target.closest(ignoredSelector)) return;
      active = true;
      sx = e.clientX; sy = e.clientY;
      const r = el.getBoundingClientRect();
      startL = r.left; startT = r.top;
      handle.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    handle.addEventListener('pointermove', e => {
      if (!active) return;
      const nx = clamp(startL + e.clientX - sx, 6, innerWidth - 120);
      const ny = clamp(startT + e.clientY - sy, 6, innerHeight - 50);
      el.style.left = nx + 'px';
      el.style.top = ny + 'px';
    });
    handle.addEventListener('pointerup', () => active = false);
    handle.addEventListener('pointercancel', () => active = false);
    handle.addEventListener('lostpointercapture', () => active = false);
  }

  function popupWindowStats(center, radiusX, radiusY) {
    let minH = Infinity, maxH = -Infinity, sumH = 0, count = 0;
    const steps = 48;
    for (let y = 0; y < steps; y++) {
      const gy = center.y + ((y + 0.5) / steps * 2 - 1) * radiusY;
      for (let x = 0; x < steps; x++) {
        const gx = center.x + ((x + 0.5) / steps * 2 - 1) * radiusX;
        const h = sampleHeightBilinear(gx, gy);
        if (h >= 0) {
          if (h < minH) minH = h;
          if (h > maxH) maxH = h;
          sumH += h;
          count++;
        }
      }
    }
    if (!count) return { minH: 0, maxH: 1, avgH: 0, span: 1 };
    const avgH = sumH / count;
    const span = Math.max(60, maxH - minH);
    return { minH, maxH, avgH, span };
  }

  function safeHeightAt(x, y, fallback = 0) {
    const h = sampleHeightBilinear(x, y);
    return h < 0 ? fallback : h;
  }

  function localSlopeAt(x, y, step) {
    const h = safeHeightAt(x, y, 0);
    const hx1 = safeHeightAt(x + step, y, h);
    const hx0 = safeHeightAt(x - step, y, h);
    const hy1 = safeHeightAt(x, y + step, h);
    const hy0 = safeHeightAt(x, y - step, h);
    const sx = (hx1 - hx0) / Math.max(1, 2 * step);
    const sy = (hy1 - hy0) / Math.max(1, 2 * step);
    return Math.hypot(sx, sy); // meters per grid cell, approximately
  }

  function demDirectHillshade(x, y, step) {
    const h = safeHeightAt(x, y, 0);
    const hx1 = safeHeightAt(x + step, y, h);
    const hx0 = safeHeightAt(x - step, y, h);
    const hy1 = safeHeightAt(x, y + step, h);
    const hy0 = safeHeightAt(x, y - step, h);

    const dzdx = (hx1 - hx0) / Math.max(1, 2 * step);
    const dzdy = (hy1 - hy0) / Math.max(1, 2 * step);

    let nx = -dzdx * 0.026;
    let ny = -dzdy * 0.026;
    let nz = 1;
    const inv = 1 / Math.hypot(nx, ny, nz);
    nx *= inv; ny *= inv; nz *= inv;

    const lights = [
      [-0.58, -0.36, 0.73, 0.58],
      [ 0.42, -0.58, 0.70, 0.24],
      [-0.18,  0.55, 0.82, 0.18]
    ];
    let shade = 0;
    let weight = 0;
    for (const l of lights) {
      const dot = clamp(nx * l[0] + ny * l[1] + nz * l[2], 0, 1);
      shade += dot * l[3];
      weight += l[3];
    }
    shade /= weight;
    return 0.62 + shade * 0.55;
  }

  function localReliefAt(x, y, step) {
    const h = safeHeightAt(x, y, 0);
    const samples = [
      safeHeightAt(x + step, y, h), safeHeightAt(x - step, y, h),
      safeHeightAt(x, y + step, h), safeHeightAt(x, y - step, h),
      safeHeightAt(x + step, y + step, h), safeHeightAt(x - step, y + step, h),
      safeHeightAt(x + step, y - step, h), safeHeightAt(x - step, y - step, h)
    ];
    let mn = h, mx = h;
    for (const v of samples) { if (v < mn) mn = v; if (v > mx) mx = v; }
    return { mn, mx, span: mx - mn, avg: samples.reduce((a,b) => a + b, h) / (samples.length + 1) };
  }

  function localPassageScore(x, y, step, h, slope) {
    // Derived natural passage/gully indicator, not historical roads.
    const off = Math.max(3, step * 4);
    const vals = [
      safeHeightAt(x + off, y, h), safeHeightAt(x - off, y, h),
      safeHeightAt(x, y + off, h), safeHeightAt(x, y - off, h),
      safeHeightAt(x + off, y + off, h), safeHeightAt(x - off, y + off, h),
      safeHeightAt(x + off, y - off, h), safeHeightAt(x - off, y - off, h)
    ];
    const ringAvg = vals.reduce((a,b) => a + b, 0) / vals.length;
    const valley = ringAvg - h;
    const valleyScore = clamp((valley - 18) / 85, 0, 1);
    const gentleScore = clamp((14 - slope) / 10, 0, 1);
    return valleyScore * gentleScore;
  }

  function demDirectTerrainColor(x, y, stats, radiusKm, step) {
    const landVal = sampleLandBilinear(x, y);
    const h = sampleHeightBilinear(x, y);
    if (landVal <= 0.04 || h < 0) return seaColor(x, y);

    let col = terrainColor(h);

    // Keep the same absolute elevation colors as the main map while still improving local relief.
    const slope = localSlopeAt(x, y, step);
    const relief = localReliefAt(x, y, Math.max(2, step * 2));
    const shade = demDirectHillshade(x, y, step);
    col = col.map(v => Math.round(clamp(v * shade, 0, 255)));

    // Steep broken terrain / small cliff emphasis.
    const cliff = clamp((slope - 7) / 15, 0, 1) * clamp((relief.span - 45) / 160, 0, 1);
    if (cliff > 0.02) {
      const m = cliff * 0.48;
      col = [
        Math.round(lerp(col[0], 46, m)),
        Math.round(lerp(col[1], 43, m)),
        Math.round(lerp(col[2], 39, m))
      ];
    }

    // Natural passages/valleys: faint ochre traces in low-slope valley floors.
    const passage = localPassageScore(x, y, step, h, slope);
    if (passage > 0.04 && radiusKm <= 80) {
      const m = passage * 0.32;
      col = [
        Math.round(lerp(col[0], 222, m)),
        Math.round(lerp(col[1], 210, m)),
        Math.round(lerp(col[2], 146, m))
      ];
    }

    // Zoom-dependent contour lines from actual DEM elevation.
    const contourStep = radiusKm <= 6 ? 10 : radiusKm <= 15 ? 20 : radiusKm <= 35 ? 40 : radiusKm <= 90 ? 80 : 120;
    const band = h / contourStep;
    const frac = Math.abs(band - Math.round(band));
    const line = clamp(1 - frac * 22, 0, 1);
    if (line > 0.12) {
      const m = line * (radiusKm <= 35 ? 0.30 : 0.20);
      col = [
        Math.round(lerp(col[0], 38, m)),
        Math.round(lerp(col[1], 36, m)),
        Math.round(lerp(col[2], 34, m))
      ];
    }

    // Smooth coast blend.
    const sea = seaColor(x, y);
    const blend = smoothstep(clamp((landVal - 0.10) / 0.80, 0, 1));
    col = [
      Math.round(lerp(sea[0], col[0], blend)),
      Math.round(lerp(sea[1], col[1], blend)),
      Math.round(lerp(sea[2], col[2], blend))
    ];

    return col;
  }

  function demDirectBiomeColor(x, y, radiusKm, step) {
    const landVal = sampleLandBilinear(x, y);
    const h = sampleHeightBilinear(x, y);
    if (landVal <= 0.04 || h < 0) return seaColor(x, y);

    let col = smoothBiomeColorAt(x, y);
    const shade = demDirectHillshade(x, y, step);
    const slope = localSlopeAt(x, y, step);
    const detail = fbm(x / 58 + 4.1, y / 58 - 1.7, 2);
    col = col.map(v => Math.round(clamp(v * (0.92 + detail * 0.08) * (0.88 + (shade - 0.62) * 0.45), 0, 255)));

    // Show cliffs and rugged edges even in biome mode.
    const cliff = clamp((slope - 8) / 18, 0, 1);
    if (cliff > 0.05) {
      const m = cliff * 0.28;
      col = [Math.round(lerp(col[0], 45, m)), Math.round(lerp(col[1], 45, m)), Math.round(lerp(col[2], 45, m))];
    }

    const sea = seaColor(x, y);
    const blend = smoothstep(clamp((landVal - 0.10) / 0.80, 0, 1));
    return [
      Math.round(lerp(sea[0], col[0], blend)),
      Math.round(lerp(sea[1], col[1], blend)),
      Math.round(lerp(sea[2], col[2], blend))
    ];
  }

  function drawArmyFormationSquares(cctx, transform, armySnapshot, radiusKm, W, H, localDpr) {
    const metersPerPixel = (radiusKm * 2 * 1000) / W;
    const gapMeters = 10;
    for (const a of armySnapshot) {
      const soldiers = totalArmySoldiers(a);
      if (soldiers <= 0) continue;

      const p = transform(a.x, a.y);
      if (p.x < -120 || p.y < -120 || p.x > W + 120 || p.y > H + 120) continue;

      const squareCount = Math.ceil(soldiers / 1000);
      const cols = Math.ceil(Math.sqrt(squareCount));
      const rows = Math.ceil(squareCount / cols);

      cctx.save();
      for (let i = 0; i < squareCount; i++) {
        const groupSize = i < squareCount - 1 ? 1000 : soldiers - (squareCount - 1) * 1000;
        const metersWide = Math.max(8, Math.min(50, groupSize * 0.05));
        const sizePx = Math.max(3, metersWide / metersPerPixel);
        const stepPx = (50 + gapMeters) / metersPerPixel;
        const col = i % cols;
        const row = Math.floor(i / cols);
        const ox = (col - (cols - 1) / 2) * stepPx;
        const oy = (row - (rows - 1) / 2) * stepPx;
        const x = p.x + ox - sizePx / 2;
        const y = p.y + oy - sizePx / 2;

        cctx.fillStyle = a.id === selectedArmyId ? 'rgba(64, 101, 220, 0.62)' : 'rgba(38, 76, 166, 0.55)';
        cctx.strokeStyle = 'rgba(255,255,255,0.78)';
        cctx.lineWidth = Math.max(1, 1.2 * localDpr);
        cctx.fillRect(x, y, sizePx, sizePx);
        cctx.strokeRect(x, y, sizePx, sizePx);
      }

      cctx.fillStyle = 'rgba(12,17,23,0.84)';
      const label = `${a.name} · ${soldiers.toLocaleString()} men · S ${armyScoreLabel(a)}`;
      cctx.font = `${12 * localDpr}px Arial`;
      const tw = cctx.measureText(label).width;
      const bx = p.x + 12 * localDpr;
      const by = p.y + 12 * localDpr;
      roundRect(cctx, bx, by, tw + 14 * localDpr, 20 * localDpr, 8 * localDpr);
      cctx.fill();
      cctx.fillStyle = '#eef4f8';
      cctx.fillText(label, bx + 7 * localDpr, by + 4 * localDpr);
      cctx.restore();
    }
  }

  function renderFrozenPopup(canvasEl, center, radiusKm, settlementSnapshot, armySnapshot, mapMode) {
    const quality = 1260; // rendered once directly from DEM/biome data
    const localDpr = Math.min(1.65, Math.max(1, window.devicePixelRatio || 1));
    const W = Math.round(quality * localDpr / 1.5);
    const H = W;
    canvasEl.width = W;
    canvasEl.height = H;
    const cctx = canvasEl.getContext('2d', { alpha: false });

    const radiusX = radiusKm / KM_PER_CELL_X;
    const radiusY = radiusKm / KM_PER_CELL_Y;
    const sx0 = center.x - radiusX;
    const sy0 = center.y - radiusY;
    const stats = popupWindowStats(center, radiusX, radiusY);
    const sampleStep = Math.max(0.65, Math.min(6, (Math.max(radiusX, radiusY) * 2) / W * 1.4));

    const img = cctx.createImageData(W, H);
    const data = img.data;

    for (let py = 0; py < H; py++) {
      const gy = sy0 + ((py + 0.5) / H) * (2 * radiusY);
      for (let px = 0; px < W; px++) {
        const gx = sx0 + ((px + 0.5) / W) * (2 * radiusX);
        const col = mapMode === 'biome'
          ? demDirectBiomeColor(gx, gy, radiusKm, sampleStep)
          : demDirectTerrainColor(gx, gy, stats, radiusKm, sampleStep);
        const di = (py * W + px) * 4;
        data[di] = col[0]; data[di + 1] = col[1]; data[di + 2] = col[2]; data[di + 3] = 255;
      }
    }
    cctx.putImageData(img, 0, 0);

    const transform = (gx, gy) => ({
      x: ((gx - sx0) / (2 * radiusX)) * W,
      y: ((gy - sy0) / (2 * radiusY)) * H
    });

    cctx.save();
    cctx.strokeStyle = 'rgba(255,255,255,0.86)';
    cctx.lineWidth = 1.3 * localDpr;
    cctx.beginPath();
    cctx.moveTo(W / 2 - 12 * localDpr, H / 2);
    cctx.lineTo(W / 2 + 12 * localDpr, H / 2);
    cctx.moveTo(W / 2, H / 2 - 12 * localDpr);
    cctx.lineTo(W / 2, H / 2 + 12 * localDpr);
    cctx.stroke();

    cctx.strokeStyle = 'rgba(255,255,255,0.30)';
    cctx.lineWidth = 1 * localDpr;
    cctx.beginPath();
    cctx.arc(W / 2, H / 2, W / 2 - 14 * localDpr, 0, Math.PI * 2);
    cctx.stroke();

    const nice = radiusKm <= 10 ? 2 : radiusKm <= 25 ? 5 : radiusKm <= 60 ? 10 : 25;
    const barPx = (nice / (radiusKm * 2)) * W;
    cctx.fillStyle = 'rgba(12,17,23,0.8)';
    cctx.fillRect(16 * localDpr, H - 36 * localDpr, barPx, 8 * localDpr);
    cctx.strokeStyle = 'rgba(255,255,255,0.92)';
    cctx.strokeRect(16 * localDpr, H - 36 * localDpr, barPx, 8 * localDpr);
    cctx.fillStyle = '#ffffff';
    cctx.font = `${12 * localDpr}px Arial`;
    cctx.fillText(`${nice} km`, 16 * localDpr, H - 42 * localDpr);
    cctx.restore();

    function drawPopupSettlements() {
      cctx.save();
      cctx.font = `${12 * localDpr}px Arial`;
      cctx.textBaseline = 'top';
      settlementSnapshot.forEach(s => {
        if (Math.abs(s.x - center.x) > radiusX || Math.abs(s.y - center.y) > radiusY) return;
        const p = transform(s.x, s.y);
        if (s.type === 'capital') drawStar(cctx, p.x, p.y, 8 * localDpr, 4 * localDpr, '#ffd84f', '#3a2e05', 1.5 * localDpr);
        else {
          cctx.beginPath();
          cctx.arc(p.x, p.y, 4.8 * localDpr, 0, Math.PI * 2);
          cctx.fillStyle = '#f25757';
          cctx.fill();
          cctx.strokeStyle = '#ffffff';
          cctx.lineWidth = 1.8 * localDpr;
          cctx.stroke();
        }
        const label = `${s.name} · ${Math.round(s.elevation)}m`;
        const tw = cctx.measureText(label).width;
        const bx = p.x + 10 * localDpr;
        const by = p.y - 10 * localDpr;
        cctx.fillStyle = 'rgba(14,19,25,0.84)';
        roundRect(cctx, bx, by, tw + 14 * localDpr, 20 * localDpr, 8 * localDpr);
        cctx.fill();
        cctx.fillStyle = '#eef4f8';
        cctx.fillText(label, bx + 7 * localDpr, by + 4 * localDpr);
      });
      cctx.restore();
    }

    function drawPopupArmies() {
      cctx.save();
      cctx.font = `${12 * localDpr}px Arial`;
      cctx.textBaseline = 'top';
      armySnapshot.forEach(a => {
        if (Math.abs(a.x - center.x) > radiusX || Math.abs(a.y - center.y) > radiusY) return;
        const p = transform(a.x, a.y);
        const w = 12 * localDpr, h = 13 * localDpr;
        cctx.beginPath();
        cctx.moveTo(p.x - w * 0.55, p.y + h * 0.55);
        cctx.lineTo(p.x - w * 0.55, p.y - h * 0.55);
        cctx.lineTo(p.x + w * 0.35, p.y - h * 0.28);
        cctx.lineTo(p.x - w * 0.55, p.y + 0.02 * h);
        cctx.closePath();
        cctx.fillStyle = '#2d4ca7';
        cctx.fill();
        cctx.strokeStyle = '#ffffff';
        cctx.lineWidth = 1.5 * localDpr;
        cctx.stroke();
        cctx.beginPath();
        cctx.moveTo(p.x - w * 0.55, p.y - h * 0.60);
        cctx.lineTo(p.x - w * 0.55, p.y + h * 0.70);
        cctx.strokeStyle = '#232323';
        cctx.lineWidth = 1.8 * localDpr;
        cctx.stroke();
        const label = `${a.name} · S ${armyScoreLabel(a)}`;
        const tw = cctx.measureText(label).width;
        const bx = p.x + 12 * localDpr;
        const by = p.y + 4 * localDpr;
        cctx.fillStyle = 'rgba(14,19,25,0.84)';
        roundRect(cctx, bx, by, tw + 14 * localDpr, 20 * localDpr, 8 * localDpr);
        cctx.fill();
        cctx.fillStyle = '#eef4f8';
        cctx.fillText(label, bx + 7 * localDpr, by + 4 * localDpr);
      });
      cctx.restore();
    }

    drawPopupSettlements();
    drawArmyFormationSquares(cctx, transform, armySnapshot, radiusKm, W, H, localDpr);
    drawPopupArmies();
  }

  function createZoomPopup(center, radiusKm) {
    const h = sampleHeightBilinear(center.x, center.y);
    const settlementSnapshot = settlements.map(s => ({ ...s }));
    const armySnapshot = armies.map(a => ({ ...a }));

    const popup = document.createElement('div');
    popup.className = 'popup';
    popup.style.left = Math.min(70 + popupCascade, Math.max(10, innerWidth - 560)) + 'px';
    popup.style.top = Math.min(60 + popupCascade, Math.max(10, innerHeight - 620)) + 'px';
    popupCascade = (popupCascade + 28) % 200;

    popup.innerHTML = `
      <div class="popupHeader">
        <div class="popupTitle">DEM-direct zoom · ${currentMapMode === 'biome' ? 'satellite / biome' : 'heightmap'} · ${radiusKm} km radius · center ~${Math.round(h)}m</div>
        <button class="closeBtn" type="button" title="Close">×</button>
      </div>
      <div class="popupBody">
        <canvas class="localCanvas"></canvas>
        <div class="popupFooter">Frozen NASADEM snapshot of the selected area.</div>
      </div>
    `;
    document.body.appendChild(popup);

    const header = popup.querySelector('.popupHeader');
    const close = popup.querySelector('.closeBtn');
    const localCanvas = popup.querySelector('.localCanvas');
    const footer = popup.querySelector('.popupFooter');

    close.addEventListener('pointerdown', e => { e.stopPropagation(); });
    close.addEventListener('click', e => { e.stopPropagation(); popup.remove(); });
    makePopupDraggable(popup, header, '.closeBtn');
    renderFrozenPopup(localCanvas, center, radiusKm, settlementSnapshot, armySnapshot, currentMapMode);

    localCanvas.addEventListener('pointermove', e => {
      const rect = localCanvas.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width;
      const py = (e.clientY - rect.top) / rect.height;
      const radiusX = radiusKm / KM_PER_CELL_X;
      const radiusY = radiusKm / KM_PER_CELL_Y;
      const gx = center.x + (px * 2 - 1) * radiusX;
      const gy = center.y + (py * 2 - 1) * radiusY;
      const hh = sampleHeightBilinear(gx, gy);
      footer.textContent = hh >= 0 ? `Local hover elevation: ~${Math.round(hh)}m · radius ${radiusKm} km` : `Sea / off-land · radius ${radiusKm} km`;
    });
  }

  function handleClick(worldPt) {
    hideContextMenu();
    if (pendingDestinationArmyId) {
      const a = armyById(pendingDestinationArmyId);
      if (a) assignArmyDestination(a, worldPt.x, worldPt.y);
      return;
    }
    const enc = findEncounterNear(worldPt);
    if (enc) { showEncounterPanel(enc); return; }
    const army = findArmyNear(worldPt);
    if (army) { selectArmy(army.id); return; }
    const settlement = findSettlementNear(worldPt);
    if (settlement) { selectSettlement(settlement.id); return; }
    selectedSettlementId = null;
    selectedArmyId = null;
    refreshSelectionPanels();
    draw();
  }

  function animationLoop(now) {
    const changed = updateArmies(now);
    const encounterChanged = ready ? scanEncounters(now) : false;
    const battleChanged = ready ? updateActiveBattle(now) : false;
    if (ready) {
      if (changed || encounterChanged || battleChanged || armies.some(a => a.route)) {
        refreshArmyList();
        if (selectedArmyId) refreshSelectionPanels();
        draw();
      }
    }
    requestAnimationFrame(animationLoop);
  }
