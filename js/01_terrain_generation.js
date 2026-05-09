// 01_terrain_generation.js
// Progress helpers, math/noise helpers, DEM/land/biome sampling, terrain generation/rendering.
// Loaded in order by index.html. Keep the script tag order unless you fully refactor globals.

function setProgress(label, p) {
    loadingStep.textContent = label;
    barInner.style.width = Math.max(0, Math.min(100, p * 100)).toFixed(1) + '%';
  }
  function sleepFrame() { return new Promise(resolve => requestAnimationFrame(resolve)); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smoothstep(t) { return t * t * (3 - 2 * t); }

  function hash2(ix, iy) {
    let n = ix * 374761393 + iy * 668265263;
    n = (n ^ (n >> 13)) * 1274126177;
    n = n ^ (n >> 16);
    return (n >>> 0) / 4294967295;
  }
  function noise(x, y) {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const x1 = x0 + 1, y1 = y0 + 1;
    const tx = smoothstep(x - x0), ty = smoothstep(y - y0);
    const a = hash2(x0, y0), b = hash2(x1, y0), c = hash2(x0, y1), d = hash2(x1, y1);
    return lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
  }
  function fbm(x, y, oct) {
    let f = 1, a = 0.5, sum = 0, norm = 0;
    for (let i = 0; i < oct; i++) {
      sum += noise(x * f, y * f) * a;
      norm += a;
      f *= 2.0;
      a *= 0.52;
    }
    return sum / norm;
  }
  function ridgeNoise(x, y, oct) {
    let f = 1, a = 0.55, sum = 0, norm = 0;
    for (let i = 0; i < oct; i++) {
      let n = noise(x * f, y * f);
      n = 1 - Math.abs(n * 2 - 1);
      sum += n * n * a;
      norm += a;
      f *= 2.05;
      a *= 0.54;
    }
    return sum / norm;
  }

  const chains = [
    { x: 0.25, y: 0.21, angle: -0.92, len: 0.28, wid: 0.055, amp: 1.20 },
    { x: 0.18, y: 0.10, angle: -0.12, len: 0.16, wid: 0.065, amp: 0.80 },
    { x: 0.35, y: 0.13, angle: 0.10,  len: 0.24, wid: 0.060, amp: 0.45 },
    { x: 0.24, y: 0.55, angle: -0.36, len: 0.21, wid: 0.070, amp: 0.92 },
    { x: 0.50, y: 0.82, angle: -0.02, len: 0.31, wid: 0.050, amp: 0.82 },
    { x: 0.40, y: 0.36, angle: 1.20,  len: 0.16, wid: 0.040, amp: 0.46 },
    { x: 0.62, y: 0.54, angle: 0.55,  len: 0.14, wid: 0.038, amp: 0.32 },
    { x: 0.47, y: 0.46, angle: -0.55, len: 0.14, wid: 0.038, amp: 0.32 }
  ];
  function chainInfluence(nx, ny, c) {
    const dx = nx - c.x, dy = ny - c.y;
    const ca = Math.cos(c.angle), sa = Math.sin(c.angle);
    const rx = (dx * ca + dy * sa) / c.len;
    const ry = (-dx * sa + dy * ca) / c.wid;
    return c.amp * Math.exp(-(rx * rx + ry * ry) * 2.1);
  }
  function mountainField(nx, ny) {
    let m = 0;
    for (const c of chains) m += chainInfluence(nx, ny, c);
    return m;
  }

  function gaussField(nx, ny, cx, cy, sx, sy, angle = 0, amp = 1) {
    const dx = nx - cx, dy = ny - cy;
    const ca = Math.cos(angle), sa = Math.sin(angle);
    const rx = (dx * ca + dy * sa) / sx;
    const ry = (-dx * sa + dy * ca) / sy;
    return amp * Math.exp(-(rx * rx + ry * ry) * 2.0);
  }

  function ramp(v, a, b) {
    if (b === a) return v >= b ? 1 : 0;
    return smoothstep(clamp((v - a) / (b - a), 0, 1));
  }

  function plateau(v, a, b, c, d) {
    return ramp(v, a, b) * (1 - ramp(v, c, d));
  }

  function dominantBiomeIdFromNeighborhood(ix, iy) {
    const weights = [1,2,1,2,4,2,1,2,1];
    const score = new Float32Array(21);
    let wi = 0;
    for (let yy = -1; yy <= 1; yy++) {
      for (let xx = -1; xx <= 1; xx++) {
        const x = clamp(ix + xx, 0, GRID_W - 1);
        const y = clamp(iy + yy, 0, GRID_H - 1);
        const id = biomeId[y * GRID_W + x];
        score[id] += weights[wi++];
      }
    }
    let bestId = 0, best = -1;
    for (let i = 1; i < score.length; i++) if (score[i] > best) { best = score[i]; bestId = i; }
    return bestId;
  }

  function smoothBiomeColorAt(x, y) {
    const ix = Math.round(x), iy = Math.round(y);
    let rs = 0, gs = 0, bs = 0, total = 0;
    for (let yy = -1; yy <= 1; yy++) {
      for (let xx = -1; xx <= 1; xx++) {
        const sx = clamp(ix + xx, 0, GRID_W - 1);
        const sy = clamp(iy + yy, 0, GRID_H - 1);
        const id = biomeId[sy * GRID_W + sx];
        const w = (xx === 0 && yy === 0) ? 0.60 : (xx === 0 || yy === 0) ? 0.075 : 0.025;
        const c = biomeColorFromId(id);
        rs += c[0] * w; gs += c[1] * w; bs += c[2] * w; total += w;
      }
    }
    return [Math.round(rs / total), Math.round(gs / total), Math.round(bs / total)];
  }

  function terrainColor(h) {
    const stops = [
      [0,    [125, 189, 122]],
      [100,  [156, 198, 108]],
      [250,  [194, 194, 106]],
      [550,  [202, 170, 113]],
      [950,  [181, 136,  98]],
      [1400, [150, 112,  85]],
      [1900, [138, 129, 121]],
      [2400, [202, 205, 206]],
      [2850, [246, 246, 246]]
    ];
    for (let i = 0; i < stops.length - 1; i++) {
      const [ah, ac] = stops[i], [bh, bc] = stops[i + 1];
      if (h <= bh) {
        const t = (h - ah) / (bh - ah || 1);
        return [
          Math.round(lerp(ac[0], bc[0], t)),
          Math.round(lerp(ac[1], bc[1], t)),
          Math.round(lerp(ac[2], bc[2], t))
        ];
      }
    }
    return stops[stops.length - 1][1];
  }
  function seaColor(x, y) {
    const n = fbm(x / 220 + 3.2, y / 220 - 5.1, 2);
    const t = 0.20 + 0.32 * n;
    return [
      Math.round(lerp(182, 145, t)),
      Math.round(lerp(203, 169, t)),
      Math.round(lerp(219, 190, t))
    ];
  }

  function terrainSlopeMetric(x, y) {
    const ix = Math.round(x), iy = Math.round(y);
    if (ix <= 1 || iy <= 1 || ix >= GRID_W - 2 || iy >= GRID_H - 2) return 0;
    const i = iy * GRID_W + ix;
    if (height[i] < 0) return 0;
    const c = height[i];
    const n1 = height[i + 1] < 0 ? c : height[i + 1];
    const n2 = height[i - 1] < 0 ? c : height[i - 1];
    const n3 = height[i + GRID_W] < 0 ? c : height[i + GRID_W];
    const n4 = height[i - GRID_W] < 0 ? c : height[i - GRID_W];
    return (Math.abs(n1 - n2) + Math.abs(n3 - n4)) * 0.5;
  }

  const BIOME_NAMES = {
    0: 'Sea',
    1: 'Thermo-Mediterranean coastal maquis',
    2: 'Dry Aegean phrygana scrubland',
    3: 'Coastal halophytic plain and dunes',
    4: 'Oleo-Ceratonion olive lowlands',
    5: 'Meso-Mediterranean evergreen oak woodland',
    6: 'Sub-Mediterranean mixed oak-hornbeam forest',
    7: 'Fertile inland plain mosaic',
    8: 'Riparian alluvial hardwood forest',
    9: 'Rocky foothill scrub and open woodland',
    10: 'East Thracian steppe woodland',
    11: 'Montane deciduous-beech forest',
    12: 'Montane pine forest',
    13: 'Greek fir forest',
    14: 'Mixed montane conifer forest',
    15: 'Karst highland steppe',
    16: 'Wet highland meadow',
    17: 'Sub-alpine grassland',
    18: 'Oroxerophytic thorn-cushion slopes',
    19: 'High mountain tundra',
    20: 'Maritime clifflands'
  };

  function biomeNameFromId(id) {
    return BIOME_NAMES[id] || 'Unknown biome';
  }

  function biomeColorFromId(id) {
    switch (id) {
      case 1: return [202, 44, 34];
      case 2: return [241, 167, 40];
      case 3: return [102, 177, 217];
      case 4: return [249, 224, 41];
      case 5: return [190, 212, 97];
      case 6: return [131, 177, 62];
      case 7: return [216, 165, 77];
      case 8: return [102, 182, 224];
      case 9: return [224, 145, 130];
      case 10: return [195, 145, 63];
      case 11: return [54, 144, 36];
      case 12: return [64, 129, 50];
      case 13: return [8, 54, 145];
      case 14: return [90, 84, 168];
      case 15: return [245, 236, 127];
      case 16: return [119, 207, 200];
      case 17: return [176, 92, 127];
      case 18: return [205, 164, 144];
      case 19: return [187, 187, 187];
      case 20: return [120, 50, 155];
      default: return [182, 203, 219];
    }
  }

  function classifyBiomeAtIndex(i, x, y) {
    if (!land[i]) return 0;
    const h = height[i];
    const nx = x / GRID_W;
    const ny = y / GRID_H;
    const south = ny;
    const north = 1 - ny;
    const east = nx;
    const west = 1 - nx;
    const coastalness = 1 - ramp(dist[i], 6, 32);
    const nearCoast = 1 - ramp(dist[i], 18, 64);
    const inland = ramp(dist[i], 18, 90);
    const slope = terrainSlopeMetric(x, y);
    const flatness = 1 - ramp(slope, 8, 24);
    const cliffness = ramp(slope, 16, 34);

    const westWetMask = gaussField(nx, ny, 0.16, 0.30, 0.18, 0.30, -0.48, 1) + gaussField(nx, ny, 0.23, 0.54, 0.13, 0.16, -0.35, 0.7);
    const thraceMask = gaussField(nx, ny, 0.80, 0.11, 0.16, 0.08, 0.05, 1);
    const centralPlainMask = gaussField(nx, ny, 0.27, 0.20, 0.13, 0.07, 0.0, 1) + gaussField(nx, ny, 0.22, 0.16, 0.11, 0.06, -0.2, 0.75);
    const southAegeanMask = gaussField(nx, ny, 0.55, 0.64, 0.28, 0.18, -0.08, 1) + gaussField(nx, ny, 0.50, 0.83, 0.19, 0.05, 0.0, 1.1);
    const easternDryMask = gaussField(nx, ny, 0.70, 0.36, 0.22, 0.28, 0.1, 1) + gaussField(nx, ny, 0.56, 0.72, 0.24, 0.10, 0.0, 0.7);
    const pindusMask = gaussField(nx, ny, 0.17, 0.26, 0.10, 0.24, -0.65, 1) + gaussField(nx, ny, 0.21, 0.42, 0.10, 0.16, -0.58, 0.8);
    const pelopMask = gaussField(nx, ny, 0.21, 0.65, 0.11, 0.11, -0.35, 1);
    const creteMask = gaussField(nx, ny, 0.50, 0.84, 0.20, 0.04, 0, 1);

    const macroWet = fbm(x / 230 - 2.4, y / 230 + 5.8, 3);
    const localWet = fbm(x / 95 + 7.1, y / 95 - 1.9, 2);
    const dryNoise = fbm(x / 160 - 6.8, y / 160 + 3.4, 2);
    const riverNoise = fbm(x / 60 + 8.2, y / 60 - 4.6, 2);

    const wetness = clamp(0.18 + 0.23 * macroWet + 0.13 * localWet + 0.25 * westWetMask + 0.10 * centralPlainMask + 0.08 * north + 0.06 * inland - 0.22 * easternDryMask - 0.15 * southAegeanMask, 0, 1);
    const dryness = clamp(0.18 + 0.18 * dryNoise + 0.16 * south + 0.12 * east + 0.19 * southAegeanMask + 0.14 * easternDryMask + 0.06 * coastalness - 0.24 * wetness, 0, 1);
    const warmth = clamp(0.62 + 0.19 * south + 0.12 * coastalness + 0.06 * southAegeanMask - h / 2800 - 0.10 * westWetMask, 0, 1);
    const coolness = clamp(0.06 + 0.40 * north + 0.25 * (h / 2400) + 0.10 * wetness + 0.08 * inland - 0.08 * warmth, 0, 1);
    const valleyBias = clamp((riverNoise - 0.48) * 2.2, 0, 1) * flatness;

    const w = new Float32Array(21);

    w[20] = coastalness * cliffness * plateau(h, 25, 60, 230, 420);
    w[3]  = coastalness * flatness * wetness * plateau(h, 0, 6, 45, 100);
    w[2]  = coastalness * (0.35 + 0.65 * southAegeanMask) * (0.25 + 0.75 * dryness) * plateau(h, 0, 10, 150, 260);
    w[1]  = coastalness * warmth * (0.30 + 0.70 * dryness) * plateau(h, 0, 12, 170, 320) * (0.4 + 0.6 * (1 - southAegeanMask));
    w[4]  = (0.35 + 0.65 * warmth) * (0.25 + 0.75 * dryness) * plateau(h, 50, 90, 260, 430) * (0.35 + 0.65 * (1 - cliffness));
    w[5]  = (0.35 + 0.65 * wetness) * (0.25 + 0.75 * warmth) * plateau(h, 160, 250, 520, 780) * (0.35 + 0.65 * (1 - easternDryMask));
    w[6]  = (0.38 + 0.62 * wetness) * (0.25 + 0.75 * inland) * plateau(h, 260, 420, 920, 1240);
    w[7]  = flatness * (0.35 + 0.65 * wetness) * plateau(h, 15, 45, 260, 380) * (0.25 + 0.75 * centralPlainMask);
    w[8]  = flatness * wetness * (0.2 + 0.8 * valleyBias) * plateau(h, 10, 35, 220, 340);
    w[9]  = (0.40 + 0.60 * dryness) * (0.25 + 0.75 * cliffness) * plateau(h, 260, 400, 920, 1260);
    w[10] = thraceMask * flatness * (0.30 + 0.70 * dryness) * plateau(h, 10, 40, 260, 430);
    w[11] = (0.45 + 0.55 * wetness) * (0.30 + 0.70 * coolness) * plateau(h, 650, 820, 1250, 1500) * (0.2 + 0.8 * (westWetMask + thraceMask));
    w[12] = (0.30 + 0.70 * coolness) * plateau(h, 850, 980, 1500, 1750) * (0.25 + 0.75 * (1 - cliffness * 0.4));
    w[13] = (0.45 + 0.55 * wetness) * (0.25 + 0.75 * inland) * plateau(h, 1100, 1260, 1700, 1960) * (0.25 + 0.75 * Math.max(pindusMask, pelopMask, creteMask * 0.7));
    w[14] = (0.40 + 0.60 * wetness) * (0.35 + 0.65 * coolness) * plateau(h, 1320, 1480, 1860, 2140);
    w[15] = (0.45 + 0.55 * dryness) * plateau(h, 900, 1080, 1600, 1920) * (0.2 + 0.8 * (1 - wetness));
    w[16] = flatness * wetness * coolness * plateau(h, 720, 860, 1260, 1490);
    w[17] = (0.35 + 0.65 * coolness) * (0.30 + 0.70 * wetness) * plateau(h, 1650, 1800, 2120, 2300);
    w[18] = cliffness * (0.30 + 0.70 * dryness) * (0.30 + 0.70 * coolness) * plateau(h, 1720, 1880, 2300, 2480);
    w[19] = plateau(h, 2200, 2360, 3200, 3400) * (0.5 + 0.5 * coolness);

    // Regional nudges so more of the named biomes visibly occur across Greece.
    w[1] += 0.08 * creteMask * coastalness;
    w[2] += 0.12 * southAegeanMask * coastalness;
    w[3] += 0.06 * centralPlainMask * coastalness * wetness;
    w[4] += 0.05 * (1 - westWetMask) * warmth;
    w[7] += 0.05 * centralPlainMask * flatness;
    w[10] += 0.08 * thraceMask;
    w[11] += 0.05 * westWetMask * coolness;
    w[13] += 0.05 * pindusMask * wetness;
    w[15] += 0.06 * southAegeanMask * (h > 850 ? 1 : 0);

    let bestId = 1;
    let best = w[1];
    for (let id = 2; id <= 20; id++) {
      if (w[id] > best) { best = w[id]; bestId = id; }
    }
    return bestId;
  }

  function biomeNameAt(x, y) {
    const ix = Math.round(x), iy = Math.round(y);
    if (ix < 0 || iy < 0 || ix >= GRID_W || iy >= GRID_H) return 'Sea';
    return biomeNameFromId(biomeId[iy * GRID_W + ix]);
  }

  function defaultArmyUnits() {
    return Object.fromEntries(UNIT_TYPES.map(t => [t.key, 0]));
  }

  function normalizeArmyUnits(army) {
    if (!army.units) army.units = defaultArmyUnits();
    UNIT_TYPES.forEach(t => {
      if (army.units[t.key] === undefined) army.units[t.key] = 0;
    });
    return army.units;
  }

  function unitByKey(key) {
    return UNIT_TYPES.find(t => t.key === key) || null;
  }

  function unitLabels(keys) {
    return (keys || []).map(k => unitByKey(k)?.label || k).join(', ') || 'None';
  }

  function totalArmySoldiers(army) {
    const u = normalizeArmyUnits(army);
    return UNIT_TYPES.reduce((sum, t) => sum + Math.max(0, Number(u[t.key]) || 0), 0);
  }

  function terrainTypeAt(x, y) {
    const h = sampleHeightBilinear(x, y);
    if (h < 0) return 'Sea';
    const landVal = sampleLandBilinear(x, y);
    if (landVal <= 0.08) return 'Coastal edge';
    const slope = localSlopeAt ? localSlopeAt(x, y, 2) : terrainSlopeMetric(x, y);
    const b = biomeNameAt(x, y).toLowerCase();

    if (h > 1800) return slope > 8 ? 'High mountain slope' : 'High mountain plateau';
    if (slope > 13) return 'Cliff / scree';
    if (slope > 7.5) return 'Mountain slope';
    if (h > 900) return 'Mountain pass / upland';
    if (b.includes('plain') || b.includes('lowland') || b.includes('agricultural') || b.includes('olive')) return 'Open lowland';
    if (b.includes('forest') || b.includes('woodland')) return 'Forest / woodland';
    if (b.includes('scrub') || b.includes('phrygana') || b.includes('maquis')) return 'Scrubland';
    if (b.includes('halophytic') || b.includes('wet') || b.includes('riparian')) return 'Wetland / river valley';
    if (h > 350) return 'Rocky hills';
    if (h < 60 && landVal < 0.95) return 'Coastal beach';
    return 'Rolling hills';
  }


  function unitHas(typeKey, tag) {
    const t = unitByKey(typeKey);
    return !!(t && t.tags && t.tags.includes(tag));
  }

  function biomeMultiplierFor(typeKey, biomeName) {
    const b = (biomeName || '').toLowerCase();
    let m = 1;

    if (b.includes('plain') || b.includes('lowland') || b.includes('olive') || b.includes('agricultural')) {
      if (unitHas(typeKey, 'cavalry')) m += 0.28;
      if (unitHas(typeKey, 'formation') || typeKey === 'hoplites' || typeKey === 'pikemen') m += 0.11;
      if (unitHas(typeKey, 'heavy')) m += 0.06;
      if (unitHas(typeKey, 'archer')) m += 0.06;
      if (unitHas(typeKey, 'fury')) m -= 0.04;
    }

    if (b.includes('phrygana') || b.includes('scrub') || b.includes('maquis')) {
      if (unitHas(typeKey, 'light') || unitHas(typeKey, 'skirmish')) m += 0.18;
      if (unitHas(typeKey, 'archer')) m += typeKey === 'archers' ? 0.02 : 0.08;
      if (unitHas(typeKey, 'cavalry')) m += unitHas(typeKey, 'light') ? 0.07 : -0.15;
      if (unitHas(typeKey, 'formation')) m -= 0.13;
      if (unitHas(typeKey, 'heavy')) m -= 0.06;
      if (typeKey === 'vikingBerserker') m += 0.05;
    }

    if (b.includes('forest') || b.includes('woodland')) {
      if (unitHas(typeKey, 'light') || unitHas(typeKey, 'skirmish') || unitHas(typeKey, 'fury')) m += 0.22;
      if (typeKey === 'huscarls' || typeKey === 'vikingBerserker') m += 0.12;
      if (typeKey === 'archers') m -= 0.12;
      if (typeKey === 'kushArchers') m -= 0.05;
      if (unitHas(typeKey, 'cavalry')) m -= unitHas(typeKey, 'light') ? 0.17 : 0.34;
      if (unitHas(typeKey, 'formation')) m -= 0.20;
      if (unitHas(typeKey, 'heavy') && typeKey !== 'huscarls') m -= 0.08;
    }

    if (b.includes('karst') || b.includes('rocky') || b.includes('cliff')) {
      if (unitHas(typeKey, 'light') || unitHas(typeKey, 'skirmish') || unitHas(typeKey, 'archer')) m += 0.14;
      if (typeKey === 'hypaspists' || typeKey === 'hybridInfantry') m += 0.10;
      if (unitHas(typeKey, 'cavalry')) m -= 0.28;
      if (unitHas(typeKey, 'formation')) m -= 0.14;
      if (unitHas(typeKey, 'heavy')) m -= 0.06;
    }

    if (b.includes('montane') || b.includes('sub-alpine') || b.includes('high mountain') || b.includes('tundra')) {
      if (unitHas(typeKey, 'light') || unitHas(typeKey, 'skirmish')) m += 0.16;
      if (unitHas(typeKey, 'archer')) m += 0.10;
      if (typeKey === 'hypaspists' || typeKey === 'hybridInfantry') m += 0.10;
      if (unitHas(typeKey, 'cavalry')) m -= 0.36;
      if (unitHas(typeKey, 'formation')) m -= 0.22;
      if (unitHas(typeKey, 'heavy')) m -= 0.11;
      if (typeKey === 'varangianGuards' || typeKey === 'huscarls') m -= 0.05;
    }

    if (b.includes('wet') || b.includes('riparian') || b.includes('halophytic')) {
      if (unitHas(typeKey, 'light') || unitHas(typeKey, 'skirmish')) m += 0.10;
      if (unitHas(typeKey, 'cavalry')) m -= 0.38;
      if (unitHas(typeKey, 'heavy') || unitHas(typeKey, 'formation')) m -= 0.18;
      if (typeKey === 'archers' || typeKey === 'kushArchers') m -= 0.06;
    }

    if (b.includes('coastal') || b.includes('maritime')) {
      if (unitHas(typeKey, 'light') || unitHas(typeKey, 'archer')) m += 0.05;
      if (unitHas(typeKey, 'cavalry')) m -= 0.06;
      if (typeKey === 'kushArchers') m += 0.04;
    }

    if (unitHas(typeKey, 'legendary')) m += 0.02;
    return clamp(m, 0.35, 1.65);
  }

  function terrainMultiplierFor(typeKey, terrainName) {
    const t = (terrainName || '').toLowerCase();
    let m = 1;

    if (t.includes('open lowland') || t.includes('rolling')) {
      if (unitHas(typeKey, 'cavalry')) m += 0.34;
      if (unitHas(typeKey, 'formation') || typeKey === 'hoplites' || typeKey === 'pikemen') m += 0.12;
      if (unitHas(typeKey, 'heavy')) m += 0.06;
      if (unitHas(typeKey, 'archer')) m += 0.07;
      if (unitHas(typeKey, 'fury')) m -= 0.04;
    }

    if (t.includes('rocky hills') || t.includes('mountain pass')) {
      if (unitHas(typeKey, 'light') || unitHas(typeKey, 'archer') || unitHas(typeKey, 'skirmish')) m += 0.17;
      if (typeKey === 'hypaspists' || typeKey === 'hybridInfantry') m += 0.11;
      if (unitHas(typeKey, 'cavalry')) m -= unitHas(typeKey, 'light') ? 0.14 : 0.26;
      if (unitHas(typeKey, 'formation')) m -= 0.14;
      if (unitHas(typeKey, 'heavy') && typeKey !== 'huscarls') m -= 0.07;
    }

    if (t.includes('mountain slope') || t.includes('high mountain')) {
      if (unitHas(typeKey, 'light') || unitHas(typeKey, 'archer') || unitHas(typeKey, 'skirmish')) m += 0.18;
      if (typeKey === 'hypaspists' || typeKey === 'hybridInfantry') m += 0.12;
      if (unitHas(typeKey, 'cavalry')) m -= 0.40;
      if (unitHas(typeKey, 'formation')) m -= 0.24;
      if (unitHas(typeKey, 'heavy')) m -= 0.12;
      if (typeKey === 'varangianGuards') m -= 0.06;
    }

    if (t.includes('cliff') || t.includes('scree')) {
      if (unitHas(typeKey, 'light') || unitHas(typeKey, 'archer')) m += 0.11;
      if (unitHas(typeKey, 'cavalry')) m -= 0.52;
      if (unitHas(typeKey, 'formation')) m -= 0.30;
      if (unitHas(typeKey, 'heavy')) m -= 0.18;
    }

    if (t.includes('forest') || t.includes('scrub')) {
      if (unitHas(typeKey, 'light') || unitHas(typeKey, 'fury') || unitHas(typeKey, 'skirmish')) m += 0.18;
      if (typeKey === 'huscarls' || typeKey === 'vikingBerserker') m += 0.14;
      if (typeKey === 'archers') m -= 0.11;
      if (typeKey === 'kushArchers') m -= 0.04;
      if (unitHas(typeKey, 'cavalry')) m -= unitHas(typeKey, 'light') ? 0.15 : 0.32;
      if (unitHas(typeKey, 'formation')) m -= 0.18;
    }

    if (t.includes('wetland') || t.includes('river')) {
      if (unitHas(typeKey, 'light')) m += 0.08;
      if (unitHas(typeKey, 'cavalry')) m -= 0.42;
      if (unitHas(typeKey, 'heavy') || unitHas(typeKey, 'formation')) m -= 0.20;
      if (unitHas(typeKey, 'archer')) m -= 0.08;
    }

    if (t.includes('coastal beach')) {
      if (unitHas(typeKey, 'light') || unitHas(typeKey, 'archer')) m += 0.06;
      if (unitHas(typeKey, 'cavalry')) m -= 0.08;
      if (unitHas(typeKey, 'formation')) m -= 0.04;
    }

    if (t.includes('sea')) m *= 0.48;
    if (unitHas(typeKey, 'legendary')) m += 0.01;
    return clamp(m, 0.30, 1.75);
  }

  function terrainBiomeWeightedMultiplier(armyIds) {
    let weight = 0, weighted = 0;
    for (const id of armyIds) {
      const a = armyById(id);
      if (!a) continue;
      const biome = biomeNameAt(a.x, a.y);
      const terrain = terrainTypeAt(a.x, a.y);
      const u = normalizeArmyUnits(a);
      UNIT_TYPES.forEach(t => {
        const count = Math.max(0, Number(u[t.key]) || 0);
        if (!count) return;
        const w = count * t.base;
        const m = biomeMultiplierFor(t.key, biome) * terrainMultiplierFor(t.key, terrain);
        weight += w;
        weighted += w * m;
      });
    }
    return weight ? weighted / weight : 1;
  }

  function unitScoreBreakdown(army) {
    const biome = biomeNameAt(army.x, army.y);
    const terrain = terrainTypeAt(army.x, army.y);
    const strategy = army.strategy || 'neutral';
    const strategyMult = STRATEGY_MULTIPLIERS[strategy] || 1;
    const u = normalizeArmyUnits(army);

    const rows = UNIT_TYPES.map(t => {
      const count = Math.max(0, Number(u[t.key]) || 0);
      const biomeMult = biomeMultiplierFor(t.key, biome);
      const terrainMult = terrainMultiplierFor(t.key, terrain);
      const subtotal = count * t.base * biomeMult * terrainMult;
      return { ...t, count, biomeMult, terrainMult, subtotal };
    });

    const raw = rows.reduce((sum, r) => sum + r.subtotal, 0);
    const total = raw * strategyMult;
    return { biome, terrain, strategy, strategyMult, rows, raw, total };
  }

  function armyScore(army) {
    return unitScoreBreakdown(army).total;
  }

  function armyScoreLabel(army) {
    return Math.round(armyScore(army)).toLocaleString();
  }

  function gridMetersToPixels(meters, radiusKm, canvasWidth) {
    return meters / ((radiusKm * 2 * 1000) / canvasWidth);
  }

  function gridToKm(x, y) {
    return { kmX: x * KM_PER_CELL_X, kmY: y * KM_PER_CELL_Y };
  }
  function screenToWorld(sx, sy) {
    return {
      x: world.cx + (sx - canvas.width / 2) / world.zoom,
      y: world.cy + (sy - canvas.height / 2) / world.zoom
    };
  }
  function worldToScreen(x, y) {
    return {
      x: canvas.width / 2 + (x - world.cx) * world.zoom,
      y: canvas.height / 2 + (y - world.cy) * world.zoom
    };
  }

  function sampleHeightBilinear(x, y) {
    if (x < 0 || y < 0 || x >= GRID_W - 1 || y >= GRID_H - 1) return -1;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const tx = x - x0, ty = y - y0;
    const i = y0 * GRID_W + x0;
    const a = height[i], b = height[i + 1], c = height[i + GRID_W], d = height[i + GRID_W + 1];
    if (a < 0 && b < 0 && c < 0 && d < 0) return -1;
    const aa = a < 0 ? 0 : a, bb = b < 0 ? 0 : b, cc = c < 0 ? 0 : c, dd = d < 0 ? 0 : d;
    return lerp(lerp(aa, bb, tx), lerp(cc, dd, tx), ty);
  }
  function sampleLandBilinear(x, y) {
    if (x < 0 || y < 0 || x >= GRID_W - 1 || y >= GRID_H - 1) return 0;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const tx = x - x0, ty = y - y0;
    const i = y0 * GRID_W + x0;
    const a = land[i], b = land[i + 1], c = land[i + GRID_W], d = land[i + GRID_W + 1];
    return lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
  }
  function sampleLandNearest(x, y) {
    const ix = Math.round(x), iy = Math.round(y);
    if (ix < 0 || iy < 0 || ix >= GRID_W || iy >= GRID_H) return 0;
    return land[iy * GRID_W + ix];
  }
  function localShade(x, y, h) {
    const ix = Math.round(x), iy = Math.round(y);
    if (ix <= 1 || iy <= 1 || ix >= GRID_W - 2 || iy >= GRID_H - 2) return 1;
    const i = iy * GRID_W + ix;
    const hx1 = height[i + 1] < 0 ? h : height[i + 1];
    const hx0 = height[i - 1] < 0 ? h : height[i - 1];
    const hy1 = height[i + GRID_W] < 0 ? h : height[i + GRID_W];
    const hy0 = height[i - GRID_W] < 0 ? h : height[i - GRID_W];
    const sx = hx1 - hx0;
    const sy = hy1 - hy0;
    let nx = -sx * 0.020, ny = -sy * 0.020, nz = 1;
    const inv = 1 / Math.hypot(nx, ny, nz);
    nx *= inv; ny *= inv; nz *= inv;
    const lx = -0.58, ly = -0.34, lz = 0.74;
    const ndotl = clamp(nx * lx + ny * ly + nz * lz, 0, 1);
    return 0.80 + ndotl * 0.32;
  }
  function isCoastPixel(x, y) {
    const i = y * GRID_W + x;
    if (!land[i]) return false;
    if (x <= 0 || y <= 0 || x >= GRID_W - 1 || y >= GRID_H - 1) return true;
    return !land[i - 1] || !land[i + 1] || !land[i - GRID_W] || !land[i + GRID_W];
  }

  async function buildLandMask() {
    setProgress('Preparing sharper land mask…', 0.03);
    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = reject;
      im.src = SOURCE_MASK;
    });
    const c = document.createElement('canvas');
    c.width = GRID_W; c.height = GRID_H;
    const cctx = c.getContext('2d');
    cctx.imageSmoothingEnabled = true;
    cctx.drawImage(img, 0, 0, GRID_W, GRID_H);
    const data = cctx.getImageData(0, 0, GRID_W, GRID_H).data;

    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        const idx = (y * GRID_W + x) * 4;
        const lum = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
        const isLand = lum < 218 ? 1 : 0;
        land[y * GRID_W + x] = isLand;
        if (isLand) {
          if (x < bbox.minX) bbox.minX = x;
          if (x > bbox.maxX) bbox.maxX = x;
          if (y < bbox.minY) bbox.minY = y;
          if (y > bbox.maxY) bbox.maxY = y;
        }
      }
      if (y % 90 === 0) { setProgress('Preparing sharper land mask…', 0.03 + y / GRID_H * 0.08); await sleepFrame(); }
    }

    // Mild cleanup pass for coast edges.
    const copy = new Uint8Array(land);
    for (let y = 1; y < GRID_H - 1; y++) {
      for (let x = 1; x < GRID_W - 1; x++) {
        const i = y * GRID_W + x;
        let count = 0;
        for (let yy = -1; yy <= 1; yy++) for (let xx = -1; xx <= 1; xx++) count += copy[i + yy * GRID_W + xx];
        if (copy[i] && count <= 2) land[i] = 0;
        if (!copy[i] && count >= 7) land[i] = 1;
      }
      if (y % 140 === 0) { setProgress('Cleaning coastlines…', 0.11 + y / GRID_H * 0.05); await sleepFrame(); }
    }
  }

  async function buildDistanceField() {
    setProgress('Computing inland distance field…', 0.18);
    const INF = 1e9;
    for (let i = 0; i < dist.length; i++) dist[i] = land[i] ? INF : 0;
    const diag = Math.SQRT2;
    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        const i = y * GRID_W + x;
        let v = dist[i];
        if (x > 0) v = Math.min(v, dist[i - 1] + 1);
        if (y > 0) v = Math.min(v, dist[i - GRID_W] + 1);
        if (x > 0 && y > 0) v = Math.min(v, dist[i - GRID_W - 1] + diag);
        if (x < GRID_W - 1 && y > 0) v = Math.min(v, dist[i - GRID_W + 1] + diag);
        dist[i] = v;
      }
      if (y % 70 === 0) { setProgress('Computing inland distance field…', 0.18 + y / GRID_H * 0.10); await sleepFrame(); }
    }
    for (let y = GRID_H - 1; y >= 0; y--) {
      for (let x = GRID_W - 1; x >= 0; x--) {
        const i = y * GRID_W + x;
        let v = dist[i];
        if (x < GRID_W - 1) v = Math.min(v, dist[i + 1] + 1);
        if (y < GRID_H - 1) v = Math.min(v, dist[i + GRID_W] + 1);
        if (x < GRID_W - 1 && y < GRID_H - 1) v = Math.min(v, dist[i + GRID_W + 1] + diag);
        if (x > 0 && y < GRID_H - 1) v = Math.min(v, dist[i + GRID_W - 1] + diag);
        dist[i] = v;
      }
      if (y % 70 === 0) { setProgress('Computing inland distance field…', 0.28 + (GRID_H - 1 - y) / GRID_H * 0.09); await sleepFrame(); }
    }
  }

  async function buildHeights() {
    setProgress('Generating elevation grid…', 0.38);

    // Major geography-driven mountain systems, laid out as chains instead of random blobs.
    const majorRanges = [
      { x: 0.12, y: 0.14, angle: -0.75, len: 0.09, wid: 0.016, amp: 1.10 }, // far NW Epirus
      { x: 0.15, y: 0.22, angle: -0.75, len: 0.10, wid: 0.016, amp: 1.26 }, // north Pindus
      { x: 0.17, y: 0.31, angle: -0.73, len: 0.11, wid: 0.016, amp: 1.32 }, // central Pindus
      { x: 0.20, y: 0.40, angle: -0.67, len: 0.10, wid: 0.016, amp: 1.18 }, // south Pindus
      { x: 0.23, y: 0.49, angle: -0.58, len: 0.10, wid: 0.016, amp: 0.94 }, // western central Greece
      { x: 0.29, y: 0.19, angle: -0.16, len: 0.08, wid: 0.015, amp: 0.92 }, // Olympus / Ossa belt
      { x: 0.34, y: 0.10, angle: 0.05, len: 0.10, wid: 0.018, amp: 0.72 },  // west Rhodope
      { x: 0.46, y: 0.10, angle: 0.08, len: 0.12, wid: 0.018, amp: 0.64 },  // east Rhodope / Thrace highlands
      { x: 0.35, y: 0.34, angle: -1.02, len: 0.09, wid: 0.013, amp: 0.64 }, // Euboea spine
      { x: 0.16, y: 0.63, angle: -0.30, len: 0.08, wid: 0.016, amp: 0.76 }, // W Peloponnese north
      { x: 0.20, y: 0.67, angle: -0.55, len: 0.08, wid: 0.015, amp: 1.06 }, // central Peloponnese
      { x: 0.18, y: 0.73, angle: -0.57, len: 0.07, wid: 0.014, amp: 1.10 }, // Taygetos
      { x: 0.26, y: 0.68, angle: -0.83, len: 0.07, wid: 0.014, amp: 0.82 }, // eastern Peloponnese
      { x: 0.42, y: 0.84, angle: 0.02, len: 0.07, wid: 0.014, amp: 0.84 },  // west Crete
      { x: 0.50, y: 0.84, angle: 0.02, len: 0.08, wid: 0.014, amp: 0.98 },  // central Crete
      { x: 0.58, y: 0.84, angle: 0.02, len: 0.07, wid: 0.014, amp: 0.84 },  // east Crete
      { x: 0.60, y: 0.56, angle: -0.62, len: 0.07, wid: 0.012, amp: 0.28 }, // Cyclades roughness
      { x: 0.76, y: 0.54, angle: -0.32, len: 0.12, wid: 0.016, amp: 0.72 }, // east Aegean islands
      { x: 0.78, y: 0.35, angle: -0.20, len: 0.17, wid: 0.018, amp: 0.72 }  // Anatolian coast
    ];

    const secondaryRanges = [
      { x: 0.10, y: 0.24, angle: -0.63, len: 0.08, wid: 0.012, amp: 0.48 }, // Epirus coast ridges
      { x: 0.20, y: 0.16, angle: -0.32, len: 0.07, wid: 0.012, amp: 0.42 }, // western Macedonia spurs
      { x: 0.24, y: 0.16, angle: 0.02, len: 0.07, wid: 0.012, amp: 0.38 },  // central Macedonia hills
      { x: 0.24, y: 0.24, angle: -0.48, len: 0.08, wid: 0.012, amp: 0.46 }, // Thessaly west rim
      { x: 0.31, y: 0.28, angle: -0.22, len: 0.07, wid: 0.011, amp: 0.34 }, // Othrys / east Thessaly
      { x: 0.25, y: 0.35, angle: -0.50, len: 0.08, wid: 0.012, amp: 0.46 }, // Agrafa
      { x: 0.27, y: 0.42, angle: -0.38, len: 0.07, wid: 0.011, amp: 0.50 }, // Parnassus / Giona
      { x: 0.33, y: 0.47, angle: -0.28, len: 0.05, wid: 0.011, amp: 0.28 }, // Attica hills
      { x: 0.22, y: 0.58, angle: -0.10, len: 0.08, wid: 0.011, amp: 0.36 }, // north Peloponnese belts
      { x: 0.27, y: 0.62, angle: -0.86, len: 0.07, wid: 0.011, amp: 0.44 }, // east Peloponnese ridges
      { x: 0.36, y: 0.39, angle: -1.02, len: 0.06, wid: 0.010, amp: 0.28 }, // south Euboea
      { x: 0.67, y: 0.60, angle: -0.76, len: 0.06, wid: 0.010, amp: 0.24 }, // central Aegean isles
      { x: 0.75, y: 0.49, angle: -0.30, len: 0.06, wid: 0.010, amp: 0.28 }, // north east Aegean islands
      { x: 0.82, y: 0.62, angle: -0.46, len: 0.07, wid: 0.010, amp: 0.34 }  // Dodecanese / Rhodes
    ];

    const uplands = [
      { x: 0.16, y: 0.28, sx: 0.17, sy: 0.24, ang: -0.45, amp: 1.00 }, // western mainland broad uplift
      { x: 0.32, y: 0.13, sx: 0.23, sy: 0.09, ang: 0.02, amp: 0.62 },  // northern belt
      { x: 0.25, y: 0.44, sx: 0.16, sy: 0.18, ang: -0.35, amp: 0.56 }, // central Greece uplands
      { x: 0.22, y: 0.66, sx: 0.13, sy: 0.12, ang: -0.10, amp: 0.82 }, // Peloponnese mass
      { x: 0.50, y: 0.84, sx: 0.24, sy: 0.05, ang: 0.00, amp: 0.92 },  // Crete uplift
      { x: 0.77, y: 0.54, sx: 0.20, sy: 0.14, ang: -0.20, amp: 0.58 }, // east Aegean region
      { x: 0.79, y: 0.35, sx: 0.22, sy: 0.16, ang: 0.00, amp: 0.56 }   // Anatolian region
    ];

    const basins = [
      { x: 0.22, y: 0.15, sx: 0.12, sy: 0.06, ang: -0.06, amp: 0.92 }, // central Macedonia plain
      { x: 0.27, y: 0.23, sx: 0.10, sy: 0.05, ang: 0.00, amp: 1.00 },  // Thessaly basin
      { x: 0.44, y: 0.13, sx: 0.14, sy: 0.05, ang: 0.00, amp: 0.70 },  // Thrace plain
      { x: 0.31, y: 0.47, sx: 0.05, sy: 0.03, ang: 0.00, amp: 0.38 },  // Boeotia / Attica basin
      { x: 0.22, y: 0.52, sx: 0.06, sy: 0.035, ang: 0.00, amp: 0.30 }, // western Greece corridor
      { x: 0.23, y: 0.59, sx: 0.05, sy: 0.04, ang: 0.00, amp: 0.42 },  // western Peloponnese lowlands
      { x: 0.28, y: 0.61, sx: 0.05, sy: 0.03, ang: 0.00, amp: 0.22 },  // Argolid / east Pelop lowland
      { x: 0.67, y: 0.36, sx: 0.11, sy: 0.06, ang: -0.12, amp: 0.44 }  // east Aegean coast lowlands
    ];

    const corridors = [
      { x: 0.26, y: 0.18, angle: -0.08, len: 0.12, wid: 0.016, amp: 0.70 }, // Macedonia / Thermaic corridor
      { x: 0.27, y: 0.24, angle: 0.02, len: 0.11, wid: 0.016, amp: 0.86 },  // Thessaly interior corridor
      { x: 0.28, y: 0.38, angle: 0.08, len: 0.08, wid: 0.014, amp: 0.62 },  // Spercheios / Maliakos
      { x: 0.27, y: 0.50, angle: 0.04, len: 0.12, wid: 0.015, amp: 0.54 },  // Gulf of Corinth / central passage
      { x: 0.22, y: 0.66, angle: -0.12, len: 0.10, wid: 0.015, amp: 0.42 }  // Peloponnese valleys
    ];

    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        const i = y * GRID_W + x;
        if (!land[i]) { height[i] = -1; continue; }

        const nx = x / GRID_W;
        const ny = y / GRID_H;
        const inland = clamp(dist[i] / 92, 0, 1);
        const coastPull = 1 - inland;

        const warpX = (fbm(nx * 2.1 + 5.2, ny * 2.1 - 4.8, 2) - 0.5) * 0.028;
        const warpY = (fbm(nx * 1.9 - 7.0, ny * 1.9 + 8.1, 2) - 0.5) * 0.028;
        const wx = nx + warpX;
        const wy = ny + warpY;

        const macro = fbm(wx * 2.0 + 1.1, wy * 2.0 - 0.6, 3);
        const meso = fbm(wx * 5.7 - 2.0, wy * 5.6 + 6.0, 3);
        const fine = fbm(wx * 12.0 + 1.8, wy * 12.0 - 3.2, 2);
        const ridgeTexture = ridgeNoise(wx * 6.2 + 10.2, wy * 6.0 - 7.3, 2);
        const spurTexture = ridgeNoise(wx * 11.5 - 6.0, wy * 10.5 + 4.2, 1);

        let major = 0;
        for (const r of majorRanges) major += chainInfluence(wx, wy, r);
        let secondary = 0;
        for (const r of secondaryRanges) secondary += chainInfluence(wx, wy, r);
        let uplift = 0;
        for (const u of uplands) uplift += gaussField(wx, wy, u.x, u.y, u.sx, u.sy, u.ang, u.amp);
        let lowland = 0;
        for (const b of basins) lowland += gaussField(wx, wy, b.x, b.y, b.sx, b.sy, b.ang, b.amp);
        let corridor = 0;
        for (const c of corridors) corridor += chainInfluence(wx, wy, c);

        const westMask = gaussField(wx, wy, 0.15, 0.30, 0.19, 0.28, -0.48, 1);
        const pelopMask = gaussField(wx, wy, 0.22, 0.66, 0.13, 0.12, -0.10, 1);
        const creteMask = gaussField(wx, wy, 0.50, 0.84, 0.22, 0.05, 0.0, 1);
        const aegeanMask = gaussField(wx, wy, 0.64, 0.57, 0.18, 0.14, 0.0, 1);
        const euboeaMask = gaussField(wx, wy, 0.35, 0.35, 0.05, 0.11, -0.95, 1);
        const northMask = gaussField(wx, wy, 0.35, 0.12, 0.32, 0.10, 0.0, 1);
        const ruggedMask = clamp(0.55 * westMask + 0.28 * northMask + 0.28 * pelopMask + 0.25 * creteMask + 0.22 * aegeanMask + 0.12 * euboeaMask, 0, 1.8);

        let h = 16;
        h += 52 * macro;
        h += 28 * meso;
        h += 11 * fine;
        h += 72 * inland;

        // Broad elevated regions first, so Greece feels rugged in many areas, not like one strip.
        h += uplift * (92 + 84 * inland);

        // Geography-oriented range systems.
        h += major * (210 + 230 * inland);
        h += secondary * (105 + 125 * inland);

        // Secondary branching and spur detail, but only where ranges already exist.
        h += Math.max(0, ridgeTexture - 0.35) * (36 + 96 * ruggedMask + 44 * major);
        h += Math.max(0, spurTexture - 0.42) * (16 + 56 * ruggedMask + 26 * secondary);

        // Keep islands meaningfully mountainous.
        h += coastPull * (14 + 26 * (pelopMask + creteMask + aegeanMask + euboeaMask));

        // Preserve basins, valleys, and natural passages.
        h -= lowland * (150 + 120 * coastPull);
        h -= corridor * (90 + 80 * ruggedMask + 35 * major);

        // Low coastal belts should remain readable.
        h -= coastPull * (50 - 10 * (creteMask + aegeanMask));

        // Strong cores in the main ranges.
        h += Math.max(0, major - 0.62) * 110;

        height[i] = clamp(h, 0, 2850);
      }
      if (y % 25 === 0) { setProgress('Generating elevation grid…', 0.38 + y / GRID_H * 0.18); await sleepFrame(); }
    }
  }

  async function smoothHeights(passCount) {
    const kernels = [
      { c: 3.2, axis: 1.25, diag: 0.72 },
      { c: 3.8, axis: 1.05, diag: 0.62 },
      { c: 4.2, axis: 0.90, diag: 0.52 }
    ];
    for (let pass = 0; pass < passCount; pass++) {
      setProgress('Smoothing terrain shapes…', 0.56 + pass * 0.05);
      const k = kernels[Math.min(pass, kernels.length - 1)];
      const out = new Float32Array(height.length);
      for (let y = 0; y < GRID_H; y++) {
        for (let x = 0; x < GRID_W; x++) {
          const i = y * GRID_W + x;
          if (!land[i]) { out[i] = -1; continue; }
          let sum = height[i] * k.c;
          let weight = k.c;
          const neighbors = [
            [x - 1, y, k.axis], [x + 1, y, k.axis], [x, y - 1, k.axis], [x, y + 1, k.axis],
            [x - 1, y - 1, k.diag], [x + 1, y - 1, k.diag], [x - 1, y + 1, k.diag], [x + 1, y + 1, k.diag],
            [x - 2, y, 0.35], [x + 2, y, 0.35], [x, y - 2, 0.35], [x, y + 2, 0.35]
          ];
          for (const n of neighbors) {
            const nx = n[0], ny = n[1], w = n[2];
            if (nx < 0 || ny < 0 || nx >= GRID_W || ny >= GRID_H) continue;
            const ni = ny * GRID_W + nx;
            if (!land[ni]) continue;
            sum += height[ni] * w;
            weight += w;
          }
          out[i] = sum / weight;
        }
        if (y % 60 === 0) { setProgress('Smoothing terrain shapes…', 0.56 + pass * 0.05 + y / GRID_H * 0.04); await sleepFrame(); }
      }
      height = out;
    }
  }

  async function buildColorCanvas() {
    setProgress('Rendering stored base map…', 0.74);
    const cctx = colorCanvas.getContext('2d');
    const img = cctx.createImageData(GRID_W, GRID_H);
    const data = img.data;
    const contourStep = 110;

    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        const i = y * GRID_W + x;
        const di = i * 4;
        let col;
        if (!land[i]) {
          col = seaColor(x, y);
        } else {
          const h = height[i];
          col = terrainColor(h);
          const shade = localShade(x, y, h);
          const warm = 0.96 + 0.06 * fbm(x / 55 + 2.6, y / 55 - 3.1, 2);
          col = [
            Math.round(clamp(col[0] * shade * warm, 0, 255)),
            Math.round(clamp(col[1] * shade, 0, 255)),
            Math.round(clamp(col[2] * shade * 0.98, 0, 255))
          ];

          const band = h / contourStep;
          const frac = Math.abs(band - Math.round(band));
          const line = clamp(1 - frac * 20, 0, 1);
          if (line > 0.18) {
            const mix = line * 0.16;
            col = [
              Math.round(lerp(col[0], 58, mix)),
              Math.round(lerp(col[1], 52, mix)),
              Math.round(lerp(col[2], 46, mix))
            ];
          }
          if (isCoastPixel(x, y)) col = [74, 81, 84];
        }
        data[di] = col[0]; data[di + 1] = col[1]; data[di + 2] = col[2]; data[di + 3] = 255;
      }
      if (y % 45 === 0) { setProgress('Rendering stored base map…', 0.74 + y / GRID_H * 0.08); await sleepFrame(); }
    }
    cctx.putImageData(img, 0, 0);
  }

  async function buildBiomeCanvas() {
    setProgress('Rendering biome satellite layer…', 0.82);

    // Classify biomes and keep the raw class map intact so many biome types remain visible.
    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        const i = y * GRID_W + x;
        biomeId[i] = land[i] ? classifyBiomeAtIndex(i, x, y) : 0;
      }
      if (y % 55 === 0) { setProgress('Classifying detailed biomes…', 0.82 + y / GRID_H * 0.04); await sleepFrame(); }
    }

    const bctx = biomeCanvas.getContext('2d');
    const img = bctx.createImageData(GRID_W, GRID_H);
    const data = img.data;

    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        const i = y * GRID_W + x;
        const di = i * 4;
        let col;

        if (!land[i]) {
          col = seaColor(x, y);
        } else {
          col = smoothBiomeColorAt(x, y);
          const detailA = fbm(x / 70 + 4.1, y / 70 - 1.7, 2);
          const detailB = fbm(x / 28 - 7.3, y / 28 + 5.6, 2);
          const shade = localShade(x, y, height[i]);
          const mod = (0.93 + detailA * 0.05 + detailB * 0.025) * shade;
          col = col.map(v => Math.round(clamp(v * mod, 0, 255)));

          let boundary = 0;
          const id = biomeId[i];
          if (x > 0 && biomeId[i - 1] !== id) boundary++;
          if (x < GRID_W - 1 && biomeId[i + 1] !== id) boundary++;
          if (y > 0 && biomeId[i - GRID_W] !== id) boundary++;
          if (y < GRID_H - 1 && biomeId[i + GRID_W] !== id) boundary++;
          if (boundary > 0) {
            const edgeMix = Math.min(0.06, boundary * 0.012);
            col = [
              Math.round(lerp(col[0], 58, edgeMix)),
              Math.round(lerp(col[1], 58, edgeMix)),
              Math.round(lerp(col[2], 58, edgeMix))
            ];
          }

          if (isCoastPixel(x, y)) col = [70, 79, 82];
        }

        data[di] = col[0];
        data[di + 1] = col[1];
        data[di + 2] = col[2];
        data[di + 3] = 255;
      }
      if (y % 45 === 0) { setProgress('Rendering biome satellite layer…', 0.88 + y / GRID_H * 0.10); await sleepFrame(); }
    }

    bctx.putImageData(img, 0, 0);
  }
