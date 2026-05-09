// 04_battle_system.js
// Encounter detection, battle joining, battlepower, casualties, retreat/routing, battle panel.
// Loaded in order by index.html. Keep the script tag order unless you fully refactor globals.

function armyEmpireId(army) {
    const home = settlementById(army.homeSettlementId || army.stationedSettlementId);
    if (home && home.empireId) return home.empireId;
    return army.empireId || `independent:${army.id}`;
  }

  function armyEmpireName(army) {
    const id = armyEmpireId(army);
    return empireNameById(id).startsWith('Unclaimed') ? 'Independent' : empireNameById(id);
  }

  function armyDistanceKm(a, b) {
    return Math.hypot((a.x - b.x) * KM_PER_CELL_X, (a.y - b.y) * KM_PER_CELL_Y);
  }

  function pointDistanceKm(ax, ay, bx, by) {
    return Math.hypot((ax - bx) * KM_PER_CELL_X, (ay - by) * KM_PER_CELL_Y);
  }

  function pairKey(a, b) {
    return [a.id || a, b.id || b].sort().join('__');
  }

  function encounterCenter(enc) {
    const live = enc.armyIds.map(id => armyById(id)).filter(Boolean);
    if (!live.length) return { x: enc.x || 0, y: enc.y || 0 };
    return {
      x: live.reduce((s, a) => s + a.x, 0) / live.length,
      y: live.reduce((s, a) => s + a.y, 0) / live.length
    };
  }

  function pauseArmyForEncounter(army, encounterId) {
    if (!army || army.battleId) return;
    if (army.route && !army.pausedRoute) {
      army.pausedRoute = { ...army.route, remainingMs: Math.max(0, army.route.endTime - performance.now()) };
      army.route = null;
    }
    army.lockedEncounterId = encounterId;
  }

  function resumeArmyFromPause(army) {
    if (!army) return;
    const now = performance.now();
    if (army.pausedRoute) {
      const pr = army.pausedRoute;
      army.route = {
        ...pr,
        startX: army.x,
        startY: army.y,
        startTime: now,
        endTime: now + Math.max(1000, pr.remainingMs || 0)
      };
      delete army.pausedRoute;
    }
    delete army.lockedEncounterId;
    delete army.battleId;
  }

  function armiesAreBattleEligible(a, b) {
    const ea = armyEmpireId(a);
    const eb = armyEmpireId(b);
    if (ea === eb) return false;
    const rel = relationBetween(ea, eb);
    return rel === 'neutral' || rel === 'enemies';
  }

  function scanEncounters(now) {
    let changed = false;

    // clear ignored pairs once armies separate
    for (const key of Object.keys(ignoredEncounterPairs)) {
      const [aId, bId] = key.split('__');
      const a = armyById(aId), b = armyById(bId);
      if (!a || !b || armyDistanceKm(a, b) > 6.2) delete ignoredEncounterPairs[key];
    }

    // Release stale encounter locks that no longer correspond to any active encounter/battle.
    const validEncounterIds = new Set(encounters.map(e => e.id));
    armies.forEach(a => {
      if (a.lockedEncounterId && !validEncounterIds.has(a.lockedEncounterId) && (!activeBattle || a.lockedEncounterId !== activeBattle.id)) {
        delete a.lockedEncounterId;
        if (!a.battleId && !a.pausedRoute) delete a.lockedEncounterId;
      }
    });

    encounters = encounters.filter(enc => {
      const live = enc.armyIds.map(id => armyById(id)).filter(Boolean);
      if (live.length < 2) { changed = true; return false; }
      let close = false;
      for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
        if (armyDistanceKm(live[i], live[j]) <= 5.4) close = true;
      }
      if (!close) { changed = true; return false; }
      return true;
    });

    const existingKeys = new Set(encounters.map(e => e.key));
    for (let i = 0; i < armies.length; i++) {
      const a = armies[i];
      if (!a || a.battleId || a.lockedEncounterId || (a.encounterCooldownUntil && now < a.encounterCooldownUntil)) continue;
      for (let j = i + 1; j < armies.length; j++) {
        const b = armies[j];
        if (!b || b.battleId || b.lockedEncounterId || (b.encounterCooldownUntil && now < b.encounterCooldownUntil)) continue;
        if (armyDistanceKm(a, b) > 5) continue;

        const key = pairKey(a, b);
        if (ignoredEncounterPairs[key] || existingKeys.has(key)) continue;

        const ea = armyEmpireId(a);
        const eb = armyEmpireId(b);
        const sameEmpire = ea === eb;
        const battleEligible = armiesAreBattleEligible(a, b);

        if (!sameEmpire && !battleEligible) continue;

        const id = generateId(sameEmpire ? 'joinEncounter' : 'battleEncounter');
        const enc = {
          id,
          key,
          type: sameEmpire ? 'join' : 'battle',
          armyIds: [a.id, b.id],
          x: (a.x + b.x) / 2,
          y: (a.y + b.y) / 2,
          createdAt: now
        };

        if (enc.type === 'battle') {
          pauseArmyForEncounter(a, id);
          pauseArmyForEncounter(b, id);
        }

        encounters.push(enc);
        existingKeys.add(key);
        changed = true;
      }
    }

    if (changed) draw();
    return changed;
  }

  function findEncounterNear(worldPt) {
    const threshold = (36 * dpr) / world.zoom;
    let best = null, bestDist = Infinity;
    for (const enc of encounters) {
      const c = encounterCenter(enc);
      const d = Math.hypot(c.x - worldPt.x, c.y - worldPt.y);
      if (d < threshold && d < bestDist) { best = enc; bestDist = d; }
    }
    return best;
  }

  function drawEncounterPings(targetCtx, transformer, scale = 1) {
    targetCtx.save();
    targetCtx.font = `${14 * dpr * scale}px Arial`;
    targetCtx.textAlign = 'center';
    targetCtx.textBaseline = 'middle';
    for (const enc of encounters) {
      const c = encounterCenter(enc);
      const p = transformer(c.x, c.y);
      if (p.x < -40 || p.y < -40 || p.x > targetCtx.canvas.width + 40 || p.y > targetCtx.canvas.height + 40) continue;
      const r = 15 * dpr * scale;
      targetCtx.beginPath();
      targetCtx.arc(p.x, p.y - 22 * dpr * scale, r, 0, Math.PI * 2);
      targetCtx.fillStyle = enc.type === 'join' ? '#55c67a' : '#f4c542';
      targetCtx.fill();
      targetCtx.strokeStyle = '#1d252c';
      targetCtx.lineWidth = 2 * dpr * scale;
      targetCtx.stroke();
      targetCtx.fillStyle = '#17212b';
      targetCtx.font = `bold ${15 * dpr * scale}px Arial`;
      targetCtx.fillText('!', p.x, p.y - 22 * dpr * scale + 1 * dpr * scale);
    }
    targetCtx.restore();
  }

  function showEncounterPanel(enc) {
    selectedEncounterId = enc.id;
    activeBattle = activeBattle || null;
    refreshBattlePanel(true);
  }

  function closeBattlePanel() {
    if (!activeBattle && !selectedEncounterId) battlePanel.classList.add('hidden');
  }

  function sameSideName(side) {
    return side === 'A' ? 'Side A' : 'Side B';
  }

  function battleArmyIds(battle) {
    return [...battle.sideA.armyIds, ...battle.sideB.armyIds];
  }

  function sideEmpireIds(armyIds) {
    return [...new Set(armyIds.map(id => armyById(id)).filter(Boolean).map(armyEmpireId))];
  }

  function addArmyToBattleSide(army, side) {
    if (!army || !activeBattle) return;
    pauseArmyForEncounter(army, activeBattle.id);
    army.battleId = activeBattle.id;
    delete army.lockedEncounterId;
    if (side === 'A') {
      if (!activeBattle.sideA.armyIds.includes(army.id)) activeBattle.sideA.armyIds.push(army.id);
    } else {
      if (!activeBattle.sideB.armyIds.includes(army.id)) activeBattle.sideB.armyIds.push(army.id);
    }
    activeBattle.pendingJoinIds = activeBattle.pendingJoinIds.filter(id => id !== army.id);
    refreshBattlePanel(true);
    draw();
  }

  function sideForJoining(army, battle) {
    const e = armyEmpireId(army);
    const sideAEmpires = sideEmpireIds(battle.sideA.armyIds);
    const sideBEmpires = sideEmpireIds(battle.sideB.armyIds);
    let scoreA = 0, scoreB = 0;
    for (const se of sideAEmpires) {
      if (e === se) scoreA += 3;
      const rel = relationBetween(e, se);
      if (rel === 'allies') scoreA += 2;
      if (rel === 'enemies') scoreA -= 2;
    }
    for (const se of sideBEmpires) {
      if (e === se) scoreB += 3;
      const rel = relationBetween(e, se);
      if (rel === 'allies') scoreB += 2;
      if (rel === 'enemies') scoreB -= 2;
    }
    if (scoreA > scoreB && scoreA > 0) return 'A';
    if (scoreB > scoreA && scoreB > 0) return 'B';
    return null;
  }

  function scanBattleJoiners() {
    if (!activeBattle) return false;
    const allIds = new Set([...battleArmyIds(activeBattle), ...activeBattle.pendingJoinIds]);
    const ignoredJoinIds = new Set(activeBattle.ignoredJoinIds || []);
    const c = battleCenter(activeBattle);
    let changed = false;
    for (const a of armies) {
      if (!a || allIds.has(a.id) || ignoredJoinIds.has(a.id) || a.battleId) continue;
      if (pointDistanceKm(a.x, a.y, c.x, c.y) > 5) continue;
      pauseArmyForEncounter(a, activeBattle.id);
      const side = sideForJoining(a, activeBattle);
      if (side) addArmyToBattleSide(a, side);
      else if (!activeBattle.pendingJoinIds.includes(a.id)) {
        activeBattle.pendingJoinIds.push(a.id);
        changed = true;
      }
    }
    return changed;
  }

  function battleCenter(battle) {
    const ids = battleArmyIds(battle);
    const live = ids.map(id => armyById(id)).filter(Boolean);
    if (!live.length) return { x: battle.x || 0, y: battle.y || 0 };
    return {
      x: live.reduce((s, a) => s + a.x, 0) / live.length,
      y: live.reduce((s, a) => s + a.y, 0) / live.length
    };
  }

  function beginBattleFromEncounter(enc) {
    const live = enc.armyIds.map(id => armyById(id)).filter(Boolean);
    if (live.length < 2) return;
    const a = live[0], b = live[1];
    const id = generateId('battle');
    const c = encounterCenter(enc);
    activeBattle = {
      id,
      state: 'holding',
      paused: true,
      elapsedMs: 0,
      durationMs: 180000,
      lastTick: performance.now(),
      x: c.x,
      y: c.y,
      sideA: { name: armyEmpireName(a) || 'Side A', armyIds: [a.id], retreat: false },
      sideB: { name: armyEmpireName(b) || 'Side B', armyIds: [b.id], retreat: false },
      pendingJoinIds: [],
      ignoredJoinIds: [],
      result: null
    };

    for (const army of live) {
      pauseArmyForEncounter(army, id);
      army.battleId = id;
      delete army.lockedEncounterId;
    }

    // Sort extra encounter armies into sides when obvious.
    for (let k = 2; k < live.length; k++) {
      const side = sideForJoining(live[k], activeBattle);
      if (side) addArmyToBattleSide(live[k], side);
      else activeBattle.pendingJoinIds.push(live[k].id);
    }

    encounters = encounters.filter(e => e.id !== enc.id);
    selectedEncounterId = null;
    refreshBattlePanel(true);
    draw();
  }

  function resumeEncounter(enc) {
    const live = enc.armyIds.map(id => armyById(id)).filter(Boolean);
    for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
      ignoredEncounterPairs[pairKey(live[i], live[j])] = true;
    }
    live.forEach(resumeArmyFromPause);
    encounters = encounters.filter(e => e.id !== enc.id);
    selectedEncounterId = null;
    refreshBattlePanel(true);
    draw();
  }

  function joinEncounterArmies(enc) {
    const live = enc.armyIds.map(id => armyById(id)).filter(Boolean);
    if (live.length < 2) return;
    const base = live[0];
    const name = prompt('Name the joined army:', `${base.name} Combined`);
    if (name === null) return;
    normalizeArmyUnits(base);
    for (let i = 1; i < live.length; i++) {
      const other = live[i];
      normalizeArmyUnits(other);
      UNIT_TYPES.forEach(t => {
        base.units[t.key] = (Number(base.units[t.key]) || 0) + (Number(other.units[t.key]) || 0);
      });
      armies = armies.filter(a => a.id !== other.id);
    }
    base.name = name.trim() || `${base.name} Combined`;
    base.x = live.reduce((s, a) => s + a.x, 0) / live.length;
    base.y = live.reduce((s, a) => s + a.y, 0) / live.length;
    selectedArmyId = base.id;
    encounters = encounters.filter(e => e.id !== enc.id);
    selectedEncounterId = null;
    refreshSelectionPanels();
    refreshBattlePanel(true);
    draw();
  }

  function battleComposition(armyIds) {
    const comp = Object.fromEntries(UNIT_TYPES.map(t => [t.key, 0]));
    let total = 0;
    for (const id of armyIds) {
      const a = armyById(id);
      if (!a) continue;
      const u = normalizeArmyUnits(a);
      UNIT_TYPES.forEach(t => {
        const c = Math.max(0, Number(u[t.key]) || 0);
        comp[t.key] += c;
        total += c;
      });
    }
    return { comp, total };
  }

  function sideEnvironment(armyIds) {
    let total = 0, h = 0, slope = 0;
    for (const id of armyIds) {
      const a = armyById(id);
      if (!a) continue;
      const soldiers = Math.max(1, totalArmySoldiers(a));
      total += soldiers;
      h += sampleHeightBilinear(a.x, a.y) * soldiers;
      slope += localSlopeAt(a.x, a.y, 2) * soldiers;
    }
    return { elevation: total ? h / total : 0, slope: total ? slope / total : 0 };
  }

  function friendlySettlementDefenseBonus(army) {
    const eId = armyEmpireId(army);
    let best = { mult: 1, label: '' };
    for (const s of settlements) {
      if (!s.empireId || s.empireId !== eId) continue;
      const d = pointDistanceKm(army.x, army.y, s.x, s.y);
      if (d > 5) continue;
      let mult = 1;
      let label = '';
      if (s.type === 'fortress') { mult = 1.22; label = `defending near fortress “${s.name}” ×1.22`; }
      else if (s.type === 'capital') { mult = 1.12; label = `defending near capital “${s.name}” ×1.12`; }
      else { mult = 1.06; label = `defending near village “${s.name}” ×1.06`; }
      if (mult > best.mult) best = { mult, label };
    }
    return best;
  }

  function sideDefenseAdvantages(armyIds) {
    const labels = [];
    for (const id of armyIds) {
      const a = armyById(id);
      if (!a) continue;
      const b = friendlySettlementDefenseBonus(a);
      if (b.mult > 1.001) labels.push(`${a.name}: ${b.label}`);
    }
    return labels.slice(0, 3);
  }

  function sideTerrainBiomeNotes(armyIds) {
    const mult = terrainBiomeWeightedMultiplier(armyIds);
    const notes = [];
    if (mult >= 1.25) notes.push(`Major terrain/biome advantage ×${mult.toFixed(2)}`);
    else if (mult >= 1.12) notes.push(`Terrain/biome advantage ×${mult.toFixed(2)}`);
    else if (mult <= 0.72) notes.push(`Severe terrain/biome penalty ×${mult.toFixed(2)}`);
    else if (mult <= 0.88) notes.push(`Terrain/biome penalty ×${mult.toFixed(2)}`);

    const comp = battleComposition(armyIds).comp;
    const sampleArmy = armyIds.map(id => armyById(id)).filter(Boolean)[0];
    if (sampleArmy) {
      const terrain = terrainTypeAt(sampleArmy.x, sampleArmy.y).toLowerCase();
      const biome = biomeNameAt(sampleArmy.x, sampleArmy.y).toLowerCase();
      const cav = (comp.cavalry || 0) + (comp.numidianCavalry || 0);
      const total = Object.values(comp).reduce((a, b) => a + b, 0);
      if (total > 0 && cav / total > 0.35 && (terrain.includes('open') || terrain.includes('rolling') || biome.includes('plain') || biome.includes('lowland'))) {
        notes.push('Cavalry-heavy force is favored by open ground.');
      }
      if (total > 0 && cav / total > 0.25 && (terrain.includes('forest') || terrain.includes('wetland') || biome.includes('forest') || biome.includes('wet'))) {
        notes.push('Cavalry-heavy force is badly constrained by terrain.');
      }
      if (total > 0 && ((comp.lightFootmen || 0) + (comp.vikingBerserker || 0)) / total > 0.35 && (terrain.includes('forest') || biome.includes('forest') || terrain.includes('scrub'))) {
        notes.push('Light/raiding infantry is favored by broken cover.');
      }
    }
    return notes.slice(0, 4);
  }

  function armyPowerVs(army, enemyCompData) {
    const biome = biomeNameAt(army.x, army.y);
    const terrain = terrainTypeAt(army.x, army.y);
    const strategyMult = STRATEGY_MULTIPLIERS[army.strategy || 'neutral'] || 1;
    const u = normalizeArmyUnits(army);
    let power = 0;

    UNIT_TYPES.forEach(t => {
      const count = Math.max(0, Number(u[t.key]) || 0);
      if (!count) return;
      const countered = (UNIT_COUNTERS[t.key] || []).reduce((sum, enemyKey) => sum + (enemyCompData.comp[enemyKey] || 0), 0);
      let counteredBy = 0;
      UNIT_TYPES.forEach(enemyType => {
        if ((UNIT_COUNTERS[enemyType.key] || []).includes(t.key)) counteredBy += enemyCompData.comp[enemyType.key] || 0;
      });
      const counterFactor = 1 + clamp((countered - counteredBy) / Math.max(1, enemyCompData.total) * 0.40, -0.28, 0.30);
      const biomeMult = biomeMultiplierFor(t.key, biome);
      const terrainMult = terrainMultiplierFor(t.key, terrain);
      power += count * t.base * biomeMult * terrainMult * counterFactor;
    });

    const defense = friendlySettlementDefenseBonus(army);
    return power * strategyMult * defense.mult;
  }

  function calculateBattlePowers(battle) {
    const compA = battleComposition(battle.sideA.armyIds);
    const compB = battleComposition(battle.sideB.armyIds);
    let powerA = battle.sideA.armyIds.reduce((sum, id) => sum + (armyById(id) ? armyPowerVs(armyById(id), compB) : 0), 0);
    let powerB = battle.sideB.armyIds.reduce((sum, id) => sum + (armyById(id) ? armyPowerVs(armyById(id), compA) : 0), 0);

    const envA = sideEnvironment(battle.sideA.armyIds);
    const envB = sideEnvironment(battle.sideB.armyIds);
    const heightDiff = envA.elevation - envB.elevation;
    const steepA = envA.slope > envB.slope ? envA.slope : 0;
    const steepB = envB.slope > envA.slope ? envB.slope : 0;

    let highA = 1, highB = 1;
    if (heightDiff > 35) highA += clamp(heightDiff / 520, 0, 0.17) + clamp(steepA / 130, 0, 0.13);
    if (heightDiff < -35) highB += clamp((-heightDiff) / 520, 0, 0.17) + clamp(steepB / 130, 0, 0.13);

    powerA *= highA;
    powerB *= highB;

    // During the battle, power degrades as simulated dead/injured pressure accumulates.
    // Actual unit counts are still applied at finish, but this makes live dominance react during combat.
    const preliminaryDominanceA = powerA / Math.max(1, powerA + powerB);
    if (battle && battle.elapsedMs > 0) {
      const progress = clamp(battle.elapsedMs / Math.max(1, battle.durationMs), 0, 1);
      const pressureA = progress * (0.05 + (1 - preliminaryDominanceA) * 0.24);
      const pressureB = progress * (0.05 + preliminaryDominanceA * 0.24);
      powerA *= clamp(1 - pressureA, 0.58, 1);
      powerB *= clamp(1 - pressureB, 0.58, 1);
    }

    const dominanceA = powerA / Math.max(1, powerA + powerB);
    const advantagesA = [];
    const advantagesB = [];
    if (highA > 1.05) advantagesA.push(`Higher ground / steep defensive slope ×${highA.toFixed(2)}`);
    if (highB > 1.05) advantagesB.push(`Higher ground / steep defensive slope ×${highB.toFixed(2)}`);
    if (dominanceA > 0.56) advantagesA.push('Current battlepower advantage');
    if (dominanceA < 0.44) advantagesB.push('Current battlepower advantage');

    const strategyA = battle.sideA.armyIds.map(id => armyById(id)).filter(Boolean).map(a => STRATEGY_MULTIPLIERS[a.strategy || 'neutral'] || 1);
    const strategyB = battle.sideB.armyIds.map(id => armyById(id)).filter(Boolean).map(a => STRATEGY_MULTIPLIERS[a.strategy || 'neutral'] || 1);
    if (Math.max(...strategyA, 1) > 1) advantagesA.push('Manual strategy modifier active');
    if (Math.max(...strategyB, 1) > 1) advantagesB.push('Manual strategy modifier active');

    advantagesA.push(...sideTerrainBiomeNotes(battle.sideA.armyIds));
    advantagesB.push(...sideTerrainBiomeNotes(battle.sideB.armyIds));
    advantagesA.push(...sideDefenseAdvantages(battle.sideA.armyIds));
    advantagesB.push(...sideDefenseAdvantages(battle.sideB.armyIds));

    const compAdvA = UNIT_TYPES.filter(t => (UNIT_COUNTERS[t.key] || []).some(k => compB.comp[k] > 0) && compA.comp[t.key] > 0).slice(0, 3).map(t => `${t.label} counters present enemy units`);
    const compAdvB = UNIT_TYPES.filter(t => (UNIT_COUNTERS[t.key] || []).some(k => compA.comp[k] > 0) && compB.comp[t.key] > 0).slice(0, 3).map(t => `${t.label} counters present enemy units`);
    advantagesA.push(...compAdvA);
    advantagesB.push(...compAdvB);

    return { powerA, powerB, dominanceA, compA, compB, envA, envB, advantagesA, advantagesB };
  }

  function unitFleeThreshold(typeKey) {
    const table = {
      cavalry: 0.24,
      lightFootmen: 0.25,
      archers: 0.23,
      pikemen: 0.20,
      heavyInfantry: 0.19,
      hoplites: 0.17,
      hybridInfantry: 0.18,
      varangianGuards: 0.10,
      hypaspists: 0.14,
      numidianCavalry: 0.24,
      kushArchers: 0.13,
      vikingBerserker: 0.08,
      huscarls: 0.11
    };
    return table[typeKey] ?? 0.20;
  }

  function sideFleeThreshold(compData) {
    let total = 0, weighted = 0;
    UNIT_TYPES.forEach(t => {
      const c = Math.max(0, Number(compData.comp[t.key]) || 0);
      total += c;
      weighted += c * unitFleeThreshold(t.key);
    });
    return clamp(total ? weighted / total : 0.20, 0.08, 0.25);
  }

  function battleCasualties(battle, final = false) {
    const p = calculateBattlePowers(battle);
    const rawProgress = clamp((battle.elapsedMs || 0) / Math.max(1, battle.durationMs), 0, 1);
    const progress = final ? Math.max(rawProgress, 0.72) : rawProgress;
    const domA = p.dominanceA;
    const domB = 1 - domA;
    const totalA = p.compA.total;
    const totalB = p.compB.total;

    // Incapacitation is dead + injured. It ramps to battle-breaking levels within about 3 minutes.
    const incapA = clamp(progress * (0.42 + domB * 0.68), 0, 0.94);
    const incapB = clamp(progress * (0.42 + domA * 0.68), 0, 0.94);

    const deadShareA = clamp(0.24 + domB * 0.23 + (final && domB > 0.57 ? 0.08 : 0), 0.22, 0.58);
    const deadShareB = clamp(0.24 + domA * 0.23 + (final && domA > 0.57 ? 0.08 : 0), 0.22, 0.58);

    const deadA = Math.min(totalA, Math.round(totalA * incapA * deadShareA));
    const deadB = Math.min(totalB, Math.round(totalB * incapB * deadShareB));
    const injuredA = Math.min(totalA - deadA, Math.round(totalA * incapA * (1 - deadShareA)));
    const injuredB = Math.min(totalB - deadB, Math.round(totalB * incapB * (1 - deadShareB)));

    return {
      ...p,
      totalA,
      totalB,
      thresholdA: sideFleeThreshold(p.compA),
      thresholdB: sideFleeThreshold(p.compB),
      activeRatioA: totalA ? Math.max(0, totalA - deadA - injuredA) / totalA : 0,
      activeRatioB: totalB ? Math.max(0, totalB - deadB - injuredB) / totalB : 0,
      deadA,
      deadB,
      injuredA,
      injuredB
    };
  }

  function distributeDeaths(armyIds, deadCount) {
    const live = armyIds.map(id => armyById(id)).filter(Boolean);
    const total = live.reduce((s, a) => s + totalArmySoldiers(a), 0);
    if (!total || deadCount <= 0) return;

    for (const army of live) {
      const armyDeaths = Math.round(deadCount * totalArmySoldiers(army) / total);
      let remaining = armyDeaths;
      const u = normalizeArmyUnits(army);
      const armyTotal = Math.max(1, totalArmySoldiers(army));
      for (const t of UNIT_TYPES) {
        const c = Math.max(0, Number(u[t.key]) || 0);
        if (!c) continue;
        const loss = Math.min(c, Math.round(armyDeaths * c / armyTotal));
        u[t.key] = Math.max(0, c - loss);
        remaining -= loss;
      }
      // remove any rounding remainder from the largest remaining stack
      while (remaining > 0 && totalArmySoldiers(army) > 0) {
        const biggest = UNIT_TYPES.slice().sort((a, b) => (u[b.key] || 0) - (u[a.key] || 0))[0];
        if (!biggest || !u[biggest.key]) break;
        u[biggest.key]--;
        remaining--;
      }
    }
  }

  function routeArmyHome(army) {
    if (!army) return;
    let home = settlementById(army.homeSettlementId);
    if (!home && army.stationedSettlementId) home = settlementById(army.stationedSettlementId);
    if (!home) {
      // Fallback: nearest settlement of the same empire, then nearest settlement overall.
      const eId = armyEmpireId(army);
      const owned = settlements.filter(s => s.empireId && s.empireId === eId);
      const pool = owned.length ? owned : settlements;
      home = pool.slice().sort((a, b) => pointDistanceKm(army.x, army.y, a.x, a.y) - pointDistanceKm(army.x, army.y, b.x, b.y))[0] || null;
      if (home) army.homeSettlementId = home.id;
    }

    delete army.battleId;
    delete army.lockedEncounterId;
    delete army.pausedRoute;
    army.encounterCooldownUntil = performance.now() + 45000;

    if (!home) { army.route = null; return; }
    const stats = computeRouteStats(army.x, army.y, home.x, home.y, army);
    delete army.lockedEncounterId;
    delete army.battleId;
    delete army.pausedRoute;
    army.route = {
      startX: army.x,
      startY: army.y,
      destX: home.x,
      destY: home.y,
      startTime: performance.now(),
      endTime: performance.now() + Math.max(0.05, stats.totalDays) * GAME_DAY_MS,
      distanceKm: stats.distanceKm,
      speedKmPerDay: stats.speedKmPerDay,
      restDays: stats.restDays,
      totalDays: stats.totalDays,
      startName: 'battlefield',
      destName: home.name
    };
    army.stationedSettlementId = null;
  }

  function finishBattle(winnerSide = null, reason = 'resolved') {
    if (!activeBattle) return;
    const battle = activeBattle;
    const c = battleCasualties(battle, true);
    let winner = winnerSide;
    if (!winner) winner = c.dominanceA >= 0.5 ? 'A' : 'B';
    const loser = winner === 'A' ? 'B' : 'A';

    distributeDeaths(battle.sideA.armyIds, c.deadA);
    distributeDeaths(battle.sideB.armyIds, c.deadB);

    const loserIds = loser === 'A' ? battle.sideA.armyIds : battle.sideB.armyIds;
    const winnerIds = winner === 'A' ? battle.sideA.armyIds : battle.sideB.armyIds;
    const allIds = [...new Set([...battle.sideA.armyIds, ...battle.sideB.armyIds, ...(battle.pendingJoinIds || [])])];

    // Stop the just-finished battle from immediately creating a new encounter and re-locking armies.
    for (let i = 0; i < allIds.length; i++) for (let j = i + 1; j < allIds.length; j++) {
      ignoredEncounterPairs[pairKey(allIds[i], allIds[j])] = true;
    }

    loserIds.map(id => armyById(id)).filter(Boolean).forEach(routeArmyHome);
    winnerIds.map(id => armyById(id)).filter(Boolean).forEach(a => {
      delete a.battleId;
      delete a.lockedEncounterId;
      delete a.pausedRoute;
      a.encounterCooldownUntil = performance.now() + 45000;
      a.route = null;
    });

    // Pending joiners are released too.
    (battle.pendingJoinIds || []).map(id => armyById(id)).filter(Boolean).forEach(a => {
      delete a.battleId;
      delete a.lockedEncounterId;
      delete a.pausedRoute;
      a.encounterCooldownUntil = performance.now() + 25000;
    });

    encounters = encounters.filter(enc => !enc.armyIds.some(id => allIds.includes(id)));

    activeBattle = null;
    selectedEncounterId = null;
    battlePanel.classList.remove('hidden');
    battlePanel.innerHTML = `
      <div class="battleHeader">
        <div><strong>Battle ended</strong><div class="subtleLine">${reason}</div></div>
        <button data-battle-action="closeResult">Close</button>
      </div>
      <div>${winner === 'A' ? battle.sideA.name : battle.sideB.name} won. ${loser === 'A' ? battle.sideA.name : battle.sideB.name} is fleeing home.</div>
      <div class="battleGrid">
        <div class="battleSide"><strong>${battle.sideA.name}</strong><br>Dead: ${c.deadA.toLocaleString()} · Injured: ${c.injuredA.toLocaleString()}</div>
        <div class="battleSide"><strong>${battle.sideB.name}</strong><br>Dead: ${c.deadB.toLocaleString()} · Injured: ${c.injuredB.toLocaleString()}</div>
      </div>
    `;
    refreshSelectionPanels();
    refreshArmyList();
    draw();
  }

  function updateActiveBattle(now) {
    if (!activeBattle) return false;
    let changed = scanBattleJoiners();

    if (activeBattle.state === 'running') {
      if (activeBattle.paused) {
        activeBattle.lastTick = now;
      } else {
        activeBattle.elapsedMs += Math.max(0, now - (activeBattle.lastTick || now));
        activeBattle.lastTick = now;
        const live = battleCasualties(activeBattle, false);
        if (activeBattle.elapsedMs > 8000 && live.totalA && live.activeRatioA <= live.thresholdA) {
          finishBattle('B', `${activeBattle.sideA.name} broke and fled.`);
          return true;
        }
        if (activeBattle.elapsedMs > 8000 && live.totalB && live.activeRatioB <= live.thresholdB) {
          finishBattle('A', `${activeBattle.sideB.name} broke and fled.`);
          return true;
        }
        if (activeBattle.elapsedMs >= activeBattle.durationMs) {
          finishBattle(null, 'The battle reached a breaking point after prolonged fighting.');
          return true;
        }
      }
    }

    // Do not constantly re-render while paused/holding, because that closes open dropdowns.
    if (changed) {
      refreshBattlePanel(true);
      lastBattlePanelRender = now;
      return true;
    }

    if (activeBattle.state === 'running' && !activeBattle.paused && now - lastBattlePanelRender > 700) {
      refreshBattlePanel(false);
      lastBattlePanelRender = now;
    }
    return changed;
  }

  function renderSideBattleHTML(battle, sideKey, stats) {
    const side = sideKey === 'A' ? battle.sideA : battle.sideB;
    const total = sideKey === 'A' ? stats.totalA : stats.totalB;
    const dead = sideKey === 'A' ? stats.deadA : stats.deadB;
    const injured = sideKey === 'A' ? stats.injuredA : stats.injuredB;
    const power = sideKey === 'A' ? stats.powerA : stats.powerB;
    const advantages = sideKey === 'A' ? stats.advantagesA : stats.advantagesB;
    const active = Math.max(0, total - dead - injured);
    const activeRatio = sideKey === 'A' ? stats.activeRatioA : stats.activeRatioB;
    const threshold = sideKey === 'A' ? stats.thresholdA : stats.thresholdB;
    const armyLines = side.armyIds.map(id => armyById(id)).filter(Boolean).map(a => {
      return `<div class="subtleLine">${a.name} — ${totalArmySoldiers(a).toLocaleString()} soldiers · strategy <select class="battleArmyStrategy" data-army-id="${a.id}">${strategyOptions(a.strategy || 'neutral')}</select></div>`;
    }).join('');

    return `
      <div class="battleSide">
        <strong>${side.name}</strong>
        <div>Power: ${Math.round(power).toLocaleString()}</div>
        <div>Active: ${active.toLocaleString()} (${Math.round(activeRatio * 100)}%)</div>
        <div>Break/flee threshold: ${Math.round(threshold * 100)}%</div>
        <div>Dead: ${dead.toLocaleString()} · Injured: ${injured.toLocaleString()}</div>
        ${armyLines}
        <ul class="advantageList">${advantages.length ? advantages.map(a => `<li>${a}</li>`).join('') : '<li>No major advantage detected.</li>'}</ul>
        <div class="row"><button data-battle-action="retreat" data-side="${sideKey}">Retreat ${side.name}</button></div>
      </div>
    `;
  }

  function refreshBattlePanel(force = false) {
    if (activeBattle) {
      const b = activeBattle;
      const stats = battleCasualties(b, false);
      const pctA = Math.round(stats.dominanceA * 100);
      const remaining = Math.max(0, (b.durationMs - b.elapsedMs) / 1000);
      battlePanel.classList.remove('hidden');
      battlePanel.innerHTML = `
        <div class="battleHeader">
          <div>
            <strong>Battle</strong>
            <div class="subtleLine">${b.state === 'holding' ? 'Battle held. Start when ready.' : b.paused ? 'Battle paused.' : `Fighting · ${remaining.toFixed(0)}s left`}</div>
          </div>
          <div class="row">
            ${b.state === 'holding' ? '<button data-battle-action="beginBattle">Begin fighting</button>' : ''}
            ${b.state === 'running' ? `<button data-battle-action="${b.paused ? 'resumeBattle' : 'pauseBattle'}">${b.paused ? 'Resume battle' : 'Pause battle'}</button>` : ''}
            <button data-battle-action="closePanel">Hide</button>
          </div>
        </div>
        <div class="dominanceBar"><div class="dominanceA" style="width:${pctA}%"></div></div>
        <div class="subtleLine">Dominance: ${b.sideA.name} ${pctA}% · ${b.sideB.name} ${100 - pctA}%</div>
        <div class="battleGrid">
          ${renderSideBattleHTML(b, 'A', stats)}
          ${renderSideBattleHTML(b, 'B', stats)}
        </div>
        ${b.pendingJoinIds.length ? `
          <div class="smallPanel">
            <strong>Nearby undecided armies</strong>
            ${b.pendingJoinIds.map(id => {
              const a = armyById(id);
              if (!a) return '';
              return `<div class="subtleLine">${a.name} (${armyEmpireName(a)}) <button data-battle-action="joinA" data-army-id="${a.id}">Join ${b.sideA.name}</button><button data-battle-action="joinB" data-army-id="${a.id}">Join ${b.sideB.name}</button><button data-battle-action="ignoreJoin" data-army-id="${a.id}">Resume/ignore</button></div>`;
            }).join('')}
          </div>
        ` : ''}
      `;
      return;
    }

    const enc = encounters.find(e => e.id === selectedEncounterId);
    if (!enc) {
      battlePanel.classList.add('hidden');
      return;
    }

    const live = enc.armyIds.map(id => armyById(id)).filter(Boolean);
    battlePanel.classList.remove('hidden');
    if (enc.type === 'join') {
      battlePanel.innerHTML = `
        <div class="battleHeader">
          <div><strong>Friendly armies nearby</strong><div class="subtleLine">${live.map(a => a.name).join(' + ')}</div></div>
          <button data-battle-action="closePanel">Hide</button>
        </div>
        <div class="row">
          <button data-battle-action="joinArmies" data-encounter-id="${enc.id}">Join armies under a new name</button>
          <button data-battle-action="ignoreEncounter" data-encounter-id="${enc.id}">Ignore</button>
        </div>
      `;
    } else {
      battlePanel.innerHTML = `
        <div class="battleHeader">
          <div><strong>Armies have met</strong><div class="subtleLine">${live.map(a => `${a.name} (${armyEmpireName(a)})`).join(' vs ')}</div></div>
          <button data-battle-action="closePanel">Hide</button>
        </div>
        <div class="row">
          <button data-battle-action="startBattle" data-encounter-id="${enc.id}">Start battle menu</button>
          <button data-battle-action="resumeEncounter" data-encounter-id="${enc.id}">Resume original routes / ignore each other</button>
        </div>
      `;
    }
  }

  function handleBattlePanelClick(e) {
    const btn = e.target.closest('button');
    if (!btn) return;
    const action = btn.dataset.battleAction;
    if (!action) return;

    if (action === 'closePanel') {
      battlePanel.classList.add('hidden');
      return;
    }
    if (action === 'closeResult') {
      battlePanel.classList.add('hidden');
      return;
    }
    if (action === 'startBattle') {
      const enc = encounters.find(x => x.id === btn.dataset.encounterId);
      if (enc) beginBattleFromEncounter(enc);
      return;
    }
    if (action === 'resumeEncounter' || action === 'ignoreEncounter') {
      const enc = encounters.find(x => x.id === btn.dataset.encounterId);
      if (enc) resumeEncounter(enc);
      return;
    }
    if (action === 'joinArmies') {
      const enc = encounters.find(x => x.id === btn.dataset.encounterId);
      if (enc) joinEncounterArmies(enc);
      return;
    }
    if (!activeBattle) return;
    if (action === 'beginBattle') {
      activeBattle.state = 'running';
      activeBattle.paused = false;
      activeBattle.lastTick = performance.now();
      refreshBattlePanel(true);
      return;
    }
    if (action === 'pauseBattle') {
      activeBattle.paused = true;
      refreshBattlePanel(true);
      return;
    }
    if (action === 'resumeBattle') {
      activeBattle.paused = false;
      activeBattle.lastTick = performance.now();
      refreshBattlePanel(true);
      return;
    }
    if (action === 'retreat') {
      const side = btn.dataset.side;
      const winner = side === 'A' ? 'B' : 'A';
      finishBattle(winner, `${side === 'A' ? activeBattle.sideA.name : activeBattle.sideB.name} retreated.`);
      return;
    }
    if (action === 'joinA' || action === 'joinB') {
      const a = armyById(btn.dataset.armyId);
      addArmyToBattleSide(a, action === 'joinA' ? 'A' : 'B');
      return;
    }
    if (action === 'ignoreJoin') {
      const a = armyById(btn.dataset.armyId);
      if (a) {
        activeBattle.pendingJoinIds = activeBattle.pendingJoinIds.filter(id => id !== a.id);
        if (!activeBattle.ignoredJoinIds) activeBattle.ignoredJoinIds = [];
        if (!activeBattle.ignoredJoinIds.includes(a.id)) activeBattle.ignoredJoinIds.push(a.id);
        resumeArmyFromPause(a);
        refreshBattlePanel(true);
        draw();
      }
    }
  }
