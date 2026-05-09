// 07_naval_harbor_wind.js
// Harbor settlements, ship groups, sea-only movement, wind mode, and troop transport.
// Loaded after map/routes and before init event binding.

const SHIP_TYPES = {
  fishingBoats: {
    label: 'Fishing Boats',
    cost: 24,
    materialCost: 12,
    buildPasses: 1,
    capacity: 8,
    battleScore: 5,
    income: 2,
    foodIncome: 18,
    speed: 18,
    windSensitivity: 1.35,
    crew: 6
  },
  lightRaider: {
    label: 'Light Raider Ship',
    cost: 55,
    materialCost: 24,
    buildPasses: 1,
    capacity: 22,
    battleScore: 22,
    income: 1,
    foodIncome: 0,
    speed: 28,
    windSensitivity: 0.95,
    crew: 14
  },
  vikingLongboat: {
    label: 'Viking Longboat',
    cost: 80,
    materialCost: 32,
    buildPasses: 1,
    capacity: 42,
    battleScore: 36,
    income: 1,
    foodIncome: 0,
    speed: 32,
    windSensitivity: 0.70,
    crew: 20
  },
  longSailboat: {
    label: 'Long Sailboat',
    cost: 95,
    materialCost: 36,
    buildPasses: 2,
    capacity: 55,
    battleScore: 25,
    income: 6,
    foodIncome: 0,
    speed: 30,
    windSensitivity: 1.40,
    crew: 18
  },
  bireme: {
    label: 'Bireme',
    cost: 140,
    materialCost: 62,
    buildPasses: 2,
    capacity: 85,
    battleScore: 70,
    income: 2,
    foodIncome: 0,
    speed: 27,
    windSensitivity: 0.55,
    crew: 48
  },
  merchantShip: {
    label: 'Merchant Ship',
    cost: 180,
    materialCost: 70,
    buildPasses: 2,
    capacity: 120,
    battleScore: 30,
    income: 22,
    foodIncome: 4,
    speed: 23,
    windSensitivity: 1.20,
    crew: 28
  },
  trireme: {
    label: 'Trireme',
    cost: 260,
    materialCost: 110,
    buildPasses: 3,
    capacity: 150,
    battleScore: 135,
    income: 2,
    foodIncome: 0,
    speed: 31,
    windSensitivity: 0.45,
    crew: 90
  },
  quadrireme: {
    label: 'Quadrireme',
    cost: 390,
    materialCost: 165,
    buildPasses: 4,
    capacity: 210,
    battleScore: 210,
    income: 2,
    foodIncome: 0,
    speed: 26,
    windSensitivity: 0.42,
    crew: 130
  },
  quinquereme: {
    label: 'Quinquereme',
    cost: 560,
    materialCost: 240,
    buildPasses: 5,
    capacity: 310,
    battleScore: 330,
    income: 2,
    foodIncome: 0,
    speed: 22,
    windSensitivity: 0.38,
    crew: 190
  },
  custom: {
    label: 'Custom Ship Group',
    cost: 100,
    materialCost: 50,
    buildPasses: 2,
    capacity: 50,
    battleScore: 40,
    income: 0,
    foodIncome: 0,
    speed: 24,
    windSensitivity: 1.0,
    crew: 25
  }
};

const ORIGINAL_NAVAL = {
  draw,
  addSettlement,
  refreshSelectedEmpirePanel,
  refreshSelectionPanels,
  passTime,
  assignArmyDestination,
  updateArmies,
  drawArmies,
  armyScore,
  armyScoreLabel,
  armyPowerVs,
  battleComposition,
  totalArmySoldiers
};

function isShipGroup(army) {
  return !!(army && army.isShipGroup);
}
function shipTypeData(armyOrType) {
  if (typeof armyOrType === 'string') return SHIP_TYPES[armyOrType] || SHIP_TYPES.custom;
  if (!armyOrType) return SHIP_TYPES.custom;
  return armyOrType.shipData || SHIP_TYPES[armyOrType.shipType] || SHIP_TYPES.custom;
}
function shipCount(army) {
  return Math.max(0, Number(army?.shipCount) || 0);
}
function shipCapacity(army) {
  return shipCount(army) * (Number(shipTypeData(army).capacity) || 0);
}
function shipCrewCount(army) {
  return shipCount(army) * (Number(shipTypeData(army).crew) || 0);
}
function cargoUnits(army) {
  if (!army.cargoUnits) army.cargoUnits = defaultArmyUnits();
  normalizeArmyUnits({ units: army.cargoUnits });
  return army.cargoUnits;
}
function cargoSoldierCount(army) {
  const u = cargoUnits(army);
  return UNIT_TYPES.reduce((sum, t) => sum + Math.max(0, Number(u[t.key]) || 0), 0);
}
function shipFreeCapacity(army) {
  return Math.max(0, shipCapacity(army) - cargoSoldierCount(army));
}
function shipBattlePower(army) {
  const data = shipTypeData(army);
  return shipCount(army) * (Number(data.battleScore) || 0) + cargoSoldierCount(army) * 0.08;
}
function shipLabel(army) {
  const data = shipTypeData(army);
  return `${army.name} · ${shipCount(army)} ${data.label} · cargo ${cargoSoldierCount(army)}/${shipCapacity(army)}`;
}

function isSeaPoint(x, y) {
  if (x < 0 || y < 0 || x >= GRID_W || y >= GRID_H) return false;
  return sampleLandBilinear(x, y) < 0.18 || sampleHeightBilinear(x, y) < 0;
}
function isLandPoint(x, y) {
  return !isSeaPoint(x, y) && sampleHeightBilinear(x, y) >= 0;
}
function cellRadiusForKm(km) {
  return Math.max(1, Math.ceil(km / Math.min(KM_PER_CELL_X, KM_PER_CELL_Y)));
}
function pointKmDistance(ax, ay, bx, by) {
  return Math.hypot((ax - bx) * KM_PER_CELL_X, (ay - by) * KM_PER_CELL_Y);
}
function nearestPointMatching(x, y, maxKm, predicate) {
  const maxR = cellRadiusForKm(maxKm);
  let best = null, bestD = Infinity;
  for (let r = 0; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const px = clamp(Math.round(x + dx), 0, GRID_W - 1);
        const py = clamp(Math.round(y + dy), 0, GRID_H - 1);
        if (!predicate(px, py)) continue;
        const d = pointKmDistance(x, y, px, py);
        if (d < bestD) {
          bestD = d;
          best = { x: px, y: py, distanceKm: d };
        }
      }
    }
    if (best && bestD <= maxKm) return best;
  }
  return best;
}
function nearestSeaPoint(x, y, maxKm = 10) {
  return nearestPointMatching(x, y, maxKm, isSeaPoint);
}
function nearestLandPoint(x, y, maxKm = 18) {
  return nearestPointMatching(x, y, maxKm, isLandPoint);
}
function distanceToSeaKm(x, y) {
  const p = nearestSeaPoint(x, y, 12);
  return p ? p.distanceKm : Infinity;
}
function isNearSeaForHarbor(x, y) {
  return distanceToSeaKm(x, y) <= 3;
}

function windAt(x, y) {
  const sx = windSeed * 131.7;
  const sy = windSeed * -97.3;
  const a = fbm(x / 260 + 3.1 + sx, y / 260 - 6.4 + sy, 3) * Math.PI * 2
    + Math.sin(x / 210 + windSeed * 0.7) * 0.8
    + Math.cos(y / 190 - windSeed * 0.9) * 0.6;
  const strength = 0.45 + fbm(x / 180 - 1.7 - sx * 0.4, y / 180 + 9.3 + sy * 0.4, 3) * 0.65;
  return { angle: a, strength, vx: Math.cos(a) * strength, vy: Math.sin(a) * strength };
}
function refreshWindMap() {
  windSeed = Math.floor(Math.random() * 1000000);
  if (typeof setMapMode === 'function') setMapMode('wind');
  else { currentMapMode = 'wind'; draw(); }
  readout.textContent = 'New wind map generated.';
}
function drawWindOverlay(targetCtx, transformer, scale = 1) {
  const inv = (sx, sy) => ({
    x: world.cx + (sx - canvas.width / 2) / world.zoom,
    y: world.cy + (sy - canvas.height / 2) / world.zoom
  });
  const topLeft = inv(0, 0);
  const bottomRight = inv(targetCtx.canvas.width, targetCtx.canvas.height);
  const minX = clamp(Math.floor(Math.min(topLeft.x, bottomRight.x)), 0, GRID_W - 1);
  const maxX = clamp(Math.ceil(Math.max(topLeft.x, bottomRight.x)), 0, GRID_W - 1);
  const minY = clamp(Math.floor(Math.min(topLeft.y, bottomRight.y)), 0, GRID_H - 1);
  const maxY = clamp(Math.ceil(Math.max(topLeft.y, bottomRight.y)), 0, GRID_H - 1);

  targetCtx.save();
  targetCtx.fillStyle = 'rgba(55,108,165,0.12)';
  const tintStep = Math.max(10, Math.round(18 / Math.max(0.8, world.zoom / 2)));
  for (let y = minY; y <= maxY; y += tintStep) {
    for (let x = minX; x <= maxX; x += tintStep) {
      if (!isSeaPoint(x, y)) continue;
      const p = transformer(x, y);
      const sz = Math.max(7, tintStep * world.zoom * 1.15);
      targetCtx.fillRect(p.x - sz / 2, p.y - sz / 2, sz, sz);
    }
  }

  targetCtx.lineCap = 'round';
  targetCtx.lineJoin = 'round';
  const step = Math.max(22, Math.round(70 / Math.max(0.65, world.zoom / 2.2)));
  let drawn = 0;
  for (let y = minY; y <= maxY; y += step) {
    for (let x = minX; x <= maxX; x += step) {
      if (!isSeaPoint(x, y)) continue;
      const p = transformer(x, y);
      if (p.x < -70 || p.y < -70 || p.x > targetCtx.canvas.width + 70 || p.y > targetCtx.canvas.height + 70) continue;
      const w = windAt(x, y);
      const len = (26 + w.strength * 22) * dpr * scale;
      const dx = Math.cos(w.angle) * len;
      const dy = Math.sin(w.angle) * len;

      targetCtx.strokeStyle = 'rgba(255,255,255,0.78)';
      targetCtx.lineWidth = Math.max(2.8, 5.2 * dpr * scale);
      targetCtx.beginPath();
      targetCtx.moveTo(p.x - dx * 0.50, p.y - dy * 0.50);
      targetCtx.quadraticCurveTo(p.x - dy * 0.18, p.y + dx * 0.18, p.x + dx * 0.50, p.y + dy * 0.50);
      targetCtx.stroke();

      targetCtx.strokeStyle = 'rgba(16,67,135,0.94)';
      targetCtx.lineWidth = Math.max(1.5, 2.6 * dpr * scale);
      targetCtx.beginPath();
      targetCtx.moveTo(p.x - dx * 0.50, p.y - dy * 0.50);
      targetCtx.quadraticCurveTo(p.x - dy * 0.18, p.y + dx * 0.18, p.x + dx * 0.50, p.y + dy * 0.50);
      targetCtx.stroke();

      const ang = Math.atan2(dy, dx);
      const tipX = p.x + dx * 0.50, tipY = p.y + dy * 0.50;
      targetCtx.fillStyle = 'rgba(255,255,255,0.86)';
      targetCtx.beginPath();
      targetCtx.moveTo(tipX, tipY);
      targetCtx.lineTo(tipX - Math.cos(ang - 0.55) * 10 * dpr * scale, tipY - Math.sin(ang - 0.55) * 10 * dpr * scale);
      targetCtx.lineTo(tipX - Math.cos(ang + 0.55) * 10 * dpr * scale, tipY - Math.sin(ang + 0.55) * 10 * dpr * scale);
      targetCtx.closePath();
      targetCtx.fill();

      targetCtx.fillStyle = 'rgba(16,67,135,0.98)';
      targetCtx.beginPath();
      targetCtx.moveTo(tipX, tipY);
      targetCtx.lineTo(tipX - Math.cos(ang - 0.55) * 7 * dpr * scale, tipY - Math.sin(ang - 0.55) * 7 * dpr * scale);
      targetCtx.lineTo(tipX - Math.cos(ang + 0.55) * 7 * dpr * scale, tipY - Math.sin(ang + 0.55) * 7 * dpr * scale);
      targetCtx.closePath();
      targetCtx.fill();
      drawn++;
    }
  }
  if (!drawn) {
    targetCtx.fillStyle = 'rgba(14,19,25,0.75)';
    roundRect(targetCtx, 16 * dpr, targetCtx.canvas.height - 44 * dpr, 290 * dpr, 28 * dpr, 10 * dpr);
    targetCtx.fill();
    targetCtx.fillStyle = '#eef4f8';
    targetCtx.font = `${13 * dpr}px Arial`;
    targetCtx.fillText('No sea currently visible for wind arrows.', 28 * dpr, targetCtx.canvas.height - 35 * dpr);
  }
  targetCtx.restore();
}

function windMultiplierForRoute(army, ax, ay, bx, by) {
  if (!isShipGroup(army)) return 1;
  const data = shipTypeData(army);
  const dx = bx - ax, dy = by - ay;
  const dist = Math.hypot(dx, dy) || 1;
  const mx = ax + dx / 2, my = ay + dy / 2;
  const w = windAt(mx, my);
  const dot = (dx / dist) * Math.cos(w.angle) + (dy / dist) * Math.sin(w.angle);
  const sens = Number(data.windSensitivity) || 1;
  if (dot >= 0) return clamp(1 + dot * 0.50 * sens, 0.35, 1.85);
  return clamp(1 + dot * 0.62 * sens, 0.18, 1.85);
}

function trimDestinationForSurface(army, destX, destY) {
  const sea = isShipGroup(army);
  let sx = army.x, sy = army.y;

  if (sea && !isSeaPoint(sx, sy)) {
    const startSea = nearestSeaPoint(sx, sy, 8);
    if (startSea) { army.x = startSea.x; army.y = startSea.y; sx = army.x; sy = army.y; }
  }
  if (!sea && !isLandPoint(sx, sy)) {
    const startLand = nearestLandPoint(sx, sy, 8);
    if (startLand) { army.x = startLand.x; army.y = startLand.y; sx = army.x; sy = army.y; }
  }

  let tx = destX, ty = destY;
  if (sea && !isSeaPoint(tx, ty)) {
    const p = nearestSeaPoint(tx, ty, 12);
    if (p) { tx = p.x; ty = p.y; }
  }

  const steps = 140;
  let lastX = sx, lastY = sy;
  let trimmed = false;
  for (let i = 1; i <= steps; i++) {
    const f = i / steps;
    const x = lerp(sx, tx, f), y = lerp(sy, ty, f);
    const ok = sea ? isSeaPoint(x, y) : isLandPoint(x, y);
    if (!ok) { trimmed = true; break; }
    lastX = x; lastY = y;
  }

  return { x: lastX, y: lastY, trimmed, sea };
}

const originalComputeRouteStats = computeRouteStats;
computeRouteStats = function computeRouteStatsNaval(ax, ay, bx, by, army = null) {
  if (!isShipGroup(army)) return originalComputeRouteStats(ax, ay, bx, by, army);

  const dxKm = (bx - ax) * KM_PER_CELL_X;
  const dyKm = (by - ay) * KM_PER_CELL_Y;
  const distanceKm = Math.hypot(dxKm, dyKm);
  const data = shipTypeData(army);
  const baseSpeed = Math.max(3, Number(data.speed) || 20);
  const windMult = windMultiplierForRoute(army, ax, ay, bx, by);
  const speedKmPerDay = clamp(baseSpeed * windMult, 3, baseSpeed * 1.85);
  const totalDays = distanceKm / Math.max(1, speedKmPerDay);
  return { distanceKm, speedKmPerDay, restDays: 0, seaExtraDays: 0, totalDays, seaPenalty: false, seaFraction: 1, windMult };
};

assignArmyDestination = function assignArmyDestinationNaval(army, destX, destY) {
  const adjusted = trimDestinationForSurface(army, destX, destY);
  const stats = computeRouteStats(army.x, army.y, adjusted.x, adjusted.y, army);
  const destSettlement = findSettlementNear({ x: adjusted.x, y: adjusted.y }, 15);
  const startName = army.stationedSettlementId ? (settlementById(army.stationedSettlementId)?.name || 'field') : (isShipGroup(army) ? 'sea' : 'field');
  const destName = destSettlement ? destSettlement.name : (isShipGroup(army) ? 'sea destination' : 'destination');

  if (stats.distanceKm < 0.05) {
    readout.textContent = isShipGroup(army)
      ? `${army.name} cannot move there because ships must stay on water.`
      : `${army.name} stopped at the shore because ground troops cannot cross water alone.`;
    pendingDestinationArmyId = null;
    refreshSelectionPanels();
    draw();
    return;
  }

  delete army.lockedEncounterId;
  delete army.battleId;
  delete army.pausedRoute;
  delete army.encounterCooldownUntil;

  army.route = {
    startX: army.x,
    startY: army.y,
    destX: adjusted.x,
    destY: adjusted.y,
    startTime: performance.now(),
    endTime: performance.now() + Math.max(0.05, stats.totalDays) * GAME_DAY_MS,
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
  const trimNote = adjusted.trimmed
    ? (isShipGroup(army) ? ' Route was trimmed to stay on water.' : ' Route was trimmed at the shore.')
    : '';
  const windNote = isShipGroup(army) ? ` Wind ×${(stats.windMult || 1).toFixed(2)}.` : '';
  readout.textContent = `${army.name} moving to ${destName} — ${stats.distanceKm.toFixed(1)} km · ${stats.totalDays.toFixed(1)} days.${trimNote}${windNote}`;
  refreshSelectionPanels();
  draw();
};

updateArmies = function updateArmiesNaval(now) {
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
      let destSettlement = null;
      if (isShipGroup(a)) {
        const near = findSettlementNear({ x: a.x, y: a.y }, 15);
        destSettlement = near && near.type === 'harbor' ? near : null;
      } else {
        destSettlement = findSettlementNear({ x: a.x, y: a.y }, 15);
      }
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
};

addSettlement = function addSettlementNaval(type) {
  if (type !== 'harbor') return ORIGINAL_NAVAL.addSettlement(type);
  if (!selectedContextPoint) return;
  const h = sampleHeightBilinear(selectedContextPoint.x, selectedContextPoint.y);
  if (h < 0) {
    alert('Harbors must be placed on land, close to sea.');
    return;
  }
  const seaD = distanceToSeaKm(selectedContextPoint.x, selectedContextPoint.y);
  if (seaD > 3) {
    alert(`Harbors must be built within 3 km of the sea. This point is about ${seaD.toFixed(1)} km away.`);
    return;
  }
  const defaultName = `Harbor ${settlements.filter(s => s.type === 'harbor').length + 1}`;
  const name = prompt('Name this harbor:', defaultName);
  if (name === null) return;
  const s = {
    id: generateId('settlement'),
    type: 'harbor',
    name: name.trim() || defaultName,
    x: selectedContextPoint.x,
    y: selectedContextPoint.y,
    elevation: h,
    biome: biomeNameAt(selectedContextPoint.x, selectedContextPoint.y),
    economy: defaultSettlementEconomy('harbor'),
    harbor: { customShipDesigns: [] }
  };
  settlements.push(s);
  selectedSettlementId = s.id;
  selectedArmyId = null;
  hideContextMenu();
  refreshSelectionPanels();
  refreshEmpirePanels();
  draw();
};

function shipTypeOptions() {
  return Object.entries(SHIP_TYPES).map(([key, s]) => `<option value="${key}">${s.label}</option>`).join('');
}
function empireForSettlement(s) {
  return s && s.empireId ? empireById(s.empireId) : null;
}
function buildShipGroupAtHarbor(s) {
  const e = empireForSettlement(s);
  if (!e) { alert('Link this harbor to an empire first.'); return; }
  ensureEmpireShape(e);
  ensureSettlementEconomy(s);

  const type = selectedEmpirePanel.querySelector('#shipTypeSelect')?.value || 'fishingBoats';
  const qty = Math.max(1, Math.floor(Number(selectedEmpirePanel.querySelector('#shipQtyInput')?.value) || 1));
  const base = { ...shipTypeData(type) };

  if (type === 'custom') {
    base.label = (selectedEmpirePanel.querySelector('#customShipNameInput')?.value || 'Custom Ship').trim() || 'Custom Ship';
    base.battleScore = Math.max(0, Number(selectedEmpirePanel.querySelector('#customShipScoreInput')?.value) || 0);
    base.income = Math.max(0, Number(selectedEmpirePanel.querySelector('#customShipIncomeInput')?.value) || 0);
    base.foodIncome = Math.max(0, Number(selectedEmpirePanel.querySelector('#customShipFoodInput')?.value) || 0);
    base.speed = Math.max(1, Number(selectedEmpirePanel.querySelector('#customShipSpeedInput')?.value) || 20);
    base.capacity = Math.max(0, Number(selectedEmpirePanel.querySelector('#customShipCapacityInput')?.value) || 0);
    base.crew = Math.max(1, Number(selectedEmpirePanel.querySelector('#customShipCrewInput')?.value) || 20);
    base.cost = Math.max(0, Number(selectedEmpirePanel.querySelector('#customShipCostInput')?.value) || 100);
    base.materialCost = Math.max(0, Number(selectedEmpirePanel.querySelector('#customShipMaterialInput')?.value) || 50);
    base.windSensitivity = Math.max(0.1, Number(selectedEmpirePanel.querySelector('#customShipWindInput')?.value) || 1);
  }

  const totalCost = (Number(base.cost) || 0) * qty;
  const totalMat = (Number(base.materialCost) || 0) * qty;
  if (e.wealth.amount < totalCost) { alert('Not enough empire wealth to build this ship group.'); return; }
  if (s.economy.supplies.materials < totalMat) { alert('Not enough harbor materials to build this ship group.'); return; }

  const sea = nearestSeaPoint(s.x, s.y, 8);
  if (!sea) { alert('Could not find water next to this harbor.'); return; }

  const name = prompt('Name this ship group:', `${s.name} ${base.label} Group`);
  if (name === null) return;

  e.wealth.amount -= totalCost;
  s.economy.supplies.materials -= totalMat;

  const army = {
    id: generateId('ship'),
    name: name.trim() || `${s.name} ${base.label} Group`,
    x: sea.x,
    y: sea.y,
    stationedSettlementId: s.id,
    homeSettlementId: s.id,
    route: null,
    units: defaultArmyUnits(),
    strategy: 'neutral',
    counters: UNIT_COUNTERS,
    isShipGroup: true,
    shipType: type,
    shipData: base,
    shipCount: qty,
    cargoUnits: defaultArmyUnits(),
    cargoNames: []
  };
  armies.push(army);
  selectedArmyId = army.id;
  refreshSelectionPanels();
  refreshEmpirePanels();
  draw();
}

function nearbyLoadableArmies(ship) {
  const shipEmpire = armyEmpireId(ship);
  return armies.filter(a => {
    if (!a || a.id === ship.id || isShipGroup(a) || a.route || a.battleId) return false;
    if (armyEmpireId(a) !== shipEmpire && relationBetween(armyEmpireId(a), shipEmpire) !== 'allies') return false;
    if (pointKmDistance(a.x, a.y, ship.x, ship.y) > 5) return false;
    return totalArmySoldiers(a) <= shipFreeCapacity(ship);
  });
}
function loadArmyIntoShip(shipId, armyId) {
  const ship = armyById(shipId);
  const landArmy = armyById(armyId);
  if (!isShipGroup(ship) || !landArmy || isShipGroup(landArmy)) return;
  const count = totalArmySoldiers(landArmy);
  if (pointKmDistance(ship.x, ship.y, landArmy.x, landArmy.y) > 5) { alert('Army must be within 5 km of the ship group.'); return; }
  if (count > shipFreeCapacity(ship)) { alert('Not enough ship capacity for that army.'); return; }

  const cargo = cargoUnits(ship);
  const u = normalizeArmyUnits(landArmy);
  UNIT_TYPES.forEach(t => {
    cargo[t.key] = (Number(cargo[t.key]) || 0) + (Number(u[t.key]) || 0);
  });
  if (!Array.isArray(ship.cargoNames)) ship.cargoNames = [];
  ship.cargoNames.push(landArmy.name);
  armies = armies.filter(a => a.id !== landArmy.id);
  if (selectedArmyId === landArmy.id) selectedArmyId = ship.id;
  readout.textContent = `${landArmy.name} loaded into ${ship.name}.`;
  refreshSelectionPanels();
  refreshEmpirePanels();
  draw();
}
function releaseTroopsFromShip(shipId) {
  const ship = armyById(shipId);
  if (!isShipGroup(ship)) return;
  const count = cargoSoldierCount(ship);
  if (!count) { alert('This ship group has no loaded troops.'); return; }
  const land = nearestLandPoint(ship.x, ship.y, 20);
  if (!land) { alert('No nearby shore found to release troops.'); return; }

  const name = prompt('Name the released army:', ship.cargoNames?.length ? ship.cargoNames.join(' + ') : `${ship.name} Landing Force`);
  if (name === null) return;

  const newArmy = {
    id: generateId('army'),
    name: name.trim() || `${ship.name} Landing Force`,
    x: land.x,
    y: land.y,
    stationedSettlementId: null,
    homeSettlementId: ship.homeSettlementId || null,
    route: null,
    units: { ...cargoUnits(ship) },
    strategy: 'neutral',
    counters: UNIT_COUNTERS
  };
  armies.push(newArmy);
  ship.cargoUnits = defaultArmyUnits();
  ship.cargoNames = [];
  selectedArmyId = newArmy.id;
  readout.textContent = `${newArmy.name} released onto the nearest shore.`;
  refreshSelectionPanels();
  refreshEmpirePanels();
  draw();
}

function renderHarborPanel(s) {
  if (!s || s.type !== 'harbor') return '';
  ensureSettlementEconomy(s);
  const e = empireForSettlement(s);
  const harborShips = armies.filter(a => isShipGroup(a) && a.homeSettlementId === s.id);
  const shipRows = harborShips.map(a => `<li><button class="empireSettlementPick harborShipPick" data-ship-id="${a.id}">${a.id === selectedArmyId ? '▶ ' : ''}${shipLabel(a)}</button></li>`).join('') || '<li>No ship groups built here.</li>';
  const ship = isShipGroup(armyById(selectedArmyId)) ? armyById(selectedArmyId) : null;
  const canUseShip = ship && ship.homeSettlementId === s.id;
  const nearby = canUseShip ? nearbyLoadableArmies(ship) : [];
  const nearbyOptions = nearby.map(a => `<option value="${a.id}">${a.name} — ${totalArmySoldiers(a).toLocaleString()} soldiers</option>`).join('');

  return `
    <div class="empireSectionTitle">Harbor / Ships</div>
    <div class="subtleLine">Harbors build ship groups. Ships move only on water and can carry ground troops within 5 km.</div>
    <div class="empireMiniGrid">
      <label>Ship group type</label><select id="shipTypeSelect">${shipTypeOptions()}</select>
      <label>Number of ships</label><input id="shipQtyInput" type="number" min="1" step="1" value="1">
    </div>
    <div id="customShipFields" class="armyEditor">
      <div class="subtleLine">Custom ship values are used only if type = Custom.</div>
      <div class="empireMiniGrid">
        <label>Name</label><input id="customShipNameInput" type="text" value="Custom Ship">
        <label>Battle score / ship</label><input id="customShipScoreInput" type="number" step="1" value="40">
        <label>Income / ship</label><input id="customShipIncomeInput" type="number" step="1" value="0">
        <label>Food income / ship</label><input id="customShipFoodInput" type="number" step="1" value="0">
        <label>Speed km/day</label><input id="customShipSpeedInput" type="number" step="1" value="24">
        <label>Capacity / ship</label><input id="customShipCapacityInput" type="number" step="1" value="50">
        <label>Crew / ship</label><input id="customShipCrewInput" type="number" step="1" value="25">
        <label>Wealth cost / ship</label><input id="customShipCostInput" type="number" step="1" value="100">
        <label>Material cost / ship</label><input id="customShipMaterialInput" type="number" step="1" value="50">
        <label>Wind sensitivity</label><input id="customShipWindInput" type="number" step="0.1" value="1">
      </div>
    </div>
    <div class="row"><button id="buildShipGroupBtn" ${e ? '' : 'disabled'}>Build ship group</button></div>
    <div class="subtleLine">${e ? 'Costs are paid from empire wealth and harbor materials.' : 'Link this harbor to an empire before building ships.'}</div>
    <div class="empireSectionTitle">Ship groups from this harbor</div>
    <ul>${shipRows}</ul>
    ${canUseShip ? `
      <div class="armyEditor">
        <strong>${shipLabel(ship)}</strong>
        <div class="subtleLine">Battle score: ${Math.round(shipBattlePower(ship)).toLocaleString()} · speed ${shipTypeData(ship).speed} km/day · free capacity ${shipFreeCapacity(ship).toLocaleString()}</div>
        <div class="row">
          <select id="loadArmySelect">${nearbyOptions || '<option value="">No loadable nearby army</option>'}</select>
          <button id="loadArmyIntoShipBtn" ${nearby.length ? '' : 'disabled'}>Load army into ships</button>
          <button id="releaseShipCargoBtn" ${cargoSoldierCount(ship) ? '' : 'disabled'}>Release troops to shore</button>
        </div>
      </div>
    ` : '<div class="subtleLine">Select a ship group above to load/release troops.</div>'}
  `;
}

function bindHarborPanelEvents() {
  const s = settlementById(selectedSettlementId);
  if (!s || s.type !== 'harbor') return;
  selectedEmpirePanel.querySelector('#buildShipGroupBtn')?.addEventListener('click', () => buildShipGroupAtHarbor(s));
  selectedEmpirePanel.querySelectorAll('.harborShipPick').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedArmyId = btn.dataset.shipId;
      refreshSelectionPanels();
      refreshEmpirePanels();
      draw();
    });
  });
  selectedEmpirePanel.querySelector('#loadArmyIntoShipBtn')?.addEventListener('click', () => {
    const ship = armyById(selectedArmyId);
    const armyId = selectedEmpirePanel.querySelector('#loadArmySelect')?.value;
    if (ship && armyId) loadArmyIntoShip(ship.id, armyId);
  });
  selectedEmpirePanel.querySelector('#releaseShipCargoBtn')?.addEventListener('click', () => {
    if (selectedArmyId) releaseTroopsFromShip(selectedArmyId);
  });
}

refreshSelectedEmpirePanel = function refreshSelectedEmpirePanelNaval() {
  ORIGINAL_NAVAL.refreshSelectedEmpirePanel();
  const s = settlementById(selectedSettlementId);
  const e = empireById(selectedEmpireId);
  if (!s || !e || !e.settlementIds.includes(s.id) || s.type !== 'harbor') return;
  selectedEmpirePanel.insertAdjacentHTML('beforeend', renderHarborPanel(s));
  bindHarborPanelEvents();
};

refreshSelectionPanels = function refreshSelectionPanelsNaval() {
  ORIGINAL_NAVAL.refreshSelectionPanels();
  const a = armyById(selectedArmyId);
  if (!isShipGroup(a)) return;
  const nearby = nearbyLoadableArmies(a);
  const nearbyOptions = nearby.map(x => `<option value="${x.id}">${x.name} — ${totalArmySoldiers(x).toLocaleString()} soldiers</option>`).join('');
  selectedArmyInfo.insertAdjacentHTML('beforeend', `
    <div class="armyEditor">
      <strong>Ship group</strong>
      <div class="subtleLine">${shipLabel(a)}</div>
      <div class="subtleLine">Battle score: ${Math.round(shipBattlePower(a)).toLocaleString()} · free capacity ${shipFreeCapacity(a).toLocaleString()} · wind-sensitive sea movement.</div>
      <div class="row">
        <select id="selectedShipLoadArmySelect">${nearbyOptions || '<option value="">No loadable nearby army</option>'}</select>
        <button id="selectedShipLoadBtn" ${nearby.length ? '' : 'disabled'}>Load nearby army</button>
        <button id="selectedShipReleaseBtn" ${cargoSoldierCount(a) ? '' : 'disabled'}>Release troops to shore</button>
      </div>
    </div>
  `);
  selectedArmyInfo.querySelector('#selectedShipLoadBtn')?.addEventListener('click', () => {
    const armyId = selectedArmyInfo.querySelector('#selectedShipLoadArmySelect')?.value;
    if (armyId) loadArmyIntoShip(a.id, armyId);
  });
  selectedArmyInfo.querySelector('#selectedShipReleaseBtn')?.addEventListener('click', () => releaseTroopsFromShip(a.id));
};

passTime = function passTimeNaval() {
  ORIGINAL_NAVAL.passTime();

  const shipReports = [];
  const shipsByEmpire = new Map();
  armies.filter(isShipGroup).forEach(ship => {
    const s = settlementById(ship.homeSettlementId);
    const e = s ? empireById(s.empireId) : null;
    if (!e) return;
    if (!shipsByEmpire.has(e.id)) shipsByEmpire.set(e.id, []);
    shipsByEmpire.get(e.id).push(ship);
  });

  for (const [empireId, ships] of shipsByEmpire.entries()) {
    const e = empireById(empireId);
    if (!e) continue;
    let wealth = 0, food = 0;
    for (const ship of ships) {
      const data = shipTypeData(ship);
      if (!isSeaPoint(ship.x, ship.y)) continue;
      let spacingOK = true;
      if (ship.shipType === 'fishingBoats') {
        spacingOK = !ships.some(other => other.id !== ship.id && other.shipType === 'fishingBoats' && pointKmDistance(ship.x, ship.y, other.x, other.y) < 10);
      }
      const spacingMult = spacingOK ? 1 : 0.25;
      wealth += shipCount(ship) * (Number(data.income) || 0) * spacingMult;
      food += shipCount(ship) * (Number(data.foodIncome) || 0) * spacingMult;
    }
    e.wealth.amount = Math.max(0, (Number(e.wealth.amount) || 0) + wealth);
    const harbor = ships.map(s => settlementById(s.homeSettlementId)).find(Boolean);
    if (harbor) {
      ensureSettlementEconomy(harbor);
      harbor.economy.supplies.food += food;
    }
    if (wealth || food) shipReports.push(`${e.name}: ships +${Math.round(wealth)} wealth, +${Math.round(food)} food`);
  }

  if (shipReports.length) readout.textContent += ' Naval income: ' + shipReports.join(' · ');
  refreshEmpirePanels();
};

draw = function drawNaval() {
  ORIGINAL_NAVAL.draw();
  if (currentMapMode === 'wind' && ready) {
    drawWindOverlay(ctx, worldToScreen, 1);
    drawSettlements(ctx, worldToScreen, 1, 'all');
    drawArmies(ctx, worldToScreen, 1);
    drawEncounterPings(ctx, worldToScreen, 1);
  }
};

drawArmies = function drawArmiesNaval(targetCtx, transformer, scale, labelMode = 'auto') {
  targetCtx.save();
  targetCtx.font = `${12 * dpr * scale}px Arial`;
  targetCtx.textBaseline = 'top';

  armies.forEach(a => {
    if (a.route) {
      const p1 = transformer(a.x, a.y);
      const p2 = transformer(a.route.destX, a.route.destY);
      targetCtx.save();
      targetCtx.setLineDash([7 * dpr * scale, 6 * dpr * scale]);
      targetCtx.strokeStyle = isShipGroup(a) ? 'rgba(17,88,145,0.82)' : 'rgba(38,55,91,0.75)';
      targetCtx.lineWidth = 2 * dpr * scale;
      targetCtx.beginPath();
      targetCtx.moveTo(p1.x, p1.y);
      targetCtx.lineTo(p2.x, p2.y);
      targetCtx.stroke();
      targetCtx.restore();
    }
  });

  armies.forEach(a => {
    const p = transformer(a.x, a.y);
    if (p.x < -80 || p.y < -80 || p.x > targetCtx.canvas.width + 80 || p.y > targetCtx.canvas.height + 80) return;

    if (isShipGroup(a)) {
      const w = 17 * dpr * scale, h = 11 * dpr * scale;
      targetCtx.beginPath();
      targetCtx.moveTo(p.x - w * 0.60, p.y);
      targetCtx.quadraticCurveTo(p.x, p.y + h * 0.75, p.x + w * 0.65, p.y);
      targetCtx.lineTo(p.x + w * 0.42, p.y + h * 0.42);
      targetCtx.lineTo(p.x - w * 0.45, p.y + h * 0.42);
      targetCtx.closePath();
      targetCtx.fillStyle = a.id === selectedArmyId ? '#2777d8' : '#176199';
      targetCtx.fill();
      targetCtx.strokeStyle = '#ffffff';
      targetCtx.lineWidth = 1.5 * dpr * scale;
      targetCtx.stroke();
      targetCtx.beginPath();
      targetCtx.moveTo(p.x, p.y - h * 0.95);
      targetCtx.lineTo(p.x, p.y + h * 0.20);
      targetCtx.strokeStyle = '#1e252c';
      targetCtx.stroke();
      targetCtx.beginPath();
      targetCtx.moveTo(p.x + 1 * dpr * scale, p.y - h * 0.88);
      targetCtx.lineTo(p.x + w * 0.42, p.y - h * 0.30);
      targetCtx.lineTo(p.x + 1 * dpr * scale, p.y - h * 0.12);
      targetCtx.closePath();
      targetCtx.fillStyle = '#f3f7fb';
      targetCtx.fill();
    } else {
      const w = 12 * dpr * scale, h = 13 * dpr * scale;
      targetCtx.beginPath();
      targetCtx.moveTo(p.x - w * 0.55, p.y + h * 0.55);
      targetCtx.lineTo(p.x - w * 0.55, p.y - h * 0.55);
      targetCtx.lineTo(p.x + w * 0.35, p.y - h * 0.28);
      targetCtx.lineTo(p.x - w * 0.55, p.y + 0.02 * h);
      targetCtx.closePath();
      targetCtx.fillStyle = a.id === selectedArmyId ? '#3a5ecf' : '#2d4ca7';
      targetCtx.fill();
      targetCtx.strokeStyle = '#ffffff';
      targetCtx.lineWidth = 1.5 * dpr * scale;
      targetCtx.stroke();
      targetCtx.beginPath();
      targetCtx.moveTo(p.x - w * 0.55, p.y - h * 0.60);
      targetCtx.lineTo(p.x - w * 0.55, p.y + h * 0.70);
      targetCtx.strokeStyle = '#232323';
      targetCtx.lineWidth = 1.8 * dpr * scale;
      targetCtx.stroke();
    }

    const shouldLabel = labelMode === 'all' || a.id === selectedArmyId || world.zoom > 3.0 * dpr;
    if (shouldLabel) {
      const label = isShipGroup(a)
        ? (a.route ? `${shipLabel(a)} · ${Math.max(0, ((a.route.endTime - performance.now()) / GAME_DAY_MS)).toFixed(1)}d` : shipLabel(a))
        : (a.route ? `${a.name} · S ${armyScoreLabel(a)} · ${Math.max(0, ((a.route.endTime - performance.now()) / GAME_DAY_MS)).toFixed(1)}d` : `${a.name} · S ${armyScoreLabel(a)}`);
      const tw = targetCtx.measureText(label).width;
      const bx = p.x + 12 * dpr * scale;
      const by = p.y + 4 * dpr * scale;
      targetCtx.fillStyle = 'rgba(14,19,25,0.84)';
      roundRect(targetCtx, bx, by, tw + 14 * dpr * scale, 20 * dpr * scale, 8 * dpr * scale);
      targetCtx.fill();
      targetCtx.fillStyle = '#eef4f8';
      targetCtx.fillText(label, bx + 7 * dpr * scale, by + 4 * dpr * scale);
    }
  });
  targetCtx.restore();
};

armyScore = function armyScoreNaval(army) {
  if (isShipGroup(army)) return shipBattlePower(army);
  return ORIGINAL_NAVAL.armyScore(army);
};
armyScoreLabel = function armyScoreLabelNaval(army) {
  return Math.round(armyScore(army)).toLocaleString();
};
totalArmySoldiers = function totalArmySoldiersNaval(army) {
  if (isShipGroup(army)) return shipCrewCount(army) + cargoSoldierCount(army);
  return ORIGINAL_NAVAL.totalArmySoldiers(army);
};

battleComposition = function battleCompositionNaval(armyIds) {
  const comp = Object.fromEntries(UNIT_TYPES.map(t => [t.key, 0]));
  let total = 0;
  for (const id of armyIds) {
    const a = armyById(id);
    if (!a) continue;
    if (isShipGroup(a)) {
      total += shipCrewCount(a) + cargoSoldierCount(a);
      const cu = cargoUnits(a);
      UNIT_TYPES.forEach(t => { comp[t.key] += Math.max(0, Number(cu[t.key]) || 0); });
      continue;
    }
    const u = normalizeArmyUnits(a);
    UNIT_TYPES.forEach(t => {
      const c = Math.max(0, Number(u[t.key]) || 0);
      comp[t.key] += c;
      total += c;
    });
  }
  return { comp, total };
};

armyPowerVs = function armyPowerVsNaval(army, enemyCompData) {
  const landPower = isShipGroup(army) ? 0 : ORIGINAL_NAVAL.armyPowerVs(army, enemyCompData);
  return landPower + (isShipGroup(army) ? shipBattlePower(army) : 0);
};


const originalJoinEncounterArmies = typeof joinEncounterArmies === 'function' ? joinEncounterArmies : null;
joinEncounterArmies = function joinEncounterArmiesNaval(enc) {
  const live = enc.armyIds.map(id => armyById(id)).filter(Boolean);
  if (live.length < 2) return;

  const allShips = live.every(isShipGroup);
  const noShips = live.every(a => !isShipGroup(a));
  if (noShips && originalJoinEncounterArmies) return originalJoinEncounterArmies(enc);

  if (!allShips) {
    alert('Land armies and ship groups cannot fuse into one army. Load land troops into ships instead.');
    return;
  }

  const base = live[0];
  const name = prompt('Name the joined ship group:', `${base.name} Fleet`);
  if (name === null) return;
  cargoUnits(base);

  for (let i = 1; i < live.length; i++) {
    const other = live[i];
    const sameType = other.shipType === base.shipType && JSON.stringify(other.shipData) === JSON.stringify(base.shipData);
    if (!sameType) {
      // Mixed fleets are allowed; preserve the stronger custom stats by blending battle/speed/income.
      const totalShips = shipCount(base) + shipCount(other);
      const bData = shipTypeData(base), oData = shipTypeData(other);
      base.shipData = {
        ...bData,
        label: 'Mixed Fleet',
        battleScore: ((bData.battleScore || 0) * shipCount(base) + (oData.battleScore || 0) * shipCount(other)) / Math.max(1, totalShips),
        speed: ((bData.speed || 0) * shipCount(base) + (oData.speed || 0) * shipCount(other)) / Math.max(1, totalShips),
        income: ((bData.income || 0) * shipCount(base) + (oData.income || 0) * shipCount(other)) / Math.max(1, totalShips),
        foodIncome: ((bData.foodIncome || 0) * shipCount(base) + (oData.foodIncome || 0) * shipCount(other)) / Math.max(1, totalShips),
        capacity: ((bData.capacity || 0) * shipCount(base) + (oData.capacity || 0) * shipCount(other)) / Math.max(1, totalShips),
        crew: ((bData.crew || 0) * shipCount(base) + (oData.crew || 0) * shipCount(other)) / Math.max(1, totalShips),
        windSensitivity: ((bData.windSensitivity || 1) * shipCount(base) + (oData.windSensitivity || 1) * shipCount(other)) / Math.max(1, totalShips)
      };
      base.shipType = 'custom';
    }

    base.shipCount = shipCount(base) + shipCount(other);
    const bu = cargoUnits(base), ou = cargoUnits(other);
    UNIT_TYPES.forEach(t => { bu[t.key] = (Number(bu[t.key]) || 0) + (Number(ou[t.key]) || 0); });
    base.cargoNames = [...(base.cargoNames || []), ...(other.cargoNames || [])];
    armies = armies.filter(a => a.id !== other.id);
  }

  base.name = name.trim() || `${base.name} Fleet`;
  base.x = live.reduce((s, a) => s + a.x, 0) / live.length;
  base.y = live.reduce((s, a) => s + a.y, 0) / live.length;
  selectedArmyId = base.id;
  encounters = encounters.filter(e => e.id !== enc.id);
  selectedEncounterId = null;
  refreshSelectionPanels();
  refreshBattlePanel(true);
  draw();
};


function ensureHarborShape(s) {
  if (s.type === 'harbor' && !s.harbor) s.harbor = { customShipDesigns: [] };
}
