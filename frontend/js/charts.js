// frontend/js/charts.js — Lightweight Canvas Charts (No External Dependencies)

const ChartColors = {
  accent: '#6366f1',
  cyan: '#06b6d4',
  green: '#10b981',
  amber: '#f59e0b',
  red: '#ef4444',
  purple: '#8b5cf6',
  blue: '#3b82f6',
  grid: 'rgba(255,255,255,0.06)',
  text: '#94a3b8',
  textMuted: '#64748b',
};

function drawLineChart(canvasId, labels, values) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = 220 * dpr;
  canvas.style.width = rect.width + 'px';
  canvas.style.height = '220px';
  ctx.scale(dpr, dpr);

  const W = rect.width, H = 220;
  const pad = { top: 20, right: 20, bottom: 36, left: 44 };
  const gW = W - pad.left - pad.right;
  const gH = H - pad.top - pad.bottom;

  ctx.clearRect(0, 0, W, H);

  if (!values.length || values.every(v => v === 0)) {
    ctx.fillStyle = ChartColors.textMuted;
    ctx.font = '13px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No data yet', W / 2, H / 2);
    return;
  }

  const maxVal = Math.max(...values, 1);
  const stepY = gH / maxVal;

  // Grid lines
  ctx.strokeStyle = ChartColors.grid;
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (gH / 4) * i;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
    ctx.fillStyle = ChartColors.textMuted;
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(Math.round(maxVal - (maxVal / 4) * i), pad.left - 8, y + 4);
  }

  // Points & line
  const points = values.map((v, i) => ({
    x: pad.left + (gW / Math.max(values.length - 1, 1)) * i,
    y: pad.top + gH - v * stepY
  }));

  // Gradient fill
  const grad = ctx.createLinearGradient(0, pad.top, 0, H - pad.bottom);
  grad.addColorStop(0, 'rgba(99, 102, 241, 0.3)');
  grad.addColorStop(1, 'rgba(99, 102, 241, 0)');

  ctx.beginPath();
  ctx.moveTo(points[0].x, H - pad.bottom);
  points.forEach(p => ctx.lineTo(p.x, p.y));
  ctx.lineTo(points[points.length - 1].x, H - pad.bottom);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Line
  ctx.beginPath();
  points.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
  ctx.strokeStyle = ChartColors.accent;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // Dots
  points.forEach(p => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = ChartColors.accent;
    ctx.fill();
    ctx.strokeStyle = '#0a0e1a';
    ctx.lineWidth = 2;
    ctx.stroke();
  });

  // X labels
  ctx.fillStyle = ChartColors.textMuted;
  ctx.font = '10px Inter, sans-serif';
  ctx.textAlign = 'center';
  labels.forEach((lbl, i) => {
    const x = pad.left + (gW / Math.max(labels.length - 1, 1)) * i;
    ctx.fillText(lbl, x, H - pad.bottom + 20);
  });
}

function drawDonutChart(canvasId, labels, values, colors) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.parentElement.getBoundingClientRect();
  const size = Math.min(rect.width, 250);
  canvas.width = rect.width * dpr;
  canvas.height = size * dpr;
  canvas.style.width = rect.width + 'px';
  canvas.style.height = size + 'px';
  ctx.scale(dpr, dpr);

  const W = rect.width, H = size;
  const cx = W * 0.35, cy = H / 2;
  const R = Math.min(cx, cy) - 20;
  const r = R * 0.6;

  ctx.clearRect(0, 0, W, H);

  const total = values.reduce((a, b) => a + b, 0);
  if (total === 0) {
    ctx.fillStyle = ChartColors.textMuted;
    ctx.font = '13px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No data yet', W / 2, H / 2);
    return;
  }

  let startAngle = -Math.PI / 2;
  values.forEach((v, i) => {
    const slice = (v / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(cx, cy, R, startAngle, startAngle + slice);
    ctx.arc(cx, cy, r, startAngle + slice, startAngle, true);
    ctx.closePath();
    ctx.fillStyle = colors[i % colors.length];
    ctx.fill();
    startAngle += slice;
  });

  // Center text
  ctx.fillStyle = ChartColors.text;
  ctx.font = 'bold 18px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(total, cx, cy + 6);

  // Legend
  const legendX = W * 0.65;
  let legendY = cy - (labels.length * 22) / 2;
  labels.forEach((lbl, i) => {
    ctx.fillStyle = colors[i % colors.length];
    ctx.fillRect(legendX, legendY, 12, 12);
    ctx.fillStyle = ChartColors.text;
    ctx.font = '11px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`${lbl} (${values[i]})`, legendX + 18, legendY + 10);
    legendY += 22;
  });
}

function drawBarChart(canvasId, labels, values, colors) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = 220 * dpr;
  canvas.style.width = rect.width + 'px';
  canvas.style.height = '220px';
  ctx.scale(dpr, dpr);

  const W = rect.width, H = 220;
  const pad = { top: 20, right: 20, bottom: 36, left: 44 };
  const gW = W - pad.left - pad.right;
  const gH = H - pad.top - pad.bottom;

  ctx.clearRect(0, 0, W, H);

  if (!values.length || values.every(v => v === 0)) {
    ctx.fillStyle = ChartColors.textMuted;
    ctx.font = '13px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No data yet', W / 2, H / 2);
    return;
  }

  const maxVal = Math.max(...values, 1);
  const barW = Math.min(gW / values.length * 0.6, 50);
  const gap = gW / values.length;

  // Grid
  ctx.strokeStyle = ChartColors.grid;
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (gH / 4) * i;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
    ctx.fillStyle = ChartColors.textMuted;
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(Math.round(maxVal - (maxVal / 4) * i), pad.left - 8, y + 4);
  }

  // Bars
  values.forEach((v, i) => {
    const barH = (v / maxVal) * gH;
    const x = pad.left + gap * i + (gap - barW) / 2;
    const y = pad.top + gH - barH;

    ctx.fillStyle = colors[i % colors.length];
    ctx.beginPath();
    ctx.roundRect(x, y, barW, barH, [4, 4, 0, 0]);
    ctx.fill();

    // Value on top
    ctx.fillStyle = ChartColors.text;
    ctx.font = 'bold 11px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(v, x + barW / 2, y - 6);

    // Label
    ctx.fillStyle = ChartColors.textMuted;
    ctx.font = '10px Inter, sans-serif';
    ctx.fillText(labels[i], x + barW / 2, H - pad.bottom + 18);
  });
}
