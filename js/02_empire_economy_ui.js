// 02_empire_economy_ui.js
// Resize/view setup, empire/diplomacy/economy/supply/building panels, save/load, selection panels.
// Loaded in order by index.html. Keep the script tag order unless you fully refactor globals.

function resize() {
    dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.round(innerWidth * dpr);
    canvas.height = Math.round(innerHeight * dpr);
    draw();
  }
  function resetView() {
    const pad = 1.13;
    world.cx = (bbox.minX + bbox.maxX) / 2;
    world.cy = (bbox.minY + bbox.maxY) / 2;
    world.zoom = Math.min(canvas.width / ((bbox.maxX - bbox.minX) * pad), canvas.height / ((bbox.maxY - bbox.minY) * pad));
    draw();
  }

  function settlementById(id) { return settlements.find(s => s.id === id) || null; }
  function armyById(id) { return armies.find(a => a.id === id) || null; }
  function generateId(prefix) { return prefix + '_' + Math.random().toString(36).slice(2, 10); }

  function empireById(id) {
    return empires.find(e => e.id === id) || null;
  }

  function empireNameById(id) {
    const e = empireById(id);
    return e ? e.name : 'Unclaimed';
  }

  function createDefaultEmpire(name) {
    return {
      id: generateId('empire'),
      name,
      settlementIds: [],
      wealth: { amount: 0, changeModifier: 0, lastNet: 0, lastReport: '' }
    };
  }

  function ensureEmpireShape(e) {
    if (!Array.isArray(e.settlementIds)) e.settlementIds = [];
    if (!e.wealth) e.wealth = { amount: 0, changeModifier: 0, lastNet: 0, lastReport: '' };
    if (e.wealth.changeModifier === undefined && e.wealth.change !== undefined) e.wealth.changeModifier = e.wealth.change;
    if (e.wealth.changeModifier === undefined) e.wealth.changeModifier = 0;
    if (e.wealth.amount === undefined) e.wealth.amount = 0;
    if (e.wealth.lastNet === undefined) e.wealth.lastNet = 0;
    if (e.wealth.lastReport === undefined) e.wealth.lastReport = '';
  }

  function diplomacyKey(a, b) {
    return [a, b].sort().join('__');
  }

  function relationBetween(a, b) {
    if (!a || !b || a === b) return 'neutral';
    return diplomacyRelations[diplomacyKey(a, b)] || 'neutral';
  }

  function setActiveMenu(panel) {
    const pairs = [
      [menuArmiesBtn, panelArmies, 'armies'],
      [menuEmpiresBtn, panelEmpires, 'empires'],
      [menuDiplomacyBtn, panelDiplomacy, 'diplomacy'],
      [menuGuideBtn, panelGuide, 'guide']
    ];
    for (const [btn, el, name] of pairs) {
      btn.classList.toggle('active', name === panel);
      el.classList.toggle('active', name === panel);
    }
  }

  function selectEmpire(id) {
    selectedEmpireId = id;
    refreshEmpirePanels();
  }

  function createEmpireFromInput() {
    const name = (empireNameInput.value || '').trim() || `Empire ${empires.length + 1}`;
    const e = createDefaultEmpire(name);
    empires.push(e);
    selectedEmpireId = e.id;
    empireNameInput.value = '';
    refreshEmpirePanels();
  }

  function assignSelectedSettlementToEmpire() {
    const e = empireById(selectedEmpireId);
    const settlementId = empireSettlementSelect.value;
    const s = settlementById(settlementId);
    if (!e || !s) return;

    for (const empire of empires) {
      empire.settlementIds = empire.settlementIds.filter(id => id !== settlementId);
    }

    ensureSettlementEconomy(s);
    s.empireId = e.id;
    if (!e.settlementIds.includes(settlementId)) e.settlementIds.push(settlementId);
    refreshEmpirePanels();
    refreshSelectionPanels();
  }

  function refreshEmpireSelectors() {
    const options = empires.map(e => `<option value="${e.id}">${e.name}</option>`).join('');
    empireSelectA.innerHTML = options;
    empireSelectB.innerHTML = options;
    if (empires.length > 1 && empireSelectB.selectedIndex === 0) empireSelectB.selectedIndex = 1;

    const freeSettlements = settlements.map(s => {
      const owner = s.empireId ? ` — ${empireNameById(s.empireId)}` : ' — Unclaimed';
      return `<option value="${s.id}">${settlementIcon(s.type)} ${s.name}${owner}</option>`;
    }).join('');
    empireSettlementSelect.innerHTML = freeSettlements || '<option value="">No settlements yet</option>';
    assignSettlementBtn.disabled = !selectedEmpireId || !settlements.length;
  }

  function refreshEmpireList() {
    empireList.innerHTML = '';
    if (!empires.length) {
      const li = document.createElement('li');
      li.textContent = 'No empires created yet.';
      empireList.appendChild(li);
      return;
    }

    empires.forEach(e => {
      ensureEmpireShape(e);
      const li = document.createElement('li');
      li.className = 'clickableListItem';
      const settlementCount = e.settlementIds.length;
      li.textContent = `${e.id === selectedEmpireId ? '▶ ' : ''}${e.name} — ${settlementCount} settlement${settlementCount === 1 ? '' : 's'}`;
      if (e.id === selectedEmpireId) li.style.fontWeight = '700';
      li.addEventListener('click', () => selectEmpire(e.id));
      empireList.appendChild(li);
    });
  }

  function refreshDiplomacyPanel() {
    refreshEmpireSelectors();
    diplomacyList.innerHTML = '';

    const ids = Object.keys(diplomacyRelations);
    if (!ids.length) {
      const li = document.createElement('li');
      li.textContent = 'No diplomatic relations set.';
      diplomacyList.appendChild(li);
      return;
    }

    ids.forEach(key => {
      const [a, b] = key.split('__');
      const li = document.createElement('li');
      li.textContent = `${empireNameById(a)} ↔ ${empireNameById(b)} — ${diplomacyRelations[key]}`;
      diplomacyList.appendChild(li);
    });
  }

  function defaultSettlementEconomy(type = 'village') {
    const isFortress = type === 'fortress';
    const isHarbor = type === 'harbor';
    return {
      supplies: {
        food: isFortress ? 85 : isHarbor ? 140 : 120,
        materials: isFortress ? 110 : isHarbor ? 120 : 70,
        lastFoodNet: 0,
        lastMaterialNet: 0
      },
      population: {
        count: isFortress ? 45 : isHarbor ? 120 : 100,
        baseGrowth: isFortress ? 0.7 : isHarbor ? 1.5 : 2,
        lastGrowth: 0
      },
      infrastructure: isFortress || isHarbor ? 1 : 0,
      buildings: [],
      fortificationLevel: isFortress ? 2 : 0,
      pendingArmyWages: 0,
      lastReport: ''
    };
  }

  function ensureSettlementEconomy(s) {
    if (!s.economy) s.economy = defaultSettlementEconomy();
    if (!s.economy.supplies) s.economy.supplies = { food: 120, materials: 70, lastFoodNet: 0, lastMaterialNet: 0 };
    if (!s.economy.population) s.economy.population = { count: 100, baseGrowth: 2, lastGrowth: 0 };
    if (s.economy.infrastructure === undefined) s.economy.infrastructure = 0;
    if (!Array.isArray(s.economy.buildings)) s.economy.buildings = [];
    if (s.economy.fortificationLevel === undefined) s.economy.fortificationLevel = 0;
    if (s.economy.pendingArmyWages === undefined) s.economy.pendingArmyWages = 0;
    if (s.economy.supplies.food === undefined) s.economy.supplies.food = 0;
    if (s.economy.supplies.materials === undefined) s.economy.supplies.materials = 0;
    if (s.economy.supplies.lastFoodNet === undefined) s.economy.supplies.lastFoodNet = 0;
    if (s.economy.supplies.lastMaterialNet === undefined) s.economy.supplies.lastMaterialNet = 0;
    if (s.economy.population.count === undefined) s.economy.population.count = 0;
    if (s.economy.population.baseGrowth === undefined) s.economy.population.baseGrowth = s.economy.population.growth || 0;
    if (s.economy.population.lastGrowth === undefined) s.economy.population.lastGrowth = 0;
    if (s.economy.lastReport === undefined) s.economy.lastReport = '';
    s.economy.buildings.forEach(b => {
      if (!b.id) b.id = generateId('building');
      if (b.remainingPasses === undefined) b.remainingPasses = 0;
      if (b.totalPasses === undefined) b.totalPasses = b.remainingPasses || 0;
      if (!b.type) b.type = 'custom';
      if (!b.name) b.name = BUILDING_PREFABS[b.type]?.label || 'Building';
    });
  }

  function completedBuildings(s, type) {
    ensureSettlementEconomy(s);
    return s.economy.buildings.filter(b => b.type === type && (Number(b.remainingPasses) || 0) <= 0).length;
  }

  function buildingIsComplete(b) {
    return (Number(b.remainingPasses) || 0) <= 0;
  }

  function settlementArmiesForEconomy(s) {
    return armies.filter(a => {
      const home = a.homeSettlementId || a.stationedSettlementId;
      return home === s.id;
    });
  }

  function stationedArmiesAtSettlement(s) {
    return armies.filter(a => a.stationedSettlementId === s.id && !a.route);
  }

  function foodBiomeMultiplier(name) {
    const b = (name || '').toLowerCase();
    let m = 1;
    if (b.includes('plain') || b.includes('agricultural') || b.includes('lowland') || b.includes('olive')) m += 0.28;
    if (b.includes('alluvial') || b.includes('riparian') || b.includes('wetland') || b.includes('meadow')) m += 0.18;
    if (b.includes('forest') || b.includes('woodland')) m += 0.04;
    if (b.includes('scrub') || b.includes('phrygana') || b.includes('maquis')) m -= 0.12;
    if (b.includes('karst') || b.includes('rocky')) m -= 0.18;
    if (b.includes('montane') || b.includes('sub-alpine') || b.includes('high mountain') || b.includes('tundra') || b.includes('scree')) m -= 0.25;
    if (b.includes('coastal')) m += 0.03;
    return clamp(m, 0.55, 1.45);
  }

  function materialBiomeMultiplier(name) {
    const b = (name || '').toLowerCase();
    let m = 1;
    if (b.includes('mine') || b.includes('rocky') || b.includes('karst') || b.includes('mountain') || b.includes('scree') || b.includes('cliff')) m += 0.24;
    if (b.includes('forest') || b.includes('woodland')) m += 0.10;
    if (b.includes('plain') || b.includes('lowland') || b.includes('agricultural') || b.includes('wetland')) m -= 0.10;
    if (b.includes('island') || b.includes('coastal')) m -= 0.03;
    return clamp(m, 0.70, 1.40);
  }

  function settlementBuildingStats(s) {
    ensureSettlementEconomy(s);
    const foodMult = foodBiomeMultiplier(s.biome);
    const matMult = materialBiomeMultiplier(s.biome);
    const completed = s.economy.buildings.filter(buildingIsComplete);

    let foodProd = 0, materialProd = 0, wealthProd = 0;
    let foodUpkeep = 0, materialUpkeep = 0, wealthUpkeep = 0;
    let populationGrowthBonus = 0;
    let wageDiscountBonus = 0;

    function applyCustomModifier(mod) {
      if (!mod || !mod.target || mod.target === 'none') return;
      const value = Number(mod.value) || 0;
      if (mod.target === 'foodProd') foodProd += value;
      if (mod.target === 'materialProd') materialProd += value;
      if (mod.target === 'wealthProd') wealthProd += value;
      if (mod.target === 'foodUpkeep') foodUpkeep += value;
      if (mod.target === 'materialUpkeep') materialUpkeep += value;
      if (mod.target === 'wealthUpkeep') wealthUpkeep += value;
      if (mod.target === 'populationGrowth') populationGrowthBonus += value;
      if (mod.target === 'wageDiscountPercent') wageDiscountBonus += value / 100;
    }

    completed.forEach(b => {
      const p = BUILDING_PREFABS[b.type];
      if (p) {
        foodProd += (p.foodProd || 0) * foodMult;
        materialProd += (p.materialProd || 0) * matMult;
        wealthProd += p.wealthProd || 0;
        foodUpkeep += p.foodUpkeep || 0;
        materialUpkeep += p.materialUpkeep || 0;
        wealthUpkeep += p.wealthUpkeep || 0;
      }
      if (Array.isArray(b.modifiers)) b.modifiers.slice(0, 3).forEach(applyCustomModifier);
    });

    const fortLevel = Math.max(0, Math.min(5, Number(s.economy.fortificationLevel) || 0));
    const fort = FORTIFICATION_LEVELS[fortLevel] || FORTIFICATION_LEVELS[0];
    materialUpkeep += fort.materialUpkeep || 0;

    return {
      foodProd,
      materialProd,
      wealthProd,
      foodUpkeep,
      materialUpkeep,
      wealthUpkeep,
      populationGrowthBonus,
      wageDiscountBonus,
      fortLevel,
      fort
    };
  }

  function wageDiscountForSettlement(s) {
    const barracks = completedBuildings(s, 'barracks');
    const stats = settlementBuildingStats(s);
    return clamp(barracks * 0.10 + (stats.wageDiscountBonus || 0), 0, 0.65);
  }

  function armyWageForSettlement(army, s) {
    const discount = s ? wageDiscountForSettlement(s) : 0;
    const units = normalizeArmyUnits(army);
    let wage = 0;
    UNIT_TYPES.forEach(t => {
      wage += (Number(units[t.key]) || 0) * (t.wage || 0);
    });
    return wage * (1 - discount);
  }

  function armyFoodDemand(army) {
    const units = normalizeArmyUnits(army);
    return UNIT_TYPES.reduce((sum, t) => sum + (Number(units[t.key]) || 0) * (t.food || 0.035), 0);
  }

  function localArmyFoodDemand(s) {
    return settlementArmiesForEconomy(s).reduce((sum, a) => sum + armyFoodDemand(a), 0);
  }

  function averageArmySpeedKmPerDay(army) {
    const units = normalizeArmyUnits(army);
    let total = 0;
    let weighted = 0;
    UNIT_TYPES.forEach(t => {
      const count = Math.max(0, Number(units[t.key]) || 0);
      total += count;
      weighted += count * (t.speed || BASE_INFANTRY_SPEED);
    });
    return total > 0 ? weighted / total : BASE_INFANTRY_SPEED;
  }

  function paymentEmpireForArmy(army) {
    const s = settlementById(army.homeSettlementId || army.stationedSettlementId);
    if (s && s.empireId) return empireById(s.empireId);
    return null;
  }

  function setArmyUnitCount(army, unitKey, requestedCount) {
    normalizeArmyUnits(army);
    const unit = unitByKey(unitKey);
    if (!unit) return;
    const oldCount = Math.max(0, Number(army.units[unitKey]) || 0);
    let newCount = Math.max(0, Math.floor(Number(requestedCount) || 0));
    const delta = newCount - oldCount;

    if (delta > 0) {
      const empire = paymentEmpireForArmy(army);
      const costPer = unit.hireCost || 0;
      const cost = delta * costPer;

      // Armies without an owning empire remain editable for admin/testing purposes.
      if (empire && costPer > 0) {
        ensureEmpireShape(empire);
        empire.wealth.amount = Number(empire.wealth.amount) || 0;
        if (empire.wealth.amount < cost) {
          const affordable = Math.floor(empire.wealth.amount / costPer);
          newCount = oldCount + affordable;
          const actualCost = affordable * costPer;
          empire.wealth.amount -= actualCost;
          if (affordable < delta) alert(`Not enough wealth to hire all ${unit.label}. Hired ${affordable.toLocaleString()} instead. Add wealth to the empire to hire more.`);
        } else {
          empire.wealth.amount -= cost;
        }
      }
    }

    army.units[unitKey] = newCount;
  }

  function localArmyWages(s) {
    return settlementArmiesForEconomy(s).reduce((sum, a) => sum + armyWageForSettlement(a, s), 0);
  }

  function totalEmpirePopulation(e) {
    ensureEmpireShape(e);
    return e.settlementIds.map(id => settlementById(id)).filter(Boolean).reduce((sum, s) => {
      ensureSettlementEconomy(s);
      return sum + (Number(s.economy.population.count) || 0);
    }, 0);
  }

  function formatSigned(n, decimals = 1) {
    const v = Number(n) || 0;
    const str = Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: decimals });
    return `${v >= 0 ? '+' : '-'}${str}`;
  }

  function createBuildingForSettlement(s, type) {
    const e = empireById(s.empireId);
    if (!e) { alert('Link this settlement to an empire before building.'); return; }
    ensureEmpireShape(e);
    ensureSettlementEconomy(s);
    const prefab = BUILDING_PREFABS[type];
    if (!prefab) return;

    if (e.wealth.amount < prefab.moneyCost) { alert('Not enough empire wealth.'); return; }
    if (s.economy.supplies.materials < prefab.materialCost) { alert('Not enough settlement materials.'); return; }

    e.wealth.amount -= prefab.moneyCost;
    s.economy.supplies.materials -= prefab.materialCost;
    s.economy.buildings.push({
      id: generateId('building'),
      type,
      name: prefab.label,
      moneyCost: prefab.moneyCost,
      materialCost: prefab.materialCost,
      totalPasses: prefab.buildPasses,
      remainingPasses: prefab.buildPasses
    });
    refreshEmpirePanels();
  }

  function upgradeFortificationForSettlement(s) {
    const e = empireById(s.empireId);
    if (!e) { alert('Link this settlement to an empire before upgrading fortifications.'); return; }
    ensureEmpireShape(e);
    ensureSettlementEconomy(s);
    const current = Math.max(0, Math.min(5, Number(s.economy.fortificationLevel) || 0));
    if (current >= 5) { alert('Fortifications are already at level 5.'); return; }
    const next = current + 1;
    const cost = FORTIFICATION_LEVELS[next];
    if (e.wealth.amount < cost.wealthCost) { alert('Not enough empire wealth.'); return; }
    if (s.economy.supplies.materials < cost.materialCost) { alert('Not enough settlement materials.'); return; }

    e.wealth.amount -= cost.wealthCost;
    s.economy.supplies.materials -= cost.materialCost;
    s.economy.fortificationLevel = next;
    refreshEmpirePanels();
  }

  function createLocalArmyForSettlement(s) {
    const defaultName = `${s.name} Army`;
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
    refreshSelectionPanels();
    draw();
  }


  function renderUnitInputsForArmy(a, prefix) {
    normalizeArmyUnits(a);
    const rows = UNIT_TYPES.map(t => `
      <label>${t.label}</label>
      <input class="${prefix}UnitInput" data-unit="${t.key}" type="number" min="0" step="1" value="${a.units?.[t.key] || 0}" title="Hire ${t.label}: cost ${t.hireCost} wealth, wage ${t.wage}/pass, food ${t.food}/pass, speed ${t.speed} km/day">
    `).join('');

    return `
      <div class="armyGrid">${rows}</div>
      <div class="subtleLine">Hiring cost is paid immediately from the owning empire&apos;s wealth. Firing soldiers gives no refund.</div>
    `;
  }

  function unitGuideHTML() {
    return UNIT_TYPES.map(t => {
      const counteredBy = UNIT_TYPES.filter(other => (UNIT_COUNTERS[other.key] || []).includes(t.key)).map(other => other.label);
      return `<li><strong>${t.label}</strong> — score ${t.base}, price ${t.hireCost}, wage ${t.wage}/pass, food ${t.food}/pass, speed ${t.speed} km/day. Counters: ${unitLabels(UNIT_COUNTERS[t.key])}. Countered by: ${counteredBy.join(', ') || 'None'}.</li>`;
    }).join('');
  }

  function customModifierOptions(selected = 'none') {
    return Object.entries(CUSTOM_BUILDING_MODIFIERS).map(([key, label]) => `<option value="${key}" ${selected === key ? 'selected' : ''}>${label}</option>`).join('');
  }

  function describeBuilding(b) {
    const prefab = BUILDING_PREFABS[b.type];
    const label = prefab?.label || b.name || 'Custom building';
    const status = buildingIsComplete(b) ? 'complete' : `${b.remainingPasses} pass time left`;
    let details = '';
    if (Array.isArray(b.modifiers) && b.modifiers.length) {
      details = ' · ' + b.modifiers
        .filter(m => m.target && m.target !== 'none' && Number(m.value))
        .map(m => `${CUSTOM_BUILDING_MODIFIERS[m.target]} ${formatSigned(Number(m.value), 1)}`)
        .join(', ');
    }
    return `${label} — ${status}${details}`;
  }

  function createCustomBuildingForSettlement(s) {
    const e = empireById(s.empireId);
    if (!e) { alert('Link this settlement to an empire before building.'); return; }
    ensureEmpireShape(e);
    ensureSettlementEconomy(s);

    const name = (selectedEmpirePanel.querySelector('#customBuildingNameInput')?.value || '').trim() || `Custom building ${s.economy.buildings.length + 1}`;
    const moneyCost = Math.max(0, Number(selectedEmpirePanel.querySelector('#customBuildingMoneyInput')?.value) || 0);
    const materialCost = Math.max(0, Number(selectedEmpirePanel.querySelector('#customBuildingMaterialInput')?.value) || 0);
    const buildPasses = Math.max(0, Math.floor(Number(selectedEmpirePanel.querySelector('#customBuildingTimeInput')?.value) || 0));

    if (e.wealth.amount < moneyCost) { alert('Not enough empire wealth.'); return; }
    if (s.economy.supplies.materials < materialCost) { alert('Not enough settlement materials.'); return; }

    const modifiers = [];
    for (let i = 1; i <= 3; i++) {
      const target = selectedEmpirePanel.querySelector(`#customMod${i}Target`)?.value || 'none';
      const value = Number(selectedEmpirePanel.querySelector(`#customMod${i}Value`)?.value) || 0;
      if (target !== 'none' && value !== 0) modifiers.push({ target, value });
    }

    e.wealth.amount -= moneyCost;
    s.economy.supplies.materials -= materialCost;
    s.economy.buildings.push({
      id: generateId('building'),
      type: 'custom',
      name,
      moneyCost,
      materialCost,
      totalPasses: buildPasses,
      remainingPasses: buildPasses,
      modifiers: modifiers.slice(0, 3)
    });

    refreshEmpirePanels();
  }

  function disbandArmy(id) {
    const army = armyById(id);
    if (!army) return;

    const s = settlementById(army.homeSettlementId || army.stationedSettlementId);
    if (s) {
      ensureSettlementEconomy(s);
      s.economy.pendingArmyWages += armyWageForSettlement(army, s);
    }

    // Remove from live battle/encounter references so disband really clears the army.
    if (activeBattle) {
      activeBattle.sideA.armyIds = activeBattle.sideA.armyIds.filter(x => x !== id);
      activeBattle.sideB.armyIds = activeBattle.sideB.armyIds.filter(x => x !== id);
      activeBattle.pendingJoinIds = (activeBattle.pendingJoinIds || []).filter(x => x !== id);
      activeBattle.ignoredJoinIds = (activeBattle.ignoredJoinIds || []).filter(x => x !== id);
      if (!activeBattle.sideA.armyIds.length || !activeBattle.sideB.armyIds.length) {
        // If one side vanished by disband, close the battle cleanly.
        activeBattle = null;
        battlePanel.classList.add('hidden');
      }
    }

    encounters = encounters
      .map(enc => ({ ...enc, armyIds: enc.armyIds.filter(x => x !== id) }))
      .filter(enc => enc.armyIds.length >= 2);

    Object.keys(ignoredEncounterPairs).forEach(key => {
      if (key.includes(id)) delete ignoredEncounterPairs[key];
    });

    armies = armies.filter(a => a.id !== id);
    if (selectedArmyId === id) selectedArmyId = null;
    pendingDestinationArmyId = pendingDestinationArmyId === id ? null : pendingDestinationArmyId;
    selectedEncounterId = encounters.some(e => e.id === selectedEncounterId) ? selectedEncounterId : null;

    refreshSelectionPanels();
    refreshEmpirePanels();
    refreshBattlePanel(true);
    draw();
  }

  function deleteEmpire(id) {
    const e = empireById(id);
    if (!e) return;
    if (!confirm(`Delete empire “${e.name}”? Settlements will become unclaimed.`)) return;

    settlements.forEach(s => {
      if (s.empireId === id) s.empireId = null;
    });

    empires = empires.filter(empire => empire.id !== id);
    Object.keys(diplomacyRelations).forEach(key => {
      if (key.includes(id)) delete diplomacyRelations[key];
    });

    if (selectedEmpireId === id) selectedEmpireId = empires[0]?.id || null;
    refreshSelectionPanels();
    refreshEmpirePanels();
    draw();
  }

  function deleteSettlement(id) {
    const s = settlementById(id);
    if (!s) return;
    if (!confirm(`Delete settlement “${s.name}”? Armies tied to it will remain on the map but lose their home/stationed settlement.`)) return;

    settlements = settlements.filter(settlement => settlement.id !== id);
    empires.forEach(e => {
      ensureEmpireShape(e);
      e.settlementIds = e.settlementIds.filter(settlementId => settlementId !== id);
    });

    armies.forEach(a => {
      if (a.stationedSettlementId === id) a.stationedSettlementId = null;
      if (a.homeSettlementId === id) a.homeSettlementId = null;
    });

    if (selectedSettlementId === id) selectedSettlementId = null;
    refreshSelectionPanels();
    refreshEmpirePanels();
    draw();
  }

  function refreshSelectedEmpirePanel() {
    const e = empireById(selectedEmpireId);
    if (!e) {
      selectedEmpirePanel.textContent = 'No empire selected.';
      return;
    }
    ensureEmpireShape(e);

    e.settlementIds = e.settlementIds.filter(id => settlementById(id));
    if (!selectedSettlementId || !e.settlementIds.includes(selectedSettlementId)) {
      selectedSettlementId = e.settlementIds[0] || selectedSettlementId;
    }

    const empireSettlements = e.settlementIds.map(id => settlementById(id)).filter(Boolean);
    empireSettlements.forEach(ensureSettlementEconomy);
    const totalPop = totalEmpirePopulation(e);

    const settlementLines = empireSettlements.map(s => {
      const active = s.id === selectedSettlementId ? '▶ ' : '';
      return `<li><button class="empireSettlementPick" data-settlement-id="${s.id}">${active}${settlementIcon(s.type)} ${s.name}</button> — pop ${Math.round(s.economy.population.count).toLocaleString()} · ${s.biome}</li>`;
    }).join('') || '<li>No settlements linked.</li>';

    const s = settlementById(selectedSettlementId);
    let settlementPanel = '<div class="subtleLine">Select a settlement in this empire to manage supplies, population, infrastructure, buildings and army.</div>';

    if (s && e.settlementIds.includes(s.id)) {
      ensureSettlementEconomy(s);
      const stats = settlementBuildingStats(s);
      const foodNeed = (Number(s.economy.population.count) || 0) * 0.02 + localArmyFoodDemand(s) + stats.foodUpkeep;
      const materialNeed = stats.materialUpkeep;
      const armiesHere = settlementArmiesForEconomy(s);
      const armyOptions = armiesHere.map(a => `<option value="${a.id}" ${a.id === selectedArmyId ? 'selected' : ''}>${a.name} — ${totalArmySoldiers(a).toLocaleString()} soldiers</option>`).join('');
      const activeArmy = armyById(selectedArmyId);
      const canEditActiveArmy = activeArmy && armiesHere.some(a => a.id === activeArmy.id);
      const completedList = s.economy.buildings.map(b => `<li>${describeBuilding(b)}</li>`).join('') || '<li>No buildings yet.</li>';
      const nextFort = Math.min(5, (Number(s.economy.fortificationLevel) || 0) + 1);
      const nextFortCost = FORTIFICATION_LEVELS[nextFort];

      settlementPanel = `
        <div class="empireSectionTitle">Selected settlement</div>
        <div><strong>${s.name}</strong> — ${s.type} · ${s.biome} · ~${Math.round(s.elevation)}m</div>
        <div class="row"><button id="deleteSettlementBtn">Delete settlement</button></div>

        <div class="empireSectionTitle">Supplies</div>
        <div class="empireMiniGrid">
          <label>Food stored</label><input data-settlement-path="supplies.food" type="number" step="1" value="${Math.round(s.economy.supplies.food)}">
          <label>Materials stored</label><input data-settlement-path="supplies.materials" type="number" step="1" value="${Math.round(s.economy.supplies.materials)}">
        </div>
        <div class="subtleLine">Food: ${formatSigned(s.economy.supplies.lastFoodNet)} last pass · expected production ${Math.round(stats.foodProd)} / demand ${Math.round(foodNeed)}.</div>
        <div class="subtleLine">Materials: ${formatSigned(s.economy.supplies.lastMaterialNet)} last pass · expected production ${Math.round(stats.materialProd)} / upkeep ${Math.round(materialNeed)}.</div>
        <div class="subtleLine">Biome multipliers: crops ×${foodBiomeMultiplier(s.biome).toFixed(2)} · mines/materials ×${materialBiomeMultiplier(s.biome).toFixed(2)}.</div>

        <div class="empireSectionTitle">Infrastructure</div>
        <div class="empireMiniGrid">
          <label>Infrastructure points</label><input data-settlement-path="infrastructure" type="number" step="1" value="${s.economy.infrastructure}">
        </div>
        <div class="subtleLine">Population growth multiplier: ×${Math.pow(1.2, Number(s.economy.infrastructure) || 0).toFixed(2)}. This is admin-set and does not change by pass time.</div>

        <div class="empireSectionTitle">Population</div>
        <div class="empireMiniGrid">
          <label>Current population</label><input data-settlement-path="population.count" type="number" step="1" value="${Math.round(s.economy.population.count)}">
          <label>Base growth / pass</label><input data-settlement-path="population.baseGrowth" type="number" step="1" value="${s.economy.population.baseGrowth}">
        </div>
        <div class="subtleLine">Last growth: ${formatSigned(s.economy.population.lastGrowth)}. Building growth modifiers: ${formatSigned(stats.populationGrowthBonus)}.</div>

        <div class="empireSectionTitle">Buildings</div>
        <ul>${completedList}</ul>
        <div class="row">
          <button class="buildPrefabBtn" data-building-type="crops">Build crops (${BUILDING_PREFABS.crops.moneyCost} wealth / ${BUILDING_PREFABS.crops.materialCost} materials / ${BUILDING_PREFABS.crops.buildPasses} pass)</button>
        </div>
        <div class="row">
          <button class="buildPrefabBtn" data-building-type="mine">Build mine (${BUILDING_PREFABS.mine.moneyCost} wealth / ${BUILDING_PREFABS.mine.materialCost} materials / ${BUILDING_PREFABS.mine.buildPasses} pass)</button>
        </div>
        <div class="row">
          <button class="buildPrefabBtn" data-building-type="market">Build market (${BUILDING_PREFABS.market.moneyCost} wealth / ${BUILDING_PREFABS.market.materialCost} materials / ${BUILDING_PREFABS.market.buildPasses} passes)</button>
        </div>
        <div class="row">
          <button class="buildPrefabBtn" data-building-type="barracks">Build barracks (${BUILDING_PREFABS.barracks.moneyCost} wealth / ${BUILDING_PREFABS.barracks.materialCost} materials / ${BUILDING_PREFABS.barracks.buildPasses} passes)</button>
        </div>

        <div class="empireSectionTitle">Create custom building</div>
        <div class="empireMiniGrid">
          <label>Name</label><input id="customBuildingNameInput" type="text" placeholder="Custom building">
          <label>Wealth cost</label><input id="customBuildingMoneyInput" type="number" step="1" value="0">
          <label>Material cost</label><input id="customBuildingMaterialInput" type="number" step="1" value="0">
          <label>Build time / pass</label><input id="customBuildingTimeInput" type="number" step="1" value="1">
        </div>
        <div class="subtleLine">Choose up to 3 modifiers. Values can be positive or negative.</div>
        <div class="empireMiniGrid">
          <label>Modifier 1</label><span><select id="customMod1Target">${customModifierOptions()}</select><input id="customMod1Value" type="number" step="1" value="0"></span>
          <label>Modifier 2</label><span><select id="customMod2Target">${customModifierOptions()}</select><input id="customMod2Value" type="number" step="1" value="0"></span>
          <label>Modifier 3</label><span><select id="customMod3Target">${customModifierOptions()}</select><input id="customMod3Value" type="number" step="1" value="0"></span>
        </div>
        <div class="row"><button id="createCustomBuildingBtn">Create custom building</button></div>

        <div class="empireSectionTitle">Fortifications</div>
        <div>Level ${s.economy.fortificationLevel}: ${FORTIFICATION_LEVELS[s.economy.fortificationLevel]?.defenseLabel || 'None'}</div>
        <div class="subtleLine">Current material upkeep: ${stats.fort.materialUpkeep}/pass.</div>
        <div class="row">
          <button id="upgradeFortBtn" ${s.economy.fortificationLevel >= 5 ? 'disabled' : ''}>Upgrade to level ${nextFort} (${nextFortCost.wealthCost} wealth / ${nextFortCost.materialCost} materials)</button>
        </div>

        <div class="empireSectionTitle">Army</div>
        <div class="subtleLine">Wage discount from completed barracks/custom buildings: ${(wageDiscountForSettlement(s) * 100).toFixed(0)}%. Pending disband wage next pass: ${Math.round(s.economy.pendingArmyWages || 0)} wealth.</div>
        <div class="row">
          <select id="settlementArmySelect">${armyOptions || '<option value="">No local armies</option>'}</select>
          <button id="createLocalArmyBtn">Create local army</button>
          <button id="disbandLocalArmyBtn" ${canEditActiveArmy ? '' : 'disabled'}>Disband selected army</button>
        </div>
        ${canEditActiveArmy ? `
          <div class="armyEditor">
            <div><strong>${activeArmy.name}</strong> — wage ${armyWageForSettlement(activeArmy, s).toFixed(1)} wealth/pass · food ${armyFoodDemand(activeArmy).toFixed(1)}/pass · speed ${averageArmySpeedKmPerDay(activeArmy).toFixed(1)} km/day · ${totalArmySoldiers(activeArmy).toLocaleString()} soldiers</div>
            ${renderUnitInputsForArmy(activeArmy, 'settlementArmy')}
          </div>
        ` : '<div class="subtleLine">Select or create a local army to hire/fire soldiers here.</div>'}
        <div class="subtleLine">${s.economy.lastReport || ''}</div>
      `;
    }

    selectedEmpirePanel.innerHTML = `
      <div><strong>${e.name}</strong></div>
      <div class="row"><button id="deleteEmpireBtn">Delete empire</button></div>

      <div class="empireSectionTitle">Wealth</div>
      <div class="empireMiniGrid">
        <label>Current wealth</label><input data-empire-path="wealth.amount" type="number" step="1" value="${Math.round(e.wealth.amount)}">
        <label>Manual wealth change / pass</label><input data-empire-path="wealth.changeModifier" type="number" step="1" value="${e.wealth.changeModifier}">
      </div>
      <div class="subtleLine">Last net wealth change: ${formatSigned(e.wealth.lastNet)}. ${e.wealth.lastReport || ''}</div>

      <div class="empireSectionTitle">Total population</div>
      <div>${Math.round(totalPop).toLocaleString()} people across ${empireSettlements.length} settlement${empireSettlements.length === 1 ? '' : 's'}.</div>

      <div class="empireSectionTitle">Settlements</div>
      <ul>${settlementLines}</ul>

      ${settlementPanel}
    `;

    selectedEmpirePanel.querySelector('#deleteEmpireBtn')?.addEventListener('click', () => deleteEmpire(e.id));
    selectedEmpirePanel.querySelector('#deleteSettlementBtn')?.addEventListener('click', () => {
      const current = settlementById(selectedSettlementId);
      if (current) deleteSettlement(current.id);
    });

    selectedEmpirePanel.querySelectorAll('[data-empire-path]').forEach(input => {
      input.addEventListener('change', () => {
        const current = empireById(selectedEmpireId);
        if (!current) return;
        ensureEmpireShape(current);
        const parts = input.dataset.empirePath.split('.');
        current[parts[0]][parts[1]] = Number(input.value) || 0;
        refreshEmpirePanels();
      });
    });

    selectedEmpirePanel.querySelectorAll('[data-settlement-path]').forEach(input => {
      input.addEventListener('change', () => {
        const current = settlementById(selectedSettlementId);
        if (!current) return;
        ensureSettlementEconomy(current);
        const parts = input.dataset.settlementPath.split('.');
        if (parts.length === 1) current.economy[parts[0]] = Number(input.value) || 0;
        else current.economy[parts[0]][parts[1]] = Number(input.value) || 0;
        refreshEmpirePanels();
      });
    });

    selectedEmpirePanel.querySelectorAll('.empireSettlementPick').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedSettlementId = btn.dataset.settlementId;
        selectedArmyId = null;
        refreshEmpirePanels();
        refreshSelectionPanels();
        draw();
      });
    });

    selectedEmpirePanel.querySelectorAll('.buildPrefabBtn').forEach(btn => {
      btn.addEventListener('click', () => {
        const current = settlementById(selectedSettlementId);
        if (current) createBuildingForSettlement(current, btn.dataset.buildingType);
      });
    });

    selectedEmpirePanel.querySelector('#createCustomBuildingBtn')?.addEventListener('click', () => {
      const current = settlementById(selectedSettlementId);
      if (current) createCustomBuildingForSettlement(current);
    });

    const upgradeFortBtn = selectedEmpirePanel.querySelector('#upgradeFortBtn');
    if (upgradeFortBtn) {
      upgradeFortBtn.addEventListener('click', () => {
        const current = settlementById(selectedSettlementId);
        if (current) upgradeFortificationForSettlement(current);
      });
    }

    const createLocalArmyBtn = selectedEmpirePanel.querySelector('#createLocalArmyBtn');
    if (createLocalArmyBtn) {
      createLocalArmyBtn.addEventListener('click', () => {
        const current = settlementById(selectedSettlementId);
        if (current) createLocalArmyForSettlement(current);
      });
    }

    const disbandLocalArmyBtn = selectedEmpirePanel.querySelector('#disbandLocalArmyBtn');
    if (disbandLocalArmyBtn) {
      disbandLocalArmyBtn.addEventListener('click', () => {
        if (selectedArmyId) disbandArmy(selectedArmyId);
      });
    }

    const settlementArmySelect = selectedEmpirePanel.querySelector('#settlementArmySelect');
    if (settlementArmySelect) {
      settlementArmySelect.addEventListener('change', () => {
        selectedArmyId = settlementArmySelect.value || null;
        refreshEmpirePanels();
        refreshSelectionPanels();
        draw();
      });
    }

    selectedEmpirePanel.querySelectorAll('.settlementArmyUnitInput').forEach(input => {
      input.addEventListener('change', () => {
        const army = armyById(selectedArmyId);
        if (!army) return;
        setArmyUnitCount(army, input.dataset.unit, input.value);
        refreshEmpirePanels();
        refreshSelectionPanels();
        draw();
      });
    });
  }

  function refreshEmpirePanels() {
    settlements.forEach(ensureSettlementEconomy);
    empires.forEach(ensureEmpireShape);
    refreshEmpireList();
    refreshSelectedEmpirePanel();
    refreshDiplomacyPanel();
    refreshSettlementList();
  }

  function passTime() {
    passedTimeCount++;
    let totalReports = [];

    empires.forEach(e => {
      ensureEmpireShape(e);
      let empireNetWealth = Number(e.wealth.changeModifier) || 0;
      let empireTaxes = 0;
      let empireProduction = 0;
      let empireWages = 0;
      let empireUpkeep = 0;

      e.settlementIds.map(id => settlementById(id)).filter(Boolean).forEach(s => {
        ensureSettlementEconomy(s);
        const stats = settlementBuildingStats(s);
        const pop = Math.max(0, Number(s.economy.population.count) || 0);
        const foodDemand = pop * 0.02 + localArmyFoodDemand(s) + stats.foodUpkeep;
        const materialDemand = stats.materialUpkeep;
        const availableFoodRatio = foodDemand > 0 ? (s.economy.supplies.food + stats.foodProd) / foodDemand : 1;

        let infraGrowth = ((Number(s.economy.population.baseGrowth) || 0) + (stats.populationGrowthBonus || 0)) * Math.pow(1.2, Number(s.economy.infrastructure) || 0);
        let actualGrowth;
        if (availableFoodRatio >= 1) actualGrowth = infraGrowth;
        else if (availableFoodRatio >= 0.75) actualGrowth = infraGrowth * ((availableFoodRatio - 0.75) / 0.25);
        else actualGrowth = -Math.max(1, pop * (0.004 + (0.75 - availableFoodRatio) * 0.018));

        s.economy.population.count = Math.max(0, pop + actualGrowth);
        s.economy.population.lastGrowth = actualGrowth;

        const foodNet = stats.foodProd - foodDemand;
        const materialNet = stats.materialProd - materialDemand;
        s.economy.supplies.food = Math.max(0, (Number(s.economy.supplies.food) || 0) + foodNet);
        s.economy.supplies.materials = Math.max(0, (Number(s.economy.supplies.materials) || 0) + materialNet);
        s.economy.supplies.lastFoodNet = foodNet;
        s.economy.supplies.lastMaterialNet = materialNet;

        s.economy.buildings.forEach(b => {
          if ((Number(b.remainingPasses) || 0) > 0) b.remainingPasses--;
        });

        const taxes = s.economy.population.count * 0.015;
        const pendingDisbandWages = Number(s.economy.pendingArmyWages) || 0;
        const wages = localArmyWages(s) + pendingDisbandWages;
        s.economy.pendingArmyWages = 0;
        const wealthNet = taxes + stats.wealthProd - stats.wealthUpkeep - wages;
        empireTaxes += taxes;
        empireProduction += stats.wealthProd;
        empireWages += wages;
        empireUpkeep += stats.wealthUpkeep;
        empireNetWealth += wealthNet;

        const shortageText = availableFoodRatio < 0.75 ? ' Food shortage caused population decline.' : availableFoodRatio < 1 ? ' Food shortage slowed growth.' : '';
        s.economy.lastReport = `Last pass: food ${formatSigned(foodNet)}, materials ${formatSigned(materialNet)}, population ${formatSigned(actualGrowth)}.${shortageText}`;
      });

      e.wealth.amount = Math.max(0, (Number(e.wealth.amount) || 0) + empireNetWealth);
      e.wealth.lastNet = empireNetWealth;
      e.wealth.lastReport = `Taxes ${Math.round(empireTaxes)}, building income ${Math.round(empireProduction)}, wages ${Math.round(empireWages)}, upkeep ${Math.round(empireUpkeep)}, manual ${formatSigned(e.wealth.changeModifier)}.`;
      totalReports.push(`${e.name}: wealth ${formatSigned(empireNetWealth)}`);
    });

    readout.textContent = `Passed time #${passedTimeCount}. ${totalReports.join(' · ') || 'No empires updated.'}`;
    refreshEmpirePanels();
    refreshSelectionPanels();
    draw();
  }

  function buildExportState() {
    const now = performance.now();
    const exportArmies = armies.map(a => {
      const copy = { ...a };
      if (copy.route) copy.route = { ...copy.route, remainingMs: Math.max(0, copy.route.endTime - now) };
      return copy;
    });

    return {
      version: 'greece-nasadem-v6-campaign-menu',
      exportedAt: new Date().toISOString(),
      passedTimeCount,
      currentMapMode,
      windSeed,
      settlements,
      armies: exportArmies,
      empires,
      diplomacyRelations,
      encounters,
      ignoredEncounterPairs,
      activeBattle
    };
  }

  function exportCampaignState() {
    const state = buildExportState();
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `greece-rp-state-${new Date().toISOString().slice(0,19).replace(/[:T]/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(a.href);
    a.remove();
  }

  function importCampaignState(state) {
    if (!state || !Array.isArray(state.settlements) || !Array.isArray(state.armies)) {
      alert('Invalid campaign state file.');
      return;
    }

    const now = performance.now();
    settlements = state.settlements || [];
    settlements.forEach(ensureSettlementEconomy);
    armies = (state.armies || []).map(a => {
      const copy = { ...a };
      if (!copy.units) copy.units = defaultArmyUnits();
      normalizeArmyUnits(copy);
      if (!copy.strategy) copy.strategy = 'neutral';
      if (!copy.homeSettlementId && copy.stationedSettlementId) copy.homeSettlementId = copy.stationedSettlementId;
      if (copy.route && typeof copy.route.remainingMs === 'number') {
        copy.route = { ...copy.route, startTime: now, endTime: now + copy.route.remainingMs };
      }
      return copy;
    });

    empires = state.empires || [];
    empires.forEach(ensureEmpireShape);
    diplomacyRelations = state.diplomacyRelations || {};
    encounters = state.encounters || [];
    ignoredEncounterPairs = state.ignoredEncounterPairs || {};
    activeBattle = state.activeBattle || null;
    passedTimeCount = Number(state.passedTimeCount) || 0;
    windSeed = Number(state.windSeed) || 0;
    selectedSettlementId = null;
    selectedArmyId = null;
    selectedEmpireId = empires[0]?.id || null;
    pendingDestinationArmyId = null;
    selectedEncounterId = null;
    if (state.currentMapMode) setMapMode(state.currentMapMode);
    refreshSelectionPanels();
    refreshEmpirePanels();
    draw();
    readout.textContent = 'Imported campaign state.';
  }

  function settlementTypeLabel(type) {
    if (type === 'capital') return 'Capital';
    if (type === 'fortress') return 'Fortress';
    if (type === 'harbor') return 'Harbor';
    return 'Village';
  }

  function settlementIcon(type) {
    if (type === 'capital') return '★';
    if (type === 'fortress') return '◆';
    if (type === 'harbor') return '⚓';
    return '•';
  }

  function refreshSettlementList() {
    settlementList.innerHTML = '';
    if (!settlements.length) {
      const li = document.createElement('li');
      li.textContent = 'No settlements created yet.';
      settlementList.appendChild(li);
      return;
    }
    settlements.forEach(s => {
      const li = document.createElement('li');
      li.className = 'clickableListItem';
      li.textContent = `${settlementIcon(s.type)} ${s.name} — ${s.biome} · ~${Math.round(s.elevation)}m · ${empireNameById(s.empireId)}`;
      if (s.id === selectedSettlementId) li.style.fontWeight = '700';
      li.addEventListener('click', () => {
        selectedSettlementId = s.id;
        selectedArmyId = null;
        setActiveMenu('armies');
        refreshSelectionPanels();
        draw();
      });
      settlementList.appendChild(li);
    });
  }
  function armyStatusText(a) {
    if (a.battleId) return 'in battle';
    if (a.lockedEncounterId) return 'stopped at encounter';
    if (!a.route) {
      const loc = settlementById(a.stationedSettlementId);
      return `stationed at ${loc ? loc.name : 'field position'}`;
    }
    const remainingMs = Math.max(0, a.route.endTime - performance.now());
    const remainingDays = remainingMs / GAME_DAY_MS;
    return `marching · ${remainingDays.toFixed(1)} days remaining`;
  }
  function refreshArmyList() {
    armyList.innerHTML = '';
    armies.forEach(a => {
      const li = document.createElement('li');
      li.textContent = `${a.name} — Score ${armyScoreLabel(a)} — ${armyStatusText(a)}`;
      li.style.cursor = 'pointer';
      if (a.id === selectedArmyId) li.style.fontWeight = '700';
      li.addEventListener('click', () => selectArmy(a.id));
      armyList.appendChild(li);
    });
  }
  function refreshSelectionPanels() {
    const s = settlementById(selectedSettlementId);
    if (s) {
      const stationedCount = armies.filter(a => a.stationedSettlementId === s.id && !a.route).length;
      selectedSettlementInfo.textContent = `${settlementTypeLabel(s.type)} “${s.name}” · ${s.biome} · ~${Math.round(s.elevation)}m · ${stationedCount} stationed army${stationedCount === 1 ? '' : 'ies'}`;
      addArmyBtn.disabled = false;
    } else {
      selectedSettlementInfo.textContent = 'None selected.';
      addArmyBtn.disabled = true;
    }

    const a = armyById(selectedArmyId);
    if (a) {
      const b = unitScoreBreakdown(a);
      const loc = a.route ? `${Math.round(a.route.distanceKm)} km total · ${a.route.speedKmPerDay.toFixed(1)} km/day · ${a.route.totalDays.toFixed(1)} days` : `stationed at ${(settlementById(a.stationedSettlementId)?.name || 'field position')}`;
      selectedArmyInfo.innerHTML = `
        <div><strong>${a.name}</strong> — Score <strong>${Math.round(b.total).toLocaleString()}</strong></div>
        <div class="row"><button id="disbandSelectedArmyBtn">Disband this army</button></div>
        <div class="armyContents">${loc}</div>
        <div class="armyContents">Biome: ${b.biome} · Terrain: ${b.terrain}</div>
        <div class="armyContents">Total soldiers: ${totalArmySoldiers(a).toLocaleString()}</div>
        <div class="armyContents">Average speed: ${averageArmySpeedKmPerDay(a).toFixed(1)} km/day · Food demand: ${armyFoodDemand(a).toFixed(1)}/pass · Wage: ${armyWageForSettlement(a, settlementById(a.homeSettlementId || a.stationedSettlementId)).toFixed(1)}/pass</div>
        <div class="armyEditor">
          ${renderUnitInputsForArmy(a, 'army')}
          <div class="armyGrid">
            <label>Strategy</label>
            <select id="strategySelect">${strategyOptions(a.strategy || 'neutral')}</select>
          </div>
          <div class="armyScoreLine">Raw: ${Math.round(b.raw).toLocaleString()} · Strategy: ${STRATEGY_LABELS[b.strategy] || 'Neutral'} ×${b.strategyMult}</div>
        </div>
      `;
      selectedArmyInfo.querySelectorAll('.armyUnitInput').forEach(input => {
        input.addEventListener('change', () => {
          const army = armyById(selectedArmyId);
          if (!army) return;
          setArmyUnitCount(army, input.dataset.unit, input.value);
          refreshSelectionPanels();
          refreshEmpirePanels();
          draw();
        });
      });
      const strategySelect = selectedArmyInfo.querySelector('#strategySelect');
      if (strategySelect) {
        strategySelect.addEventListener('change', () => {
          const army = armyById(selectedArmyId);
          if (!army) return;
          army.strategy = strategySelect.value;
          refreshSelectionPanels();
          draw();
        });
      }
      const disbandSelectedArmyBtn = selectedArmyInfo.querySelector('#disbandSelectedArmyBtn');
      if (disbandSelectedArmyBtn) {
        const disbandId = a.id;
        disbandSelectedArmyBtn.addEventListener('click', () => {
          if (disbandId && confirm('Disband this army? Its upkeep will still be paid on the next pass time.')) disbandArmy(disbandId);
        });
      }
      setDestinationBtn.disabled = false;
    } else {
      selectedArmyInfo.textContent = 'No army selected.';
      setDestinationBtn.disabled = true;
    }
    refreshSettlementList();
    refreshArmyList();
    refreshEmpirePanels();
  }
