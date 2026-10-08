#!/usr/bin/env node
// from [@mraxays](https://github.com/mraxays) <https://gist.github.com/mraxays/39d9f3b9a2e432280048b859fb9ceec5>
const fs = require("fs");
const path = require("path");

const SECOND_PER_DAY = 60 * 60 * 24;
const MS_PER_DAY = 1000 * SECOND_PER_DAY;

const INPUT_FILE = path.join("dist", "times.json");
const INPUT_FILE_PR_MERGE = path.join("dist", "prMergeTimes.json");
const OUTPUT_FILE = path.join("dist", "domains_and_prs.svg");
const OUTPUT_FILE_MONTHLY = path.join("dist", "monthly_stats.svg");

const WIDTH = 1600;
const HEIGHT = 900;
const FONT_SIZE = 20;
const MARGIN = { top: 40, right: 40, bottom: 110, left: 90 };
const PLOT_WIDTH = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_HEIGHT = HEIGHT - MARGIN.top - MARGIN.bottom;
const MARGIN_PERCENT = { top: 40, right: 90, bottom: 110, left: 90 };
const PLOT_WIDTH_PERCENT = WIDTH - MARGIN_PERCENT.left - MARGIN_PERCENT.right;
const PLOT_HEIGHT_PERCENT = HEIGHT - MARGIN_PERCENT.top - MARGIN_PERCENT.bottom;

const COLORS = ["#FF9800", "#009688", "#2196F3"];

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function getUtcDayMs(timeSecond) {
  return Math.floor(timeSecond / SECOND_PER_DAY) * MS_PER_DAY;
}

function convertTime(item) {
  return Number(Array.isArray(item) ? item[0] : item);
}

function msToUtcYearMonth(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`;
}

function msToUtcMonthMs(ms) {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

function nextMonthMs(ms) {
  const d = new Date(ms);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  return month == 11 ? Date.UTC(year + 1, 0, 1) : Date.UTC(year, month + 1, 1);
}

function calculateDeltaMonth(minMs, maxMs) {
  const minDate = new Date(minMs);
  const maxDate = new Date(maxMs);
  const yearDelta = maxDate.getUTCFullYear() - minDate.getUTCFullYear();
  const monthDelta = maxDate.getUTCMonth() - minDate.getUTCMonth();
  return yearDelta * 12 + monthDelta;
}

/**
 * Jan 1 / Jul 1 ticks. First tick is <= minMs, last tick is >= maxMs,
 * so there are always labels, even for short date ranges.
 */
function buildSpecialDays(minMs, maxMs) {
  const d = new Date(minMs);
  let year = d.getUTCFullYear();
  let month = d.getUTCMonth() < 6 ? 0 : 6;
  const list = [];

  while (true) {
    const t = Date.UTC(year, month, 1);
    list.push(t);
    if (t >= maxMs) break;
    if (month === 0) {
      month = 6;
    } else {
      month = 0;
      year += 1;
    }
  }
  return list;
}

function utcDayToLineData(timeData, prData, prMergeData) {
  if (!timeData.length) throw new Error("times.json contains no domain data");
  if (!prData.length) throw new Error("times.json contains no PR data");
  if (!prMergeData.length) throw new Error("times.json contains no PR merge data");

  const firstTime = getUtcDayMs(Math.abs(convertTime(timeData[0])));
  const firstPr = getUtcDayMs(Math.abs(convertTime(prData[0])));
  const firstPrMerge = getUtcDayMs(Math.abs(convertTime(prMergeData[0])));
  const lastTime = getUtcDayMs(Math.abs(convertTime(timeData[timeData.length - 1])));
  const lastPr = getUtcDayMs(Math.abs(convertTime(prData[prData.length - 1])));
  const lastPrMerge = getUtcDayMs(Math.abs(convertTime(prMergeData[prMergeData.length - 1])));

  const minDayMs = Math.min(firstTime, firstPr, firstPrMerge) - MS_PER_DAY;
  const maxDayMs = Math.max(lastTime, lastPr, lastPrMerge);
  const minMonthMs = msToUtcMonthMs(Math.min(firstTime, firstPr, firstPrMerge));
  const maxMonthMs = msToUtcMonthMs(Math.max(lastTime, lastPr, lastPrMerge));
  const totalDayCount = Math.floor((maxDayMs - minDayMs) / MS_PER_DAY) + 1;
  const totalMonthCount = calculateDeltaMonth(minMonthMs, maxMonthMs) + 1;

  const x = new Array(totalDayCount);
  for (let i = 0; i < totalDayCount; i++) x[i] = minDayMs + i * MS_PER_DAY;

  const specialDays = buildSpecialDays(minDayMs, maxDayMs);

  const dayIndex = (ms) => Math.floor((ms - minDayMs) / MS_PER_DAY);

  // ---- domains (daily delta -> cumulative) ----
  const y = new Array(totalDayCount).fill(0);
  for (const item of timeData) {
    const ts = convertTime(item);
    const delta = Array.isArray(item)
      ? Number(item[1]) * (ts > 0 ? 1 : -1)
      : (ts > 0 ? 1 : -1);
    const idx = dayIndex(getUtcDayMs(Math.abs(ts)));
    if (idx >= 0 && idx < totalDayCount) y[idx] += delta;
  }
  for (let i = 1; i < totalDayCount; i++) y[i] += y[i - 1];

  // ---- PRs ----
  const y2 = new Array(totalDayCount).fill(0);
  for (const item of prData) {
    const idx = dayIndex(getUtcDayMs(Math.abs(convertTime(item))));
    if (idx >= 0 && idx < totalDayCount) y2[idx] += 1;
  }
  for (let i = 1; i < totalDayCount; i++) y2[i] += y2[i - 1];

  // ---- PRs Merged ----
  const y3 = new Array(totalDayCount).fill(0);
  for (const item of prMergeData) {
    const idx = dayIndex(getUtcDayMs(Math.abs(convertTime(item))));
    if (idx >= 0 && idx < totalDayCount) y3[idx] += 1;
  }
  for (let i = 1; i < totalDayCount; i++) y3[i] += y3[i - 1];

  // ---- Monthly PR Merge Rate (%) ----
  const x2 = new Array(totalMonthCount);
  x2[0] = minMonthMs;
  for (let i = 1; i < totalMonthCount; i++) x2[i] = nextMonthMs(x2[i - 1]);
  const yPRMonthTotal = new Array(totalMonthCount).fill(0);
  const yPRMonthMerged = new Array(totalMonthCount).fill(0);
  for (const item of prData) {
    const idx = x2.indexOf(msToUtcMonthMs(1000 * Math.abs(convertTime(item))));
    if (idx >= 0 && idx < totalMonthCount) yPRMonthTotal[idx] += 1;
  }
  for (const item of prMergeData) {
    const idx = x2.indexOf(msToUtcMonthMs(1000 * Math.abs(convertTime(item))));
    if (idx >= 0 && idx < totalMonthCount) yPRMonthMerged[idx] += 1;
  }
  const yPRMonthMergeRate = new Array(totalMonthCount);
  for (let i = 0; i < totalMonthCount; i++) {
    if (yPRMonthTotal[i] <= 0) {
      yPRMonthMergeRate[i] = 0;
    } else {
      yPRMonthMergeRate[i] = yPRMonthMerged[i] / yPRMonthTotal[i] * 100;
    }
  }
  yPRMonthMergeRate.isPercent = true;
  // ---- Monthly Subdomain Creation ----
  const ySubdomainMonth = new Array(totalMonthCount).fill(0);
  for (const item of timeData) {
    const ts = convertTime(item);
    const delta = Array.isArray(item)
      ? Number(item[1]) * (ts > 0 ? 1 : -1)
      : (ts > 0 ? 1 : -1);
    const idx = x2.indexOf(msToUtcMonthMs(1000 * Math.abs(ts)));
    if (idx >= 0 && idx < totalDayCount && delta > 0) ySubdomainMonth[idx] += delta;
  }

  return { x, domains: y, prs: y2, prsMerge: y3, xMonth: x2, prMonthMergeRate: yPRMonthMergeRate, prMonthTotal: yPRMonthTotal, subdomainMonth: ySubdomainMonth, specialDays };
}

function formatNumber(v) {
  return String(v);
}

function niceStep(range, target = 8) {
  const raw = range / target;
  const exp = Math.floor(Math.log10(raw));
  const f = raw / Math.pow(10, exp);
  const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nf * Math.pow(10, exp);
}

function createScalesMultiple(x, valuesArray, specialDays) {
  // X axis spans the first to last tick (like matplotlib showing the edge ticks)
  const xMin = specialDays[0];
  const xMax = specialDays[specialDays.length - 1];

  // Y axis with 5% padding, like matplotlib
  const values = [].concat(...valuesArray);
  const dMin = Math.min(...values);
  const dMax = Math.max(...values, 1);
  const pad = (dMax - dMin) * 0.05 || 1;
  const yLo = dMin - pad;
  const yHi = dMax + pad;

  const step = niceStep(yHi - yLo);
  const yTicks = [];
  for (let v = Math.ceil(yLo / step) * step; v <= yHi + 1e-9; v += step) {
    yTicks.push(Math.round(v * 1e6) / 1e6);
  }

  const scaleX = (v) => MARGIN.left + ((v - xMin) / (xMax - xMin)) * PLOT_WIDTH;
  const scaleY = (v) => MARGIN.top + PLOT_HEIGHT - ((v - yLo) / (yHi - yLo)) * PLOT_HEIGHT;

  return { scaleX, scaleY, yTicks };
}

function buildAxisTicks(min, max, target = 8) {
  const pad = (max - min) * 0.05 || 1;
  const lo = min - pad;
  const hi = max + pad;
  const step = niceStep(hi - lo, target);
  const ticks = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) {
    ticks.push(Math.round(v * 1e6) / 1e6);
  }
  return { lo, hi, ticks };
}

function createScalesMultipleWithPercent(x, valuesArray, specialDays) {
  const xMin = specialDays[0];
  const xMax = specialDays[specialDays.length - 1];

  let values = [];
  for (const array of valuesArray) {
    if (!array.isPercent) {
      values = values.concat(array);
    }
  }

  const left = buildAxisTicks(
    Math.min(...values),
    Math.max(...values, 1)
  );
  const right = buildAxisTicks(
    0,
    100
  );

  const scaleX = (v) =>
    MARGIN_PERCENT.left + ((v - xMin) / (xMax - xMin)) * PLOT_WIDTH_PERCENT;

  const scaleYLeft = (v) =>
    MARGIN_PERCENT.top + PLOT_HEIGHT_PERCENT -
    ((v - left.lo) / (left.hi - left.lo)) * PLOT_HEIGHT_PERCENT;

  const scaleYRight = (v) =>
    MARGIN_PERCENT.top + PLOT_HEIGHT_PERCENT -
    ((v - right.lo) / (right.hi - right.lo)) * PLOT_HEIGHT_PERCENT;

  return {
    scaleX,
    scaleY: scaleYLeft,
    scaleYPercent: scaleYRight,
    yTicks: left.ticks,
    yTicksPercent: right.ticks
  };
}

function createLinePath(x, values, scaleX, scaleY) {
  let d = "";
  for (let i = 0; i < x.length; i++) {
    d += `${i === 0 ? "M" : " L"} ${scaleX(x[i]).toFixed(2)} ${scaleY(values[i]).toFixed(2)}`;
  }
  return d;
}

function generateSvgMultiple({ x, valuesArray, specialDays, title, labels }) {
  const { scaleX, scaleY, yTicks } = createScalesMultiple(x, valuesArray, specialDays);

  const plotLeft = MARGIN.left;
  const plotRight = WIDTH - MARGIN.right;
  const plotTop = MARGIN.top;
  const plotBottom = HEIGHT - MARGIN.bottom;

  const parts = [];
  parts.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">`
  );
  parts.push(`<title>${escapeXml(title)}</title>`);
  parts.push(`<rect width="${WIDTH}" height="${HEIGHT}" fill="white"/>`);

  // Horizontal grid + y labels
  for (const tick of yTicks) {
    const y = scaleY(tick).toFixed(2);
    parts.push(
      `<line x1="${plotLeft}" y1="${y}" x2="${plotRight}" y2="${y}" stroke="#b0b0b0" stroke-width="1"/>`
    );
    parts.push(
      `<text x="${plotLeft - 12}" y="${y}" dy="0.35em" text-anchor="end" ` +
      `font-family="sans-serif" font-size="${FONT_SIZE}">${formatNumber(tick)}</text>`
    );
  }

  // Vertical grid + rotated month labels
  for (const day of specialDays) {
    const xp = scaleX(day).toFixed(2);
    parts.push(
      `<line x1="${xp}" y1="${plotTop}" x2="${xp}" y2="${plotBottom}" stroke="#b0b0b0" stroke-width="1"/>`
    );
    const ty = plotBottom + 12;
    parts.push(
      `<text x="${xp}" y="${ty}" text-anchor="end" dominant-baseline="central" ` +
      `font-family="sans-serif" font-size="${FONT_SIZE}" ` +
      `transform="rotate(-90 ${xp} ${ty})">${escapeXml(msToUtcYearMonth(day))}</text>`
    );
  }

  // Plot border
  parts.push(
    `<rect x="${plotLeft}" y="${plotTop}" width="${PLOT_WIDTH}" height="${PLOT_HEIGHT}" fill="none" stroke="black" stroke-width="1"/>`
  );

  // Data line
  let colorIndex = 0;
  for (const values of valuesArray) {
    parts.push(
      `<path d="${createLinePath(x, values, scaleX, scaleY)}" fill="none" stroke="${COLORS[colorIndex++]}" stroke-width="2"/>`
    );
  }

  // Legend (upper left)
  colorIndex = 0;
  let lx = plotLeft + 20;
  let ly = plotTop + 28;
  for (const label of labels) {
    parts.push(`<line x1="${lx}" y1="${ly}" x2="${lx + 35}" y2="${ly}" stroke="${COLORS[colorIndex++]}" stroke-width="2"/>`);
    parts.push(
      `<text x="${lx + 45}" y="${ly}" dy="0.35em" font-family="sans-serif" font-size="${FONT_SIZE}">${escapeXml(label)}</text>`
    );
    ly += 25;
  }

  parts.push("</svg>");
  return parts.join("\n");
}

function generateSvgMultipleWithPercent({ x, valuesArray, specialDays, title, labels }) {
  const { scaleX, scaleY, yTicks, scaleXPercent, scaleYPercent, yTicksPercent } = createScalesMultipleWithPercent(x, valuesArray, specialDays);

  const plotLeft = MARGIN_PERCENT.left;
  const plotRight = WIDTH - MARGIN_PERCENT.right;
  const plotTop = MARGIN_PERCENT.top;
  const plotBottom = HEIGHT - MARGIN_PERCENT.bottom;

  const parts = [];
  parts.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">`
  );
  parts.push(`<title>${escapeXml(title)}</title>`);
  parts.push(`<rect width="${WIDTH}" height="${HEIGHT}" fill="white"/>`);

  // Horizontal grid + y labels
  for (const tick of yTicks) {
    const y = scaleY(tick).toFixed(2);
    parts.push(
      `<line x1="${plotLeft}" y1="${y}" x2="${plotRight}" y2="${y}" stroke="#b0b0b0" stroke-width="1"/>`
    );
    parts.push(
      `<text x="${plotLeft - 12}" y="${y}" dy="0.35em" text-anchor="end" ` +
      `font-family="sans-serif" font-size="${FONT_SIZE}">${formatNumber(tick)}</text>`
    );
  }
  for (const tick of yTicksPercent) {
    const y = scaleYPercent(tick).toFixed(2);
    parts.push(
      `<line x1="${plotLeft}" y1="${y}" x2="${plotRight}" y2="${y}" stroke="#b0b0b0" stroke-width="1" stroke-dasharray="10,5"/>`
    );
    parts.push(
      `<text x="${plotRight + 12}" y="${y}" dy="0.35em" text-anchor="start" ` +
      `font-family="sans-serif" font-size="${FONT_SIZE}">${formatNumber(tick) + "%"}</text>`
    );
  }

  // Vertical grid + rotated month labels
  for (const day of specialDays) {
    const xp = scaleX(day).toFixed(2);
    parts.push(
      `<line x1="${xp}" y1="${plotTop}" x2="${xp}" y2="${plotBottom}" stroke="#b0b0b0" stroke-width="1"/>`
    );
    const ty = plotBottom + 12;
    parts.push(
      `<text x="${xp}" y="${ty}" text-anchor="end" dominant-baseline="central" ` +
      `font-family="sans-serif" font-size="${FONT_SIZE}" ` +
      `transform="rotate(-90 ${xp} ${ty})">${escapeXml(msToUtcYearMonth(day))}</text>`
    );
  }

  // Plot border
  parts.push(
    `<rect x="${plotLeft}" y="${plotTop}" width="${PLOT_WIDTH_PERCENT}" height="${PLOT_HEIGHT_PERCENT}" fill="none" stroke="black" stroke-width="1"/>`
  );

  // Data line
  let colorIndex = 0;
  for (const values of valuesArray) {
    parts.push(
      `<path d="${createLinePath(x, values, scaleX, values.isPercent ? scaleYPercent : scaleY)}" fill="none" stroke="${COLORS[colorIndex++]}" stroke-width="2"/>`
    );
  }

  // Legend (upper left)
  colorIndex = 0;
  let lx = plotLeft + 20;
  let ly = plotTop + 28;
  for (const label of labels) {
    parts.push(`<line x1="${lx}" y1="${ly}" x2="${lx + 35}" y2="${ly}" stroke="${COLORS[colorIndex++]}" stroke-width="2"/>`);
    parts.push(
      `<text x="${lx + 45}" y="${ly}" dy="0.35em" font-family="sans-serif" font-size="${FONT_SIZE}">${escapeXml(label)}</text>`
    );
    ly += 25;
  }

  parts.push("</svg>");
  return parts.join("\n");
}

function main() {
  if (!fs.existsSync(INPUT_FILE)) throw new Error(`Input file not found: ${INPUT_FILE}`);
  if (!fs.existsSync(INPUT_FILE_PR_MERGE)) throw new Error(`Input file not found: ${INPUT_FILE_PR_MERGE}`);

  const raw = JSON.parse(fs.readFileSync(INPUT_FILE, "utf8"));
  const rawPrMerge = JSON.parse(fs.readFileSync(INPUT_FILE_PR_MERGE, "utf8"));
  const { x, domains, prs, prsMerge, xMonth, prMonthMergeRate, prMonthTotal, subdomainMonth, specialDays } = utcDayToLineData(raw.data || [], raw.prData || [], rawPrMerge.data || []);

  fs.writeFileSync(OUTPUT_FILE, generateSvgMultiple({ x, valuesArray: [prs, prsMerge, domains], specialDays, title: "Total Subdomains & PRs", labels: ["Total PRs Created", "Total PRs Merged", "Live Subdomains"] }), "utf8");
  console.log(`Generated ${OUTPUT_FILE}`);

  fs.writeFileSync(OUTPUT_FILE_MONTHLY, generateSvgMultipleWithPercent({ x: xMonth, valuesArray: [prMonthTotal, subdomainMonth, prMonthMergeRate], specialDays, title: "JS.ORG Monthly Stats", labels: ["Monthly PR Created", "Monthly Subdomain Added", "Monthly PR Merge Rate (%)"] }), "utf8");
  console.log(`Generated ${OUTPUT_FILE_MONTHLY}`);
}

try {
  main();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}