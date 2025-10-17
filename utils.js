// utils.js - ZONDER imports!

/* ========== Utility helpers ========== */
export function debug(...args) {
  const debugText = document.getElementById("debugText");
  const debugEl = document.getElementById("debug");
  
  if (debugText) {
    debugText.textContent += args.join(" ") + "\n";
    debugEl && debugEl.classList.remove("hidden");
  }
  console.debug(...args);
}

export function toNumberSafe(v) {
  return (v === null || v === undefined || v === "") ? NaN : Number(v);
}

export function formatDuration(totalSeconds) {
  if (isNaN(totalSeconds)) return "n.v.t.";
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function formatPace(durationSec, distanceMeters) {
  if (!distanceMeters || distanceMeters <= 0 || isNaN(durationSec)) return "n.v.t.";
  const secsPerKm = durationSec / (distanceMeters / 1000);
  const m = Math.floor(secsPerKm / 60);
  const s = Math.round(secsPerKm % 60);
  return `${m}:${String(s).padStart(2,"0")}/km`;
}

export function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = a => a * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

export function formatDateTime(date, includeSeconds = false) {
  if (!date) return 'Onbekend';
  return date.toLocaleString('nl-NL', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: includeSeconds ? '2-digit' : undefined
  });
}

export function getSpeedColor(speed) {
  if (speed >= 30) return '#dc3545';
  if (speed >= 25) return '#fd7e14';
  if (speed >= 20) return '#ffc107';
  if (speed >= 15) return '#20c997';
  return '#6c757d';
}