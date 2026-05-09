// 03_map_rendering.js
// Map symbols, settlement rendering, army rendering.
// Loaded in order by index.html. Keep the script tag order unless you fully refactor globals.

function drawStar(c, cx, cy, outer, inner, fill, stroke, lineW) {
    c.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5;
      const r = i % 2 === 0 ? outer : inner;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.closePath();
    c.fillStyle = fill;
    c.fill();
    c.strokeStyle = stroke;
    c.lineWidth = lineW;
    c.stroke();
  }
  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function drawSettlements(targetCtx, transformer, scale, labelMode = 'auto') {
    targetCtx.save();
    targetCtx.font = `${12 * dpr * scale}px Arial`;
    targetCtx.textBaseline = 'top';
    settlements.forEach(s => {
      const p = transformer(s.x, s.y);
      if (p.x < -80 || p.y < -80 || p.x > targetCtx.canvas.width + 80 || p.y > targetCtx.canvas.height + 80) return;
      if (s.type === 'capital') {
        drawStar(targetCtx, p.x, p.y, 8 * dpr * scale, 4 * dpr * scale, '#ffd84f', '#3a2e05', 1.5 * dpr * scale);
      } else if (s.type === 'fortress') {
        const r = 6.8 * dpr * scale;
        targetCtx.beginPath();
        targetCtx.moveTo(p.x, p.y - r);
        targetCtx.lineTo(p.x + r, p.y);
        targetCtx.lineTo(p.x, p.y + r);
        targetCtx.lineTo(p.x - r, p.y);
        targetCtx.closePath();
        targetCtx.fillStyle = '#8b78ff';
        targetCtx.fill();
        targetCtx.strokeStyle = '#ffffff';
        targetCtx.lineWidth = 1.8 * dpr * scale;
        targetCtx.stroke();
      } else if (s.type === 'harbor') {
        const r = 6.6 * dpr * scale;
        targetCtx.beginPath();
        targetCtx.arc(p.x, p.y, r, 0, Math.PI * 2);
        targetCtx.fillStyle = '#1f87b7';
        targetCtx.fill();
        targetCtx.strokeStyle = '#ffffff';
        targetCtx.lineWidth = 1.8 * dpr * scale;
        targetCtx.stroke();
        targetCtx.beginPath();
        targetCtx.moveTo(p.x, p.y - r * 0.72);
        targetCtx.lineTo(p.x, p.y + r * 0.55);
        targetCtx.moveTo(p.x - r * 0.55, p.y + r * 0.12);
        targetCtx.quadraticCurveTo(p.x, p.y + r * 0.82, p.x + r * 0.55, p.y + r * 0.12);
        targetCtx.strokeStyle = '#062938';
        targetCtx.lineWidth = 1.4 * dpr * scale;
        targetCtx.stroke();
      } else {
        targetCtx.beginPath();
        targetCtx.arc(p.x, p.y, 4.8 * dpr * scale, 0, Math.PI * 2);
        targetCtx.fillStyle = '#f25757';
        targetCtx.fill();
        targetCtx.strokeStyle = '#ffffff';
        targetCtx.lineWidth = 1.8 * dpr * scale;
        targetCtx.stroke();
      }
      const shouldLabel = true;
      if (shouldLabel) {
        const label = `${s.name} · ${Math.round(s.elevation)}m`;
        const tw = targetCtx.measureText(label).width;
        const bx = p.x + 10 * dpr * scale;
        const by = p.y - 10 * dpr * scale;
        targetCtx.fillStyle = 'rgba(14,19,25,0.84)';
        roundRect(targetCtx, bx, by, tw + 14 * dpr * scale, 20 * dpr * scale, 8 * dpr * scale);
        targetCtx.fill();
        targetCtx.fillStyle = '#eef4f8';
        targetCtx.fillText(label, bx + 7 * dpr * scale, by + 4 * dpr * scale);
      }
    });
    targetCtx.restore();
  }

  function drawArmies(targetCtx, transformer, scale, labelMode = 'auto') {
    targetCtx.save();
    targetCtx.font = `${12 * dpr * scale}px Arial`;
    targetCtx.textBaseline = 'top';

    armies.forEach(a => {
      if (a.route) {
        const p1 = transformer(a.x, a.y);
        const p2 = transformer(a.route.destX, a.route.destY);
        targetCtx.save();
        targetCtx.setLineDash([7 * dpr * scale, 6 * dpr * scale]);
        targetCtx.strokeStyle = 'rgba(38,55,91,0.75)';
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

      const shouldLabel = labelMode === 'all' || a.id === selectedArmyId || world.zoom > 3.0 * dpr;
      if (shouldLabel) {
        const label = a.route ? `${a.name} · S ${armyScoreLabel(a)} · ${Math.max(0, ((a.route.endTime - performance.now()) / GAME_DAY_MS)).toFixed(1)}d` : `${a.name} · S ${armyScoreLabel(a)}`;
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
  }
