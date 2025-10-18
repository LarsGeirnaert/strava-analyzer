// script.js — complete versie met alle functies
// Vereist: Chart.js is geladen in index.html vóór dit script

/* ========== DOM references ========== */
const fileInput = document.getElementById("fileInput");
const analyzeBtn = document.getElementById("analyzeBtn");
const summaryContainer = document.getElementById("summaryContainer");
const summaryList = document.getElementById("summaryContainer");
const chartsContainer = document.getElementById("chartsContainer");
const fastestContainer = document.getElementById("fastestContainer");
const fastestTableBody = document.querySelector("#fastestTable tbody");
const debugEl = document.getElementById("debug");
const debugText = document.getElementById("debugText");
const savedListContainer = document.getElementById("savedList");

const sortFieldSelect = document.getElementById("sortField");
const sortOrderSelect = document.getElementById("sortOrder");

let elevationChart = null;
let speedChart = null;


/* ========== persistent state for current analysis ========== */
let currentFileBlob = null;
let currentAnalysis = null;

/* ========== IndexedDB setup ========== */
const DB_NAME = "stravaDB";
const STORE_NAME = "activities";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("byDate", "createdAt");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveActivityToDB({ fileBlob, fileName, summary }) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const id = Date.now().toString();
    const item = {
      id,
      fileName,
      fileBlob,
      summary,
      createdAt: new Date().toISOString()
    };
    const req = store.add(item);
    req.onsuccess = () => resolve(item);
    req.onerror = () => reject(req.error);
  });
}

async function updateActivityInDB(item) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(item);
    req.onsuccess = () => resolve(item);
    req.onerror = () => reject(req.error);
  });
}

async function listActivitiesFromDB() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getActivityFromDB(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function deleteActivityFromDB(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/* ========== Utility helpers ========== */
function debug(...args) {
  if (debugText) {
    debugText.textContent += args.join(" ") + "\n";
    debugEl && debugEl.classList.remove("hidden");
  }
  console.debug(...args);
}

function toNumberSafe(v) {
  return (v === null || v === undefined || v === "") ? NaN : Number(v);
}

function formatDuration(totalSeconds) {
  if (isNaN(totalSeconds)) return "n.v.t.";
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatPace(durationSec, distanceMeters) {
  if (!distanceMeters || distanceMeters <= 0 || isNaN(durationSec)) return "n.v.t.";
  const secsPerKm = durationSec / (distanceMeters / 1000);
  const m = Math.floor(secsPerKm / 60);
  const s = Math.round(secsPerKm % 60);
  return `${m}:${String(s).padStart(2,"0")}/km`;
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = a => a * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

function formatDateTime(date, includeSeconds = false) {
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

function getSpeedColor(speed) {
  if (speed >= 30) return '#dc3545';
  if (speed >= 25) return '#fd7e14';
  if (speed >= 20) return '#ffc107';
  if (speed >= 15) return '#20c997';
  return '#6c757d';
}

/* ========== Extract ride date from blob ========== */
async function extractRideDateFromBlob(blob) {
  try {
    const text = await blob.text();
    const doc = new DOMParser().parseFromString(text, "application/xml");
    const t = doc.querySelector("Time, time") || doc.querySelector("trkpt time");
    if (t && t.textContent) {
      const dt = new Date(t.textContent);
      if (!isNaN(dt)) return dt.toISOString();
    }
  } catch (err) {
    console.warn("extractRideDateFromBlob failed:", err);
  }
  return null;
}

/* ========== Parsing & analysis ========== */
async function analyzeText(text, fileBlob = null, fileName = "upload") {
    clearAllHighlights();
    summaryContainer.classList.add("hidden");
    fastestContainer && fastestContainer.classList.add("hidden");
    if (summaryList) summaryList.innerHTML = ""; // ✅ Nu bestaat summaryList
    if (fastestTableBody) fastestTableBody.innerHTML = "";
    if (debugText) debugText.textContent = "";

    currentFileBlob = fileBlob;
    currentAnalysis = null;

    const doc = new DOMParser().parseFromString(text, "application/xml");
    if (doc.querySelector("parsererror")) {
        alert("Kon XML niet parsen — is het bestand geldig?");
        debug("XML parse error", doc.querySelector("parsererror").textContent);
        return;
    }

    const xpath = "//*[local-name()='Trackpoint' or local-name()='trkpt']";
    const nodes = [];
    const iter = doc.evaluate(xpath, doc, null, XPathResult.ORDERED_NODE_ITERATOR_TYPE, null);
    let node;
    while ((node = iter.iterateNext())) nodes.push(node);

    debug(`gevonden trackpoints: ${nodes.length}`);
    if (nodes.length < 2) {
        alert("Geen voldoende trackpoints gevonden in het bestand.");
        return;
    }

    const getChildText = (el, names) => {
        for (const n of names) {
            const found = Array.from(el.childNodes).find(ch => ch.localName === n);
            if (found && found.textContent) return found.textContent;
            const q = el.querySelector(n);
            if (q && q.textContent) return q.textContent;
        }
        return null;
    };

    const trackpoints = nodes.map(tp => {
        const timeStr = getChildText(tp, ["Time", "time"]);
        const time = timeStr ? new Date(timeStr) : null;
        const altStr = getChildText(tp, ["AltitudeMeters", "ele"]);
        const altitude = altStr !== null ? toNumberSafe(altStr) : NaN;
        const distStr = getChildText(tp, ["DistanceMeters"]);
        const distance = distStr !== null ? toNumberSafe(distStr) : NaN;
        let lat = NaN, lon = NaN;
        if (tp.hasAttribute && (tp.hasAttribute("lat") || tp.hasAttribute("lon"))) {
            lat = toNumberSafe(tp.getAttribute("lat"));
            lon = toNumberSafe(tp.getAttribute("lon"));
        } else {
            const latStr = getChildText(tp, ["lat"]);
            const lonStr = getChildText(tp, ["lon"]);
            if (latStr) lat = toNumberSafe(latStr);
            if (lonStr) lon = toNumberSafe(lonStr);
        }
        return { time, altitude, distance, lat, lon };
    });

    const cumDist = new Array(trackpoints.length).fill(0);
    const hasAnyDistanceValues = trackpoints.some(tp => !isNaN(tp.distance));
    if (hasAnyDistanceValues) {
        const base = isNaN(trackpoints[0].distance) ? 0 : trackpoints[0].distance;
        for (let i = 0; i < trackpoints.length; i++) {
            const d = isNaN(trackpoints[i].distance) ? NaN : trackpoints[i].distance - base;
            cumDist[i] = isNaN(d) ? (i === 0 ? 0 : cumDist[i-1]) : d;
        }
    } else {
        let sum = 0;
        cumDist[0] = 0;
        for (let i = 1; i < trackpoints.length; i++) {
            const a = trackpoints[i-1], b = trackpoints[i];
            if (!isNaN(a.lat) && !isNaN(a.lon) && !isNaN(b.lat) && !isNaN(b.lon)) {
                sum += haversine(a.lat, a.lon, b.lat, b.lon);
            }
            cumDist[i] = sum;
        }
    }

    const totalDistance = cumDist[cumDist.length - 1];
    debug(`totalDistance (m): ${totalDistance.toFixed(2)}, hasDistanceValues: ${hasAnyDistanceValues}`);

    let elevationGain = 0, elevationLoss = 0;
    let lastAlt = isNaN(trackpoints[0].altitude) ? null : trackpoints[0].altitude;
    for (const tp of trackpoints) {
        if (isNaN(tp.altitude)) continue;
        if (lastAlt === null) { lastAlt = tp.altitude; continue; }
        const diff = tp.altitude - lastAlt;
        if (diff > 0) elevationGain += diff;
        else elevationLoss += Math.abs(diff);
        lastAlt = tp.altitude;
    }

    // ✅ VERBETERDE TIJD BEREKENING - Alleen beweegtijd
    const hasTimes = trackpoints.every(tp => tp.time instanceof Date && !isNaN(tp.time));
    let totalMovingSeconds = 0;
    let totalElapsedSeconds = NaN;
    
    if (hasTimes) {
        // Totale verstreken tijd (eerste tot laatste trackpoint)
        totalElapsedSeconds = (trackpoints[trackpoints.length-1].time - trackpoints[0].time) / 1000;
        
        // Bewegingstijd berekenen - alleen tijd wanneer er daadwerkelijk bewogen wordt
        totalMovingSeconds = calculateMovingTime(trackpoints, cumDist);
        
        debug(`Tijd berekening: ${totalMovingSeconds.toFixed(0)}s beweging, ${totalElapsedSeconds.toFixed(0)}s totaal`);
    }

    let avgSpeedKmh = NaN;
    if (!isNaN(totalDistance) && !isNaN(totalMovingSeconds) && totalMovingSeconds > 0) {
        avgSpeedKmh = (totalDistance / 1000) / (totalMovingSeconds / 3600);
    }

    const rideDate = (trackpoints[0] && trackpoints[0].time && !isNaN(trackpoints[0].time)) ? trackpoints[0].time.toISOString() : null;

        currentAnalysis = {
        fileName,
        totalDistance,
        totalSeconds: totalMovingSeconds,
        totalElapsedSeconds,
        elevationGain,
        trackpoints,
        cumDist,
        hasTimes,
        rideDate
    };

    if (summaryList) {
        summaryList.innerHTML = `
      <li>🏁 Totale afstand: <strong>${(!isNaN(totalDistance) ? (totalDistance/1000).toFixed(2) + " km" : "onbekend")}</strong></li>
      <li>⏱️ Bewegingstijd: <strong>${(!isNaN(totalMovingSeconds) ? formatDuration(totalMovingSeconds) : "onbekend")}</strong></li>
      ${!isNaN(totalElapsedSeconds) ? `<li>🕐 Totale tijd: <strong>${formatDuration(totalElapsedSeconds)}</strong></li>` : ''}
      <li>🚴 Gem. snelheid: <strong>${(!isNaN(avgSpeedKmh) ? avgSpeedKmh.toFixed(2) + " km/u" : "onbekend")}</strong></li>
      <li>⛰️ Hoogtewinst: <strong>${Math.round(elevationGain)} m</strong></li>
      <li>⬇️ Hoogteverlies: <strong>${Math.round(elevationLoss)} m</strong></li>
    `;
        summaryContainer.classList.remove("hidden");
    }

    createSaveButton();
    showElevationChart(trackpoints, cumDist);
    showSpeedChart(trackpoints, cumDist);
    showFastestSegments(trackpoints, cumDist, currentAnalysis.hasTimes);

    const chartsTabButton = document.querySelector('[data-tab="charts"]');
    if (chartsTabButton) {
        chartsTabButton.click();
    }

    debug(`Finished analysis for ${fileName}`);
    
        showAnalysis();
    
    // En zorg dat de summary tab actief is
    const summaryTab = document.querySelector('[data-tab="summary"]');
    if (summaryTab) {
        summaryTab.click();
    }
}


function calculateMovingTime(trackpoints, cumDist) {
    if (!trackpoints || trackpoints.length < 2) return 0;
    
    let movingTime = 0;
    const MIN_MOVEMENT_DISTANCE = 5; 
    const MAX_TIME_GAP = 300; 
    
    for (let i = 1; i < trackpoints.length; i++) {
        const prevPoint = trackpoints[i-1];
        const currPoint = trackpoints[i];
        
        if (!prevPoint.time || !currPoint.time) continue;
        
        const timeDiff = (currPoint.time - prevPoint.time) / 1000; 
        const distDiff = cumDist[i] - cumDist[i-1]; 
        
    
        if (timeDiff > MAX_TIME_GAP) {
            debug(`Grote tijd gap gedetecteerd: ${timeDiff.toFixed(0)}s tussen punten ${i-1} en ${i}`);
            continue;
        }
        
        if (distDiff >= MIN_MOVEMENT_DISTANCE && timeDiff > 0) {
            movingTime += timeDiff;
        }
        else if (distDiff > 0.1 && timeDiff <= 10) { // korte periode met kleine beweging
            movingTime += timeDiff;
        }
    }
    
    return movingTime;
}

function calculateMovingTimeAlternative(trackpoints, cumDist) {
    if (!trackpoints || trackpoints.length < 2) return 0;
    
    let movingTime = 0;
    const SPEED_THRESHOLD = 1.0;
    const MAX_TIME_GAP = 300; 
    
    for (let i = 1; i < trackpoints.length; i++) {
        const prevPoint = trackpoints[i-1];
        const currPoint = trackpoints[i];
        
        if (!prevPoint.time || !currPoint.time) continue;
        
        const timeDiff = (currPoint.time - prevPoint.time) / 1000;
        const distDiff = cumDist[i] - cumDist[i-1];
        
        if (timeDiff > MAX_TIME_GAP) continue;
        
        const speedKmh = timeDiff > 0 ? (distDiff / 1000) / (timeDiff / 3600) : 0;
        
        if (speedKmh >= SPEED_THRESHOLD && timeDiff > 0) {
            movingTime += timeDiff;
        }

        
    }
    
    return movingTime;
}

/* ========== UI building helpers ========== */
function createSaveButton() {
  console.log('🔧 createSaveButton wordt aangeroepen');
  
  const existing = document.getElementById("saveToDbBtn");
  if (existing) {
    console.log('🗑️ Bestaande knop verwijderd');
    existing.remove();
  }

  // Maak een duidelijke container voor de knop
  const buttonContainer = document.createElement("div");
  buttonContainer.id = "saveButtonContainer";
  buttonContainer.style.marginTop = "20px";
  buttonContainer.style.padding = "15px";
  buttonContainer.style.background = "rgba(16, 185, 129, 0.1)";
  buttonContainer.style.border = "2px solid #10b981";
  buttonContainer.style.borderRadius = "12px";
  buttonContainer.style.textAlign = "center";

  const btn = document.createElement("button");
  btn.id = "saveToDbBtn";
  btn.innerHTML = "💾 <strong>Opslaan in lokaal archief</strong>";
  btn.style.cssText = `
    background: linear-gradient(135deg, #10b981, #059669);
    color: white;
    font-weight: 600;
    padding: 15px 30px;
    border-radius: 10px;
    border: none;
    cursor: pointer;
    transition: all 0.3s ease;
    box-shadow: 0 4px 12px rgba(16, 185, 129, 0.4);
    font-size: 16px;
    width: 100%;
    display: block;
    visibility: visible !important;
    opacity: 1 !important;
    position: relative !important;
    z-index: 1000 !important;
  `;

  btn.addEventListener("mouseenter", function() {
    this.style.transform = "translateY(-2px)";
    this.style.boxShadow = "0 8px 20px rgba(16, 185, 129, 0.6)";
  });

  btn.addEventListener("mouseleave", function() {
    this.style.transform = "translateY(0)";
    this.style.boxShadow = "0 4px 12px rgba(16, 185, 129, 0.4)";
  });

  btn.addEventListener("click", async () => {
    console.log('💾 Opslaan knop geklikt');
    if (!currentFileBlob) {
      const file = fileInput.files[0];
      if (!file) {
        alert("Geen bestand beschikbaar om op te slaan.");
        return;
      }
      currentFileBlob = file;
    }
    
    const summary = {
      distanceKm: (!isNaN(currentAnalysis.totalDistance) ? (currentAnalysis.totalDistance/1000).toFixed(2) : null),
      durationSec: currentAnalysis.totalSeconds,
      elevationGain: Math.round(currentAnalysis.elevationGain),
      rideDate: currentAnalysis.rideDate
    };
    
    try {
      const existingActivities = await listActivitiesFromDB();
      const isDuplicate = await checkForDuplicateActivity(currentFileBlob, existingActivities);
      
      if (isDuplicate) {
        alert("Deze rit is al eerder opgeslagen.");
        return;
      }

      const item = await saveActivityToDB({ fileBlob: currentFileBlob, fileName: currentAnalysis.fileName, summary });
      alert("✅ Opgeslagen: " + item.fileName);
      await renderSavedList();
      
      const savedTabButton = document.querySelector('[data-tab="saved"]');
      if (savedTabButton) {
        savedTabButton.click();
      }
    } catch (err) {
      console.error('Opslaan mislukt:', err);
      alert("Opslaan mislukt: " + err.message);
    }
  });

  buttonContainer.appendChild(btn);
  
  // Probeer verschillende plaatsingen
  if (summaryContainer) {
    console.log('📍 Knop toevoegen aan summaryContainer');
    summaryContainer.appendChild(buttonContainer);
    
    // Zorg dat summaryContainer zichtbaar is
    summaryContainer.style.display = 'block';
    summaryContainer.style.visibility = 'visible';
    summaryContainer.classList.remove('hidden');
  } else {
    console.log('❌ summaryContainer niet gevonden, probeer charts tab');
    // Probeer in charts tab te plaatsen
    const chartsTab = document.getElementById('charts-tab');
    if (chartsTab) {
      chartsTab.appendChild(buttonContainer);
    }
  }
  
  console.log('✅ Opslaan knop gemaakt en geplaatst');
}

// Voeg deze functie toe ergens in je script
function debugSaveButton() {
    console.log('🔍 Debug save button...');
    
    // Check of de knop bestaat in de DOM
    const saveBtn = document.getElementById('saveToDbBtn');
    console.log('💾 Save button in DOM:', saveBtn);
    
    if (saveBtn) {
        console.log('📍 Save button parent:', saveBtn.parentElement);
        console.log('🎨 Save button styles:', window.getComputedStyle(saveBtn));
        console.log('👀 Save button visible:', saveBtn.offsetParent !== null);
        
        // Forceer zichtbaarheid
        saveBtn.style.display = 'block';
        saveBtn.style.visibility = 'visible';
        saveBtn.style.opacity = '1';
        saveBtn.style.position = 'relative';
        saveBtn.style.zIndex = '1000';
    }
}

setTimeout(debugSaveButton, 100);


async function checkForDuplicateActivity(newFileBlob, existingActivities) {
  try {
    // Lees de inhoud van het nieuwe bestand
    const newFileText = await newFileBlob.text();
    const newFileHash = await generateFileHash(newFileText);
    
    // Vergelijk met alle bestaande activiteiten
    for (const existingActivity of existingActivities) {
      const existingFileText = await existingActivity.fileBlob.text();
      const existingFileHash = await generateFileHash(existingFileText);
      
      if (newFileHash === existingFileHash) {
        console.log('Dubbele activiteit gevonden:', existingActivity.fileName);
        return true;
      }
    }
    
    return false;
  } catch (error) {
    console.error('Fout bij controle dubbele activiteit:', error);
    // Bij fout, val terug op basis van bestandsnaam en datum
    return checkForDuplicateFallback(newFileBlob, existingActivities);
  }
}

/**
 * Genereer een eenvoudige hash van bestandsinhoud voor vergelijking
 */
async function generateFileHash(text) {
  // Een eenvoudige hash functie - je kunt dit vervangen door SHA256 als je crypto API wilt gebruiken
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString();
}

/**
 * Valback methode voor dubbele detectie (op basis van metadata)
 */
async function checkForDuplicateFallback(newFileBlob, existingActivities) {
  try {
    const newFileText = await newFileBlob.text();
    const newDoc = new DOMParser().parseFromString(newFileText, "application/xml");
    
    // Haal metadata op uit het nieuwe bestand
    const newStartTime = getFirstTrackpointTime(newDoc);
    const newTotalDistance = calculateTotalDistanceFromXML(newDoc);
    
    for (const existingActivity of existingActivities) {
      const existingFileText = await existingActivity.fileBlob.text();
      const existingDoc = new DOMParser().parseFromString(existingFileText, "application/xml");
      
      const existingStartTime = getFirstTrackpointTime(existingDoc);
      const existingTotalDistance = calculateTotalDistanceFromXML(existingDoc);
      
      // Vergelijk starttijd en totale afstand
      if (newStartTime && existingStartTime && 
          newStartTime.getTime() === existingStartTime.getTime() &&
          Math.abs(newTotalDistance - existingTotalDistance) < 10) { // Binnen 10 meter
        console.log('Dubbele activiteit gevonden (fallback):', existingActivity.fileName);
        return true;
      }
    }
    
    return false;
  } catch (error) {
    console.error('Fout bij fallback duplicate check:', error);
    return false;
  }
}

/**
 * Helper functie om eerste trackpoint tijd op te halen
 */
function getFirstTrackpointTime(doc) {
  const xpath = "//*[local-name()='Trackpoint' or local-name()='trkpt']";
  const nodes = [];
  const iter = doc.evaluate(xpath, doc, null, XPathResult.ORDERED_NODE_ITERATOR_TYPE, null);
  let node;
  while ((node = iter.iterateNext())) nodes.push(node);
  
  if (nodes.length > 0) {
    const getChildText = (el, names) => {
      for (const n of names) {
        const found = Array.from(el.childNodes).find(ch => ch.localName === n);
        if (found && found.textContent) return found.textContent;
        const q = el.querySelector(n);
        if (q && q.textContent) return q.textContent;
      }
      return null;
    };
    
    const timeStr = getChildText(nodes[0], ["Time", "time"]);
    return timeStr ? new Date(timeStr) : null;
  }
  return null;
}

/**
 * Helper functie om totale afstand te berekenen vanuit XML
 */
function calculateTotalDistanceFromXML(doc) {
  const xpath = "//*[local-name()='Trackpoint' or local-name()='trkpt']";
  const nodes = [];
  const iter = doc.evaluate(xpath, doc, null, XPathResult.ORDERED_NODE_ITERATOR_TYPE, null);
  let node;
  while ((node = iter.iterateNext())) nodes.push(node);
  
  if (nodes.length < 2) return 0;
  
  const getChildText = (el, names) => {
    for (const n of names) {
      const found = Array.from(el.childNodes).find(ch => ch.localName === n);
      if (found && found.textContent) return found.textContent;
      const q = el.querySelector(n);
      if (q && q.textContent) return q.textContent;
    }
    return null;
  };
  
  // Probeer eerst DistanceMeters
  const lastNode = nodes[nodes.length - 1];
  const distStr = getChildText(lastNode, ["DistanceMeters"]);
  if (distStr) {
    return parseFloat(distStr);
  }
  
  // Anders berekenen met haversine
  const trackpoints = nodes.map(tp => {
    let lat = NaN, lon = NaN;
    if (tp.hasAttribute && (tp.hasAttribute("lat") || tp.hasAttribute("lon"))) {
      lat = parseFloat(tp.getAttribute("lat"));
      lon = parseFloat(tp.getAttribute("lon"));
    }
    return { lat, lon };
  });
  
  let totalDistance = 0;
  for (let i = 1; i < trackpoints.length; i++) {
    const a = trackpoints[i-1], b = trackpoints[i];
    if (!isNaN(a.lat) && !isNaN(a.lon) && !isNaN(b.lat) && !isNaN(b.lon)) {
      totalDistance += haversine(a.lat, a.lon, b.lat, b.lon);
    }
  }
  
  return totalDistance;
}

/* ========== Chart functions ========== */
function showElevationChart(trackpoints, cumDist) {
  if (!trackpoints || trackpoints.length < 2) return;

  const elevationValues = trackpoints.map(tp => isNaN(tp.altitude) ? null : tp.altitude);
  
  const smoothData = (arr, windowSize = 5) => {
    const result = [];
    for (let i = 0; i < arr.length; i++) {
      const start = Math.max(0, i - Math.floor(windowSize/2));
      const end = Math.min(arr.length, i + Math.floor(windowSize/2) + 1);
      const window = arr.slice(start, end).filter(v => v !== null);
      result.push(window.length ? window.reduce((a,b)=>a+b,0)/window.length : null);
    }
    return result;
  };
  const smoothedElevation = smoothData(elevationValues, 5);

  const step = Math.ceil(smoothedElevation.length / 150);
  const dsElevation = smoothedElevation.filter((_, i) => i % step === 0);
  const dsLabels = cumDist.filter((_, i) => i % step === 0).map(d => (d/1000).toFixed(2));

  const validElevations = dsElevation.filter(v => v !== null);
  const avgElevation = validElevations.length ? validElevations.reduce((a,b)=>a+b,0)/validElevations.length : null;

  const sortedElevations = validElevations.slice().sort((a,b)=>a-b);
  const yMin = sortedElevations.length ? Math.floor(sortedElevations[0] / 10) * 10 : 0;
  const yMax = sortedElevations.length ? Math.ceil(sortedElevations[Math.floor(sortedElevations.length*0.95)] / 10) * 10 : 100;

  const canvas = document.getElementById("elevationChart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (elevationChart) elevationChart.destroy();

  const bottomData = new Array(dsElevation.length).fill(yMin);

  elevationChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: dsLabels,
      datasets: [
        {
          label: "",
          data: bottomData,
          borderColor: 'transparent',
          backgroundColor: 'rgba(14, 165, 233, 0.15)',
          fill: true,
          pointRadius: 0,
          tension: 0.3,
        },
        {
          label: "Hoogte (m)",
          data: dsElevation,
          borderColor: "rgb(14, 165, 233)",
          backgroundColor: 'rgba(14, 165, 233, 0.15)',
          fill: '-1',
          tension: 0.3,
          pointRadius: 0,
        },
        ...(avgElevation ? [{
          label: `Gemiddeld (${avgElevation.toFixed(0)} m)`,
          data: new Array(dsElevation.length).fill(avgElevation),
          borderColor: 'rgba(108, 117, 125, 0.7)',
          borderWidth: 1,
          borderDash: [5, 5],
          pointRadius: 0,
          fill: false
        }] : [])
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: {
          title: { display: true, text: "Afstand (km)", font: { weight: 'bold' } },
          grid: { color: 'rgba(0,0,0,0.05)' },
          ticks: { maxTicksLimit: 10 }
        },
        y: {
          min: yMin,
          max: yMax,
          title: { display: true, text: "Hoogte (m)", font: { weight: 'bold' } },
          grid: { color: 'rgba(0,0,0,0.05)' },
          ticks: { 
            stepSize: Math.max(20, Math.ceil((yMax - yMin) / 8)),
            callback: function(value) {
              return value + ' m';
            }
          }
        }
      },
      plugins: {
        annotation: {},
        legend: { 
          display: true,
          position: 'top',
          labels: {
            filter: function(item) {
              return item.datasetIndex !== 0;
            }
          }
        },
        tooltip: {
          callbacks: {
            title: ctx => `Afstand: ${ctx[0].label} km`,
            label: ctx => {
              if (ctx.datasetIndex === 1) {
                return `Hoogte: ${ctx.parsed.y.toFixed(0)} m`;
              }
              return null;
            },
            afterLabel: ctx => {
              if (ctx.datasetIndex === 1 && avgElevation) {
                const diff = ctx.parsed.y - avgElevation;
                return `Verschil met gemiddeld: ${diff >= 0 ? '+' : ''}${diff.toFixed(0)} m`;
              }
              return null;
            }
          }
        }
      }
    }
  });

  // Zorg dat de chart beschikbaar is voor segment marking
  window.elevationChart = elevationChart;
}

function showSpeedChart(trackpoints, cumDist) {
  if (!trackpoints || trackpoints.length < 2) return;

  const speedValues = [];
  for (let i = 1; i < trackpoints.length; i++) {
    const dt = (trackpoints[i].time - trackpoints[i-1].time) / 1000;
    const dd = cumDist[i] - cumDist[i-1];
    const kmh = (dt > 0 && dd >= 0) ? (dd / 1000) / (dt / 3600) : null;
    speedValues.push(kmh);
  }

  const smoothData = (arr, windowSize = 5) => {
    const result = [];
    for (let i = 0; i < arr.length; i++) {
      const start = Math.max(0, i - Math.floor(windowSize/2));
      const end = Math.min(arr.length, i + Math.floor(windowSize/2) + 1);
      const window = arr.slice(start, end).filter(v => v !== null);
      result.push(window.length ? window.reduce((a,b)=>a+b,0)/window.length : null);
    }
    return result;
  };
  const smoothedSpeed = smoothData(speedValues, 5);

  // Downsample data voor overzicht
  const step = Math.ceil(smoothedSpeed.length / 150);
  const dsSpeed = smoothedSpeed.filter((_, i) => i % step === 0);
  const dsLabels = cumDist.slice(1).filter((_, i) => i % step === 0).map(d => (d/1000).toFixed(2));

  const validSpeeds = dsSpeed.filter(v => v !== null && v > 0 && v < 100);
  const avgSpeed = validSpeeds.length ? validSpeeds.reduce((a,b)=>a+b,0)/validSpeeds.length : null;

  const maxSpeed = validSpeeds.length ? Math.max(...validSpeeds) : 20;
  const yMax = Math.ceil(maxSpeed / 5) * 5 + 5;

  const canvas = document.getElementById("speedChart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (speedChart) speedChart.destroy();

  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, 'rgba(220, 53, 69, 0.25)');
  gradient.addColorStop(1, 'rgba(220, 53, 69, 0.05)');

  speedChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: dsLabels,
      datasets: [
        {
          label: "Snelheid (km/u)",
          data: dsSpeed,
          borderColor: "rgb(220, 53, 69)",
          backgroundColor: gradient,
          fill: true,
          tension: 0.3,
          pointRadius: 0,
        },
        ...(avgSpeed ? [{
          label: `Gemiddeld (${avgSpeed.toFixed(1)} km/u)`,
          data: new Array(dsSpeed.length).fill(avgSpeed),
          borderColor: 'rgba(108, 117, 125, 0.7)',
          borderWidth: 1,
          borderDash: [5, 5],
          pointRadius: 0,
          fill: false
        }] : [])
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: {
          title: { display: true, text: "Afstand (km)", font: { weight: 'bold' } },
          grid: { color: 'rgba(0,0,0,0.05)' },
          ticks: { maxTicksLimit: 10 }
        },
        y: {
          min: 0,
          max: yMax,
          title: { display: true, text: "Snelheid (km/u)", font: { weight: 'bold' } },
          grid: { color: 'rgba(0,0,0,0.05)' },
          ticks: { 
            stepSize: Math.ceil(yMax / 10)
          }
        }
      },
      plugins: {
        annotation: {},
        legend: { display: true, position: 'top' },
        tooltip: {
          callbacks: {
            title: ctx => `Afstand: ${ctx[0].label} km`,
            label: ctx => `Snelheid: ${ctx.parsed.y.toFixed(1)} km/u`,
            afterLabel: ctx => {
              if (ctx.datasetIndex === 0 && avgSpeed) {
                const diff = ctx.parsed.y - avgSpeed;
                return `Verschil met gemiddeld: ${diff >= 0 ? '+' : ''}${diff.toFixed(1)} km/u`;
              }
              return null;
            }
          }
        }
      }
    }
  });

  // Zorg dat de chart beschikbaar is voor segment marking
  window.speedChart = speedChart;
}

/* ========== Segment functions ========== */
function computeFastestSegments(trackpoints, cumDist, targetsMeters) {
  const n = trackpoints.length;
  const results = new Array(targetsMeters.length).fill(null);

  for (let ti = 0; ti < targetsMeters.length; ti++) {
    const target = targetsMeters[ti];
    if (cumDist[n-1] < target) { 
      results[ti] = null; 
      continue; 
    }
    
    let best = null;
    
    for (let i = 0; i < n - 1; i++) {
      const startDist = cumDist[i];
      const targetEndDist = startDist + target;
      
      // Zoek j waar cumDist[j] >= targetEndDist
      let j = i + 1;
      while (j < n && cumDist[j] < targetEndDist) {
        j++;
      }
      
      if (j >= n) break;
      
      // Interpoleer tussen j-1 en j
      const prev = j - 1;
      const distPrev = cumDist[prev];
      const distJ = cumDist[j];
      
      const ratio = (targetEndDist - distPrev) / (distJ - distPrev);
      const startTime = trackpoints[i].time;
      const timePrev = trackpoints[prev].time.getTime();
      const timeJ = trackpoints[j].time.getTime();
      const endTime = new Date(timePrev + ratio * (timeJ - timePrev));
      
      const durationSec = (endTime - startTime) / 1000;
      if (durationSec <= 0) continue;
      
      const avgKmh = (target / 1000) / (durationSec / 3600);
      
      if (!best || durationSec < best.durationSec) {
        best = {
          startIdx: i,
          endIdx: j,
          durationSec,
          distanceMeters: target,
          actualDistanceMeters: target,
          avgKmh,
          startTime,
          endTime,
          startDistance: startDist,
          endDistance: targetEndDist
        };
      }
    }
    results[ti] = best;
  }
  
  return results;
}
function showFastestSegments(trackpoints, cumDist, hasTimes) {
  if (!fastestTableBody) return;
  fastestTableBody.innerHTML = "";

  const totalDistanceKm = Math.floor(cumDist[cumDist.length-1] / 1000);
  const maxKmPossible = Math.floor(totalDistanceKm / 5) * 5;
  const maxKmLimit = Math.min(100, maxKmPossible);

  if (!hasTimes || maxKmLimit < 5) {
    fastestTableBody.innerHTML = `<tr><td colspan="5">Geen timestamps of onvoldoende afstand voor 5 km segments.</td></tr>`;
    fastestContainer && fastestContainer.classList.remove("hidden");
    return;
  }

  const targetsKm = [];
  for (let k = 5; k <= maxKmLimit; k += 5) targetsKm.push(k);
  const targetsMeters = targetsKm.map(k => k * 1000);
  const results = computeFastestSegments(trackpoints, cumDist, targetsMeters);

  // Houd bij welk segment permanent geselecteerd is
  let permanentlySelectedSegment = null;

  for (let i = 0; i < targetsKm.length; i++) {
    const km = targetsKm[i];
    const res = results[i];
    const tr = document.createElement("tr");
    tr.dataset.segmentIndex = i;
    
    if (!res) {
      tr.innerHTML = `<td>${km} km</td><td colspan="4">niet mogelijk (route te kort)</td>`;
    } else {
      const startStr = res.startTime.toISOString().replace("T"," ").split(".")[0];
      const endStr = res.endTime.toISOString().replace("T"," ").split(".")[0];
      tr.innerHTML = `
        <td>${km} km</td>
        <td>${formatDuration(res.durationSec)}</td>
        <td>${res.avgKmh.toFixed(2)} km/u</td>
        <td>${formatPace(res.durationSec, res.distanceMeters)}</td>
        <td style="white-space:nowrap">${startStr} → ${endStr}</td>
      `;
      
      // Hover effect - tijdelijk markeren (zelfde als voorheen)
      tr.addEventListener('mouseenter', () => {
        const startDistanceKm = currentAnalysis.cumDist[res.startIdx] / 1000;
        const endDistanceKm = currentAnalysis.cumDist[res.endIdx] / 1000;
        highlightSegmentInChart(startDistanceKm, endDistanceKm, km, false); // false = tijdelijk
      });
      
      tr.addEventListener('mouseleave', () => {
        // Alleen verwijderen als dit niet het permanent geselecteerde segment is
        if (permanentlySelectedSegment !== km) {
          removeTemporaryHighlight();
        }
      });
      
      // Klik voor permanente markering (zelfde als hover maar permanent)
      tr.style.cursor = 'pointer';
      tr.title = `Klik om ${km} km segment permanent te markeren`;
      // Vervang de bestaande click event listener met deze versie:
      tr.addEventListener('click', () => {
          console.log('🖱️ Segment geklikt:', km + 'km');
          
          // Verwijder eerst de vorige permanente markering
          removePermanentHighlight();
          
          // Verwijder vorige rij selectie
          document.querySelectorAll('.table-row-selected').forEach(row => {
              row.classList.remove('table-row-selected');
          });
          
          // Markeer huidige rij
          tr.classList.add('table-row-selected');
          
          const startDistanceKm = currentAnalysis.cumDist[res.startIdx] / 1000;
          const endDistanceKm = currentAnalysis.cumDist[res.endIdx] / 1000;
          
          // Markeer in grafiek als permanent segment
          highlightSegmentInChart(startDistanceKm, endDistanceKm, km, true);
          
          // Update permanent geselecteerd segment
          permanentlySelectedSegment = km;
          
          console.log('✅ Nieuw segment gemarkeerd:', km + 'km');
          showTemporaryMessage(`${km} km segment gemarkeerd`);
      });
    }
    
    fastestTableBody.appendChild(tr);
  }
  
  fastestContainer && fastestContainer.classList.remove("hidden");
}

/**
 * Verwijder segment markeringen
 */
function removeSegmentHighlight() {
    if (!window.speedChart || !window.speedChart.options) return;
    
    const chart = window.speedChart;
    
    if (chart.options.plugins && chart.options.plugins.annotation) {
        chart.options.plugins.annotation = {
            annotations: {}
        };
        chart.update();
    }
}

/**
 * Markeer een segment in de snelheidsgrafiek - verbeterde versie
 */
function highlightSegmentInChart(startDistanceKm, endDistanceKm, distanceKm, permanent = false) {
    if (!window.speedChart) {
        console.warn('Speed chart niet beschikbaar');
        return;
    }
    
    const chart = window.speedChart;
    
    // Zorg dat de annotation plugin correct is ingesteld
    if (!chart.options.plugins) {
        chart.options.plugins = {};
    }
    if (!chart.options.plugins.annotation) {
        chart.options.plugins.annotation = { annotations: {} };
    }
    
    // Voor categorische x-as moeten we de index van de labels vinden
    const labels = chart.data.labels;
    let startIndex = -1;
    let endIndex = -1;
    
    // Zoek de dichtstbijzijnde labels voor start en end
    for (let i = 0; i < labels.length; i++) {
        const labelValue = parseFloat(labels[i]);
        if (startIndex === -1 && labelValue >= startDistanceKm) {
            startIndex = i;
        }
        if (endIndex === -1 && labelValue >= endDistanceKm) {
            endIndex = i;
            break;
        }
    }
    
    // Als we geen exacte match vinden, gebruik dan de eerste en laatste
    if (startIndex === -1) startIndex = 0;
    if (endIndex === -1) endIndex = labels.length - 1;
    
    // Gebruik EXACT DEZELFDE highlight voor zowel hover als klik
    const annotationId = permanent ? 'permanentSegment' : 'temporarySegment';
    
    // Behoud bestaande annotations en voeg nieuwe toe
    const currentAnnotations = chart.options.plugins.annotation.annotations || {};
    
    chart.options.plugins.annotation.annotations = {
        ...currentAnnotations, // Behoud bestaande annotations
        [annotationId]: {
            type: 'box',
            xMin: labels[startIndex],
            xMax: labels[endIndex],
            yMin: 0,
            yMax: chart.scales.y.max,
            backgroundColor: 'rgba(255, 193, 7, 0.25)',
            borderColor: 'rgba(255, 193, 7, 0.8)',
            borderWidth: 2,
            borderDash: [5, 5],
            label: {
                display: true,
                content: `${distanceKm} km${permanent ? ' 🔒' : ''}`,
                position: 'start',
                backgroundColor: 'rgba(255, 193, 7, 0.9)',
                color: '#000',
                font: {
                    weight: 'bold',
                    size: 12
                }
            }
        }
    };
    
    chart.update();
    
    // Alleen scrollen en tab wisselen bij permanente selectie
    if (permanent) {
        const chartsTabButton = document.querySelector('[data-tab="charts"]');
        if (chartsTabButton) {
            chartsTabButton.click();
        }
        
        setTimeout(() => {
            const speedChartElement = document.getElementById("speedChart");
            if (speedChartElement) {
                speedChartElement.scrollIntoView({ 
                    behavior: 'smooth', 
                    block: 'center' 
                });
            }
        }, 300);
    }
    
    console.log(`📊 ${permanent ? 'Permanente' : 'Tijdelijke'} markering geplaatst: ${distanceKm}km`);
    console.log('🔧 Huidige annotations:', Object.keys(chart.options.plugins.annotation.annotations));
}

/**
 * Verwijder alleen tijdelijke markeringen (voor hover)
 */
function removeTemporaryHighlight() {
    if (!window.speedChart || !window.speedChart.options) return;
    
    const chart = window.speedChart;
    
    if (chart.options.plugins && chart.options.plugins.annotation) {
        // Verwijder alleen tijdelijke annotaties, behoud permanente
        const annotations = chart.options.plugins.annotation.annotations;
        
        if (annotations && annotations.temporarySegment) {
            // Maak een kopie van alle annotations behalve de tijdelijke
            const newAnnotations = { ...annotations };
            delete newAnnotations.temporarySegment;
            
            chart.options.plugins.annotation.annotations = newAnnotations;
            chart.update();
        }
    }
}

/**
 * Verwijder alle markeringen (bij nieuwe analyse)
 */
function clearAllHighlights() {
    // Verwijder rij selecties
    document.querySelectorAll('.table-row-selected').forEach(row => {
        row.classList.remove('table-row-selected');
    });
    
    // Verwijder alle annotaties van snelheidsgrafiek
    if (window.speedChart?.options?.plugins?.annotation) {
        window.speedChart.options.plugins.annotation = {
            annotations: {}
        };
        window.speedChart.update();
    }
}


/**
 * Verwijder alleen permanente markeringen (voor wanneer je op een nieuw segment klikt)
 */
function removePermanentHighlight() {
    if (!window.speedChart || !window.speedChart.options) return;
    
    const chart = window.speedChart;
    
    if (chart.options.plugins && chart.options.plugins.annotation) {
        const annotations = chart.options.plugins.annotation.annotations;
        
        if (annotations && annotations.permanentSegment) {
            console.log('🗑️ Verwijder vorige permanente markering');
            
            // Maak een kopie van alle annotations behalve de permanente
            const newAnnotations = { ...annotations };
            delete newAnnotations.permanentSegment;
            
            chart.options.plugins.annotation.annotations = newAnnotations;
            chart.update();
        }
    }
}
/**
 * Toon segment details en markeer in grafiek
 */
function showSegmentDetails(segment, distanceKm) {
    // Deze functie is niet meer nodig als we hover gebruiken
    console.log('Segment details:', segment, distanceKm);
}

function showTemporaryMessage(message) {
    const existingMessage = document.getElementById('segment-highlight-message');
    if (existingMessage) {
        existingMessage.remove();
    }
    
    const messageDiv = document.createElement('div');
    messageDiv.id = 'segment-highlight-message';
    messageDiv.innerHTML = `
        <div style="
            position: fixed;
            top: 20px;
            right: 20px;
            background: #fff3cd;
            border: 1px solid #ffeaa7;
            border-radius: 8px;
            padding: 12px 16px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
            z-index: 1000;
            animation: slideInRight 0.3s ease;
            max-width: 300px;
        ">
            <div style="display: flex; align-items: center; gap: 10px;">
                <span style="font-size: 18px;">🔍</span>
                <div>
                    <strong style="display: block; margin-bottom: 4px;">Segment Gemarkeerd</strong>
                    <span style="font-size: 14px; color: #666;">${message}</span>
                </div>
                <button onclick="this.parentElement.parentElement.remove()" 
                        style="background: none; border: none; font-size: 18px; cursor: pointer; color: #666;">
                    ×
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(messageDiv);
    
    setTimeout(() => {
        if (messageDiv.parentNode) {
            messageDiv.remove();
        }
    }, 5000);
}
function getXAxisTitle(sortBy) {
    const titles = {
        'date': 'Datum (oud → nieuw)',
        'speed': 'Ranking Positie (snelste eerst)',
        'duration': 'Tijd (snel → langzaam)'
    };
    return titles[sortBy] || 'Ranking Positie';
}

async function renderSavedList() {
    if (!savedListContainer) return;
    
    // Maak sortering altijd beschikbaar
    const sortField = document.getElementById('sortField')?.value || "rideDate";
    const sortOrder = document.getElementById('sortOrder')?.value || "desc";

    let items = [];
    try {
        items = await listActivitiesFromDB();
    } catch (err) {
        console.error("lijst ophalen mislukt:", err);
        savedListContainer.innerHTML = `
            <div class="no-saved">
                <div style="font-size: 3rem; margin-bottom: 20px; opacity: 0.5;">❌</div>
                <h4>Fout bij ophalen ritten</h4>
                <p>Er ging iets mis bij het laden van je opgeslagen ritten</p>
            </div>
        `;
        return;
    }
    
    if (!items.length) { 
        savedListContainer.innerHTML = `
            <div class="no-saved">
                <div style="font-size: 3rem; margin-bottom: 20px; opacity: 0.5;">📂</div>
                <h4>Geen ritten opgeslagen</h4>
                <p>Upload en sla ritten op om ze hier terug te vinden</p>
            </div>
        `; 
        return; 
    }

    // Sorteer items
    items.sort((a, b) => {
        let va, vb;
        if (sortField === "rideDate") {
            va = a.summary?.rideDate ? new Date(a.summary.rideDate).getTime() : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
            vb = b.summary?.rideDate ? new Date(b.summary.rideDate).getTime() : (b.createdAt ? new Date(b.createdAt).getTime() : 0);
        } else if (sortField === "createdAt") {
            va = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            vb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        } else if (sortField === "distance") {
            va = a.summary?.distanceKm ? Number(a.summary.distanceKm) : -1;
            vb = b.summary?.distanceKm ? Number(b.summary.distanceKm) : -1;
        } else if (sortField === "elevation") {
            va = a.summary?.elevationGain ? Number(a.summary.elevationGain) : -1;
            vb = b.summary?.elevationGain ? Number(b.summary.elevationGain) : -1;
        } else {
            va = 0; vb = 0;
        }
        if (va === vb) return 0;
        const dir = (sortOrder === "asc") ? 1 : -1;
        return (va < vb) ? -1 * dir : 1 * dir;
    });

    let html = `
        <div class="sort-controls">
            <span>Sorteren op:</span>
            <select id="sortField">
                <option value="rideDate" ${sortField === 'rideDate' ? 'selected' : ''}>Rit Datum</option>
                <option value="createdAt" ${sortField === 'createdAt' ? 'selected' : ''}>Toegevoegd op</option>
                <option value="distance" ${sortField === 'distance' ? 'selected' : ''}>Afstand</option>
                <option value="elevation" ${sortField === 'elevation' ? 'selected' : ''}>Hoogtemeters</option>
            </select>
            <select id="sortOrder">
                <option value="desc" ${sortOrder === 'desc' ? 'selected' : ''}>Aflopend</option>
                <option value="asc" ${sortOrder === 'asc' ? 'selected' : ''}>Oplopend</option>
            </select>
        </div>
        <div class="saved-activities">
            <ul>
    `;

    items.forEach(item => {
        const distanceTxt = item.summary?.distanceKm ? `${parseFloat(item.summary.distanceKm).toFixed(1)} km` : "? km";
        const elevTxt = (item.summary && item.summary.elevationGain !== undefined) ? `${item.summary.elevationGain} m` : "—";
        const speedTxt = item.summary?.avgSpeed ? `${item.summary.avgSpeed.toFixed(1)} km/u` : "—";
        const rideDateTxt = item.summary?.rideDate ? new Date(item.summary.rideDate).toLocaleDateString('nl-NL') : "onbekend";
        const createdDateTxt = item.createdAt ? new Date(item.createdAt).toLocaleDateString('nl-NL') : "onbekend";
        
        html += `
            <li>
                <div class="activity-info">
                    <strong>${item.fileName}</strong>
                    <div class="activity-meta">
                        <span>📏 ${distanceTxt}</span>
                        <span>⛰️ ${elevTxt}</span>
                        <span>🚀 ${speedTxt}</span>
                    </div>
                </div>
                <div class="activity-date">
                    ${sortField === 'createdAt' ? createdDateTxt : rideDateTxt}
                </div>
                <div class="activity-actions">
                    <button class="load-btn" onclick="loadSavedActivity('${item.id}')">
                        📂 Openen
                    </button>
                    <button class="download-btn" onclick="downloadSavedActivity('${item.id}')">
                        💾 Download
                    </button>
                    <button class="delete-btn" onclick="deleteSavedActivity('${item.id}')">
                        🗑️ Verwijder
                    </button>
                </div>
            </li>
        `;
    });

    html += `
            </ul>
        </div>
    `;

    savedListContainer.innerHTML = html;

    // Voeg event listeners toe
    document.getElementById('sortField').addEventListener('change', () => renderSavedList());
    document.getElementById('sortOrder').addEventListener('change', () => renderSavedList());
}

async function loadSavedActivity(id) {
    const activity = await getActivityFromDB(id);
    const text = await activity.fileBlob.text();
    await analyzeText(text, activity.fileBlob, activity.fileName);
}

function downloadSavedActivity(id) {
    getActivityFromDB(id).then(activity => {
        const url = URL.createObjectURL(activity.fileBlob);
        const a = document.createElement("a"); 
        a.href = url; 
        a.download = activity.fileName; 
        a.click();
        URL.revokeObjectURL(url);
    });
}

async function deleteSavedActivity(id) {
    if (confirm(`Weet je zeker dat je deze rit wilt verwijderen?`)) {
        await deleteActivityFromDB(id);
        await renderSavedList();
    }
}


/* ========== Statistics functions ========== */
async function updateStatistics() {
  const items = await listActivitiesFromDB();
  
  if (items.length === 0) {
    document.getElementById('totalDistance').textContent = '0 km';
    document.getElementById('totalElevation').textContent = '0 m';
    document.getElementById('totalRides').textContent = '0';
    document.getElementById('avgDistance').textContent = '0 km';
    document.getElementById('longestRides').innerHTML = '<p>Geen ritten opgeslagen</p>';
    return;
  }
  
  const totalDistance = items.reduce((sum, item) => {
    return sum + (item.summary?.distanceKm ? parseFloat(item.summary.distanceKm) : 0);
  }, 0);
  
  const totalElevation = items.reduce((sum, item) => {
    return sum + (item.summary?.elevationGain || 0);
  }, 0);
  
  const avgDistance = totalDistance / items.length;
  
  document.getElementById('totalDistance').textContent = `${totalDistance.toFixed(1)} km`;
  document.getElementById('totalElevation').textContent = `${totalElevation} m`;
  document.getElementById('totalRides').textContent = items.length;
  document.getElementById('avgDistance').textContent = `${avgDistance.toFixed(1)} km`;
  
  updateLongestRidesList(items);
}

function updateLongestRidesList(items) {
  const longestRidesContainer = document.getElementById('longestRides');
  const sortedByDistance = items
    .filter(item => item.summary?.distanceKm)
    .sort((a, b) => parseFloat(b.summary.distanceKm) - parseFloat(a.summary.distanceKm))
    .slice(0, 5);
  
  if (sortedByDistance.length === 0) {
    longestRidesContainer.innerHTML = '<p>Geen ritten met afstandgegevens</p>';
    return;
  }
  
  longestRidesContainer.innerHTML = sortedByDistance.map(item => `
    <div class="ride-item">
      <div>
        <strong>${item.fileName}</strong><br>
        <span>${item.summary.distanceKm} km • ${item.summary.elevationGain || 0} m</span>
      </div>
      <span>${item.summary.rideDate ? new Date(item.summary.rideDate).toLocaleDateString('nl-NL') : 'Onbekend'}</span>
    </div>
  `).join('');
}

/* ========== Tab management ========== */
function initTabs() {
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');
    
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const tabId = button.getAttribute('data-tab');
            
            tabButtons.forEach(btn => btn.classList.remove('active'));
            tabContents.forEach(content => content.classList.remove('active'));
            
            button.classList.add('active');
            document.getElementById(`${tabId}-tab`).classList.add('active');
            
            if (tabId === 'charts' && currentAnalysis) {
                setTimeout(() => {
                    showElevationChart(currentAnalysis.trackpoints, currentAnalysis.cumDist);
                    showSpeedChart(currentAnalysis.trackpoints, currentAnalysis.cumDist);
                }, 100);
            }
            
            if (tabId === 'stats') {
                updateStatistics();
            }
            
            if (tabId === 'rankings') {
                // Zorg dat rangschikking direct op datum staat
                const chartSortBy = document.getElementById('chartSortBy');
                if (chartSortBy && chartSortBy.value !== 'date') {
                    chartSortBy.value = 'date';
                }
                initRankings();
            }
            
            if (tabId === 'saved') {
                renderSavedList();
            }
        });
    });
    
    // Zorg dat rangschikking tab correct geïnitialiseerd is bij pagina load
    const activeTab = document.querySelector('.tab-button.active');
    if (activeTab && activeTab.getAttribute('data-tab') === 'rankings') {
        const chartSortBy = document.getElementById('chartSortBy');
        if (chartSortBy) {
            chartSortBy.value = 'date';
        }
        initRankings();
    }
}


/* ========== Event handlers ========== */
analyzeBtn.addEventListener("click", async () => {
    const file = fileInput.files[0];
    if (!file) { 
        alert("Kies eerst een TCX of GPX bestand."); 
        return; 
    }
    
    try {
        console.log('📁 Bestand geselecteerd:', file.name);
        const text = await file.text();
        console.log('📊 Start analyse...');
        await analyzeText(text, file, file.name);
    } catch (error) {
        console.error('❌ Fout bij analyseren:', error);
        alert("Fout bij analyseren: " + error.message);
    }
});



if (sortFieldSelect) sortFieldSelect.addEventListener("change", () => renderSavedList());
if (sortOrderSelect) sortOrderSelect.addEventListener("change", () => renderSavedList());

/* ========== RANKINGS STATE ========== */
let allSegmentsCache = null;
let rankingsChart = null;

/* ========== MSE FUNCTIES ========== */
/**
 * Bereken MSE (Mean Squared Error) voor snelheid bij ranking
 */
function calculateSpeedMSE(segments) {
    if (!segments || segments.length === 0) return 0;
    
    const speeds = segments.map(segment => segment.avgKmh);
    const meanSpeed = speeds.reduce((sum, speed) => sum + speed, 0) / speeds.length;
    
    const squaredErrors = speeds.map(speed => Math.pow(speed - meanSpeed, 2));
    const mse = squaredErrors.reduce((sum, error) => sum + error, 0) / squaredErrors.length;
    
    return mse;
}

/**
 * Bereken variantie voor snelheid bij ranking
 */
function calculateSpeedVariance(segments) {
    if (!segments || segments.length === 0) return 0;
    
    const speeds = segments.map(segment => segment.avgKmh);
    const meanSpeed = speeds.reduce((sum, speed) => sum + speed, 0) / speeds.length;
    
    const variance = speeds.reduce((sum, speed) => sum + Math.pow(speed - meanSpeed, 2), 0) / speeds.length;
    
    return variance;
}

/**
 * Bereken standaardafwijking voor snelheid bij ranking
 */
function calculateSpeedStandardDeviation(segments) {
    return Math.sqrt(calculateSpeedVariance(segments));
}

/**
 * Update de rankings statistieken met MSE en variantie
 */
function updateRankingsStatsWithMSE(segments, distance) {
    const statsContainer = document.querySelector('.rankings-stats');
    if (!statsContainer) return;
    
    const mse = calculateSpeedMSE(segments);
    const variance = calculateSpeedVariance(segments);
    const stdDev = calculateSpeedStandardDeviation(segments);
    const averageSpeed = calculateAverageSpeed(segments);
    
    // Voeg MSE statistieken toe aan bestaande stats
    const mseStats = document.createElement('div');
    mseStats.className = 'mse-stats-grid';
    mseStats.innerHTML = `
        <div class="ranking-stat-card">
            <div class="ranking-stat-value">${mse.toFixed(2)}</div>
            <div class="ranking-stat-label">MSE Snelheid</div>
        </div>
        <div class="ranking-stat-card">
            <div class="ranking-stat-value">${variance.toFixed(2)}</div>
            <div class="ranking-stat-label">Variantie</div>
        </div>
        <div class="ranking-stat-card">
            <div class="ranking-stat-value">${stdDev.toFixed(2)}</div>
            <div class="ranking-stat-label">Standaardafwijking</div>
        </div>
        <div class="ranking-stat-card">
            <div class="ranking-stat-value">${((stdDev / averageSpeed) * 100).toFixed(1)}%</div>
            <div class="ranking-stat-label">Coëfficiënt van Variatie</div>
        </div>
    `;
    
    statsContainer.appendChild(mseStats);
}

function calculateLinearRegression(segments, sortBy = 'date') {
    if (!segments || segments.length === 0) return null;
    
    const n = segments.length;
    
    // Gebruik altijd datum voor x-waarden, ongeacht de huidige sortering
    const dates = segments.map(segment => 
        segment.rideDate ? new Date(segment.rideDate).getTime() : 0
    );
    
    // Filter segments met geldige datums
    const validSegments = [];
    const validDates = [];
    const validSpeeds = [];
    
    for (let i = 0; i < n; i++) {
        if (dates[i] > 0) { // Alleen segments met geldige datums
            validSegments.push(segments[i]);
            validDates.push(dates[i]);
            validSpeeds.push(segments[i].avgKmh);
        }
    }
    
    if (validSegments.length < 2) return null;
    
    const validN = validSegments.length;
    
    // Sorteer op datum (oud naar nieuw) voor regressie
    const sortedIndices = validDates.map((_, index) => index)
        .sort((a, b) => validDates[a] - validDates[b]);
    
    const sortedDates = sortedIndices.map(i => validDates[i]);
    const sortedSpeeds = sortedIndices.map(i => validSpeeds[i]);
    
    // Normaliseer datums naar dagen sinds oudste datum
    const minDate = Math.min(...sortedDates);
    const xValues = sortedDates.map(date => (date - minDate) / (1000 * 60 * 60 * 24)); // dagen
    
    const yValues = sortedSpeeds;
    
    // Bereken gemiddelden
    const xMean = xValues.reduce((a, b) => a + b, 0) / validN;
    const yMean = yValues.reduce((a, b) => a + b, 0) / validN;
    
    // Bereken helling (a) en intercept (b)
    let numerator = 0;
    let denominator = 0;
    
    for (let i = 0; i < validN; i++) {
        numerator += (xValues[i] - xMean) * (yValues[i] - yMean);
        denominator += Math.pow(xValues[i] - xMean, 2);
    }
    
    const a = denominator !== 0 ? numerator / denominator : 0;
    const b = yMean - a * xMean;
    
    // Bereken R²
    let ssTotal = 0;
    let ssResidual = 0;
    
    for (let i = 0; i < validN; i++) {
        const yPred = a * xValues[i] + b;
        ssTotal += Math.pow(yValues[i] - yMean, 2);
        ssResidual += Math.pow(yValues[i] - yPred, 2);
    }
    
    const rSquared = ssTotal !== 0 ? 1 - (ssResidual / ssTotal) : 0;
    
    // Formatteer vergelijking
    const equation = `y = ${a.toFixed(3)}·dagen + ${b.toFixed(1)}`;
    
    return {
        slope: a,
        intercept: b,
        rSquared: rSquared,
        equation: equation,
        xValues: xValues,
        minDate: minDate,
        validSegments: validSegments,
        sortedIndices: sortedIndices
    };
}
function calculateRegressionMSE(segments, regression) {
    if (!segments || !regression) return 0;
    
    const n = segments.length;
    let sumSquaredErrors = 0;
    
    for (let i = 0; i < n; i++) {
        const x = i + 1; // Ranking positie
        const yActual = segments[i].avgKmh;
        const yPredicted = regression.slope * x + regression.intercept;
        sumSquaredErrors += Math.pow(yActual - yPredicted, 2);
    }
    
    return sumSquaredErrors / n;
}

function createRankingsChart(segments, distance) {
    const ctx = document.getElementById('rankingsChart')?.getContext('2d');
    if (!ctx) return;

    // Vernietig bestaande chart
    if (rankingsChart && typeof rankingsChart.destroy === 'function') {
        rankingsChart.destroy();
    }

    const topLimit = parseInt(document.getElementById('chartTopLimit')?.value || '50');
    const sortBy = document.getElementById('chartSortBy')?.value || 'speed';
    
    // ALTIJD sorteren op snelheid (snelste eerst) voor de echte ranking
    let displaySegments = [...segments].sort((a, b) => b.avgKmh - a.avgKmh);
    
    // Bereken lineaire regressie
    const regression = calculateLinearRegression(displaySegments);
    
    // Pas daarna extra sortering toe voor weergave (maar behoud de echte ranking kleuren)
    if (sortBy === 'date') {
        displaySegments.sort((a, b) => {
            const dateA = a.rideDate ? new Date(a.rideDate) : new Date(0);
            const dateB = b.rideDate ? new Date(b.rideDate) : new Date(0);
            return dateA - dateB;
        });
    } else if (sortBy === 'duration') {
        displaySegments.sort((a, b) => a.durationSec - b.durationSec);
    }
    // Voor 'speed' sortering, gebruik de al gesorteerde lijst
    
    // Beperk aantal weergave
    if (topLimit > 0) {
        displaySegments = displaySegments.slice(0, topLimit);
    }

    if (displaySegments.length === 0) {
        console.warn('Geen segmenten om weer te geven in de grafiek');
        return;
    }

    // Bepaal labels op basis van sortering
    let labels = [];
    if (sortBy === 'date') {
        labels = displaySegments.map(segment => {
            return segment.rideDate ? 
                new Date(segment.rideDate).toLocaleDateString('nl-NL') : 'Onbekend';
        });
    } else if (sortBy === 'speed') {
        labels = displaySegments.map((segment, index) => {
            const speedSorted = [...segments].sort((a, b) => b.avgKmh - a.avgKmh);
            const actualRank = speedSorted.findIndex(s => s.activityId === segment.activityId) + 1;
            return `#${actualRank}`;
        });
    } else if (sortBy === 'duration') {
        labels = displaySegments.map(segment => formatDuration(segment.durationSec));
    }
    
    const speeds = displaySegments.map(segment => segment.avgKmh);
    const averageSpeed = calculateAverageSpeed(displaySegments);
    
    // Bepaal kleuren op basis van ECHTE snelheidsranking (niet weergave ranking)
    const backgroundColors = displaySegments.map((segment) => {
        const speedSorted = [...segments].sort((a, b) => b.avgKmh - a.avgKmh);
        const actualRank = speedSorted.findIndex(s => s.activityId === segment.activityId) + 1;
        
        if (actualRank === 1) return '#10b981';
        if (actualRank === 2) return '#22c55e';  
        if (actualRank === 3) return '#16a34a';
        if (actualRank <= 10) return '#2563eb';
        if (actualRank <= 20) return '#3b82f6';
        return '#60a5fa';
    });

    rankingsChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: `Snelheid (km/u) - ${distance}km`,
                    data: speeds,
                    backgroundColor: backgroundColors,
                    borderColor: backgroundColors.map(color => {
                        if (color === '#10b981') return '#059669';
                        if (color === '#22c55e') return '#16a34a';
                        if (color === '#16a34a') return '#15803d';
                        if (color === '#2563eb') return '#1d4ed8';
                        if (color === '#3b82f6') return '#2563eb';
                        return '#3b82f6';
                    }),
                    borderWidth: 2,
                    borderRadius: 6,
                    borderSkipped: false,
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        title: (tooltipItems) => {
                            const index = tooltipItems[0].dataIndex;
                            const segment = displaySegments[index];
                            const speedSorted = [...segments].sort((a, b) => b.avgKmh - a.avgKmh);
                            const actualRank = speedSorted.findIndex(s => s.activityId === segment.activityId) + 1;
                            
                            let rankText = '';
                            if (actualRank === 1) rankText = '🥇 1e plaats';
                            else if (actualRank === 2) rankText = '🥈 2e plaats';
                            else if (actualRank === 3) rankText = '🥉 3e plaats';
                            else rankText = `#${actualRank}`;
                            
                            return `${rankText} - ${segment.fileName}`;
                        },
                        label: (context) => {
                            const segment = displaySegments[context.dataIndex];
                            return [
                                `Snelheid: ${segment.avgKmh?.toFixed(1)} km/u`,
                                `Tijd: ${formatDuration(segment.durationSec)}`,
                                `Datum: ${segment.rideDate ? new Date(segment.rideDate).toLocaleDateString('nl-NL') : 'Onbekend'}`
                            ];
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: false,
                    title: {
                        display: true,
                        text: 'Snelheid (km/u)',
                        font: {
                            size: 13,
                            weight: 'bold'
                        }
                    },
                    grid: {
                        color: 'rgba(0,0,0,0.05)'
                    },
                    min: Math.max(0, Math.min(...speeds) - 2),
                    ticks: {
                        font: {
                            size: 11
                        }
                    }
                },
                x: {
                    title: {
                        display: true,
                        text: getXAxisTitle(sortBy),
                        font: {
                            size: 13,
                            weight: 'bold'
                        }
                    },
                    grid: {
                        display: false
                    },
                    ticks: {
                        font: {
                            size: sortBy === 'date' ? 10 : 11,
                            maxRotation: sortBy === 'date' ? 45 : 0
                        }
                    }
                }
            },
            interaction: {
                intersect: false,
                mode: 'index'
            },
            animation: {
                duration: 1000,
                easing: 'easeOutQuart'
            }
        }
    });
}

function addMSEToRankingDetails(segments, sortBy = 'date') { // DEFAULT NU 'date'
    const regression = calculateLinearRegression(segments, sortBy);
    
    if (!regression) {
        console.log('Geen geldige regressie mogelijk (te weinig datums)');
        return;
    }
    
    const regressionMSE = calculateRegressionMSE(segments, regression);
    const averageMSE = calculateSpeedMSE(segments);
    const averageSpeed = calculateAverageSpeed(segments);
    
    const analysisContainer = document.createElement('div');
    analysisContainer.className = 'mse-analysis';
    analysisContainer.innerHTML = `
        <div class="mse-stats">
            <h5>📈 Trendanalyse (Op Datum)</h5>
            <div class="mse-grid">
                <div class="mse-stat">
                    <span class="mse-label">Trendvergelijking:</span>
                    <span class="mse-value">${regression.equation}</span>
                </div>
                <div class="mse-stat">
                    <span class="mse-label">R² (verklaarde variantie):</span>
                    <span class="mse-value">${regression.rSquared.toFixed(4)}</span>
                </div>
                <div class="mse-stat">
                    <span class="mse-label">Helling (km/u per dag):</span>
                    <span class="mse-value">${regression.slope.toFixed(4)}</span>
                </div>
                <div class="mse-stat">
                    <span class="mse-label">Startpunt (oudste rit):</span>
                    <span class="mse-value">${regression.intercept.toFixed(1)} km/u</span>
                </div>
            </div>
            <div class="mse-explanation">
                <p><strong>Interpretatie:</strong> De trendlijn laat zien hoe je snelheid zich ontwikkelt over tijd.</p>
                <p>${regression.slope > 0 ? 
                    `📈 <strong>Positieve trend (+${regression.slope.toFixed(3)} km/u per dag)</strong> - Je snelheid verbetert over tijd!` : 
                    regression.slope < 0 ? 
                    `📉 <strong>Negatieve trend (${regression.slope.toFixed(3)} km/u per dag)</strong> - Je snelheid neemt af over tijd.` :
                    `➡️ <strong>Stabiele trend</strong> - Je snelheid blijft constant over tijd.`
                }</p>
                <p>R² = ${regression.rSquared.toFixed(3)} betekent dat ${(regression.rSquared * 100).toFixed(1)}% 
                van de snelheidsverschillen verklaard wordt door het tijdsverloop.</p>
            </div>
        </div>
    `;
    
    const resultsContainer = document.getElementById('rankingsResults');
    if (resultsContainer) {
        const existingMSE = resultsContainer.querySelector('.mse-analysis');
        if (existingMSE) {
            existingMSE.remove();
        }
        resultsContainer.insertBefore(analysisContainer, resultsContainer.querySelector('.rankings-stats'));
    }
}

function getSortByLabel(sortBy) {
    const labels = {
        'speed': 'Snelheid',
        'date': 'Datum', 
        'duration': 'Tijd'
    };
    return labels[sortBy] || 'Snelheid';
}

/**
 * Update chart met MSE informatie in tooltips
 */
function updateChartWithMSEInfo(segments) {
    if (!rankingsChart) return;
    
    const mse = calculateSpeedMSE(segments);
    const stdDev = calculateSpeedStandardDeviation(segments);
    const meanSpeed = calculateAverageSpeed(segments);
    
    // Update chart options om MSE info toe te voegen aan tooltips
    rankingsChart.options.plugins.tooltip.callbacks.afterLabel = (context) => {
        if (context.datasetIndex === 0) {
            const segment = segments[context.dataIndex];
            if (segment) {
                const zScore = (segment.avgKmh - meanSpeed) / stdDev;
                return [
                    `MSE: ${mse.toFixed(2)}`,
                    `Standaardafwijking: ${stdDev.toFixed(2)}`,
                    `Z-score: ${zScore.toFixed(2)}`
                ];
            }
        }
        return '';
    };
    
    rankingsChart.update();
}

/**
 * Bereken Z-score voor een specifieke snelheid
 */
function calculateZScore(speed, segments) {
    const meanSpeed = calculateAverageSpeed(segments);
    const stdDev = calculateSpeedStandardDeviation(segments);
    return (speed - meanSpeed) / stdDev;
}

/* ========== RANKINGS FUNCTIES ========== */
async function calculateAllSegments() {
    const activities = await listActivitiesFromDB();
    console.log(`📊 Rangschikking: ${activities.length} ritten gevonden`);
    
    // Maak object voor alle 5km stappen van 5 tot 100km
    const allSegments = {};
    for (let km = 5; km <= 100; km += 5) {
        allSegments[km.toString()] = [];
    }

    let processedCount = 0;
    let errorCount = 0;

    for (const activity of activities) {
        try {
            console.log(`🔍 Verwerken: ${activity.fileName}`);
            
            // Gebruik de opgeslagen afstand in plaats van opnieuw te berekenen
            const storedDistanceKm = activity.summary?.distanceKm ? parseFloat(activity.summary.distanceKm) : null;
            const totalDistanceMeters = storedDistanceKm ? storedDistanceKm * 1000 : 0;
            
            console.log(`📏 ${activity.fileName}: ${storedDistanceKm || 'onbekend'} km (opgeslagen)`);

            if (!storedDistanceKm || totalDistanceMeters < 5000) {
                console.log(`➖ ${activity.fileName}: te kort voor segmenten (${storedDistanceKm || 'onbekend'} km)`);
                continue;
            }

            const text = await activity.fileBlob.text();
            const doc = new DOMParser().parseFromString(text, "application/xml");
            
            if (doc.querySelector("parsererror")) {
                console.warn(`❌ XML parse fout: ${activity.fileName}`);
                errorCount++;
                continue;
            }

            // Parse trackpoints
            const xpath = "//*[local-name()='Trackpoint' or local-name()='trkpt']";
            const nodes = [];
            const iter = doc.evaluate(xpath, doc, null, XPathResult.ORDERED_NODE_ITERATOR_TYPE, null);
            let node;
            while ((node = iter.iterateNext())) nodes.push(node);

            console.log(`📍 ${activity.fileName}: ${nodes.length} trackpoints`);

            if (nodes.length < 2) {
                console.warn(`⚠️ Te weinig trackpoints: ${activity.fileName}`);
                continue;
            }

            const getChildText = (el, names) => {
                for (const n of names) {
                    const found = Array.from(el.childNodes).find(ch => ch.localName === n);
                    if (found && found.textContent) return found.textContent;
                    const q = el.querySelector(n);
                    if (q && q.textContent) return q.textContent;
                }
                return null;
            };

            const trackpoints = nodes.map(tp => {
                const timeStr = getChildText(tp, ["Time", "time"]);
                const time = timeStr ? new Date(timeStr) : null;
                
                const distStr = getChildText(tp, ["DistanceMeters"]);
                const distance = distStr !== null ? toNumberSafe(distStr) : NaN;
                
                let lat = NaN, lon = NaN;
                if (tp.hasAttribute && (tp.hasAttribute("lat") || tp.hasAttribute("lon"))) {
                    lat = toNumberSafe(tp.getAttribute("lat"));
                    lon = toNumberSafe(tp.getAttribute("lon"));
                }
                return { time, distance, lat, lon };
            });

            // Controleer of er tijden zijn
            const hasTimes = trackpoints.every(tp => tp.time instanceof Date && !isNaN(tp.time));
            if (!hasTimes) {
                console.warn(`⏰ Geen timestamps: ${activity.fileName}`);
                continue;
            }

            // Bereken cumulatieve afstand
            const cumDist = new Array(trackpoints.length).fill(0);
            const hasDistanceValues = trackpoints.some(tp => !isNaN(tp.distance));
            
            if (hasDistanceValues) {
                const base = isNaN(trackpoints[0].distance) ? 0 : trackpoints[0].distance;
                for (let i = 0; i < trackpoints.length; i++) {
                    const d = isNaN(trackpoints[i].distance) ? NaN : trackpoints[i].distance - base;
                    cumDist[i] = isNaN(d) ? (i === 0 ? 0 : cumDist[i-1]) : d;
                }
                console.log(`📐 ${activity.fileName}: gebruikt DistanceMeters uit bestand`);
            } else {
                for (let i = 1; i < trackpoints.length; i++) {
                    const a = trackpoints[i-1], b = trackpoints[i];
                    if (!isNaN(a.lat) && !isNaN(a.lon) && !isNaN(b.lat) && !isNaN(b.lon)) {
                        cumDist[i] = cumDist[i-1] + haversine(a.lat, a.lon, b.lat, b.lon);
                    } else {
                        cumDist[i] = cumDist[i-1];
                    }
                }
                console.log(`📐 ${activity.fileName}: gebruikt GPS coordinaten voor afstand`);
            }

            const calculatedTotalDistance = cumDist[cumDist.length - 1];
            console.log(`📏 ${activity.fileName}: ${(calculatedTotalDistance / 1000).toFixed(2)} km (berekend)`);

            // Bereken segmenten voor alle 5km stappen tot 100km
            let segmentCount = 0;
            const maxDistance = Math.min(100, Math.floor(storedDistanceKm / 5) * 5); // Max 100km of afgerond op 5km

            for (let km = 5; km <= maxDistance; km += 5) {
                const targetMeters = km * 1000;
                
                // Gebruik de opgeslagen afstand als primaire check
                if (totalDistanceMeters < targetMeters) {
                    continue; // Stil overslaan, niet loggen
                }

                // Secundaire check met berekende afstand
                if (calculatedTotalDistance < targetMeters) {
                    continue; // Stil overslaan, niet loggen
                }

                const segments = computeFastestSegments(trackpoints, cumDist, [targetMeters]);
                
                if (segments[0]) {
                    allSegments[km.toString()].push({
                        activityId: activity.id,
                        fileName: activity.fileName,
                        rideDate: activity.summary?.rideDate,
                        segment: segments[0],
                        durationSec: segments[0].durationSec,
                        avgKmh: segments[0].avgKmh,
                        storedDistance: storedDistanceKm,
                        calculatedDistance: calculatedTotalDistance / 1000
                    });
                    segmentCount++;
                    console.log(`✅ ${activity.fileName}: ${km}km segment gevonden (${segments[0].avgKmh.toFixed(1)} km/u)`);
                }
            }

            processedCount++;
            console.log(`✓ ${activity.fileName}: ${segmentCount} segmenten gevonden`);

        } catch (error) {
            console.error(`💥 Fout bij verwerken ${activity.fileName}:`, error);
            errorCount++;
        }
    }

    // Sorteer segmenten per afstand en toon samenvatting
    let totalSegments = 0;
    let availableDistances = [];
    
    for (const dist in allSegments) {
        allSegments[dist].sort((a, b) => a.durationSec - b.durationSec);
        totalSegments += allSegments[dist].length;
        if (allSegments[dist].length > 0) {
            availableDistances.push(`${dist}km`);
            console.log(`🏆 ${dist}km: ${allSegments[dist].length} segmenten`);
        }
    }

    console.log(`📈 Rangschikking samenvatting: ${processedCount} ritten verwerkt, ${errorCount} fouten, ${totalSegments} segmenten totaal`);
    console.log(`🎯 Beschikbare afstanden: ${availableDistances.join(', ')}`);

    allSegmentsCache = allSegments;
    return allSegments;
}

async function showRankings(distance) {
    const resultsContainer = document.getElementById('rankingsResults');
    
    resultsContainer.innerHTML = `
        <div class="no-rankings">
            <div style="font-size: 3rem; margin-bottom: 20px; opacity: 0.5;">🔍</div>
            <h4>Ranglijsten worden berekend...</h4>
            <p>Even geduld, dit kan even duren bij veel ritten</p>
        </div>
    `;

    try {
        if (!allSegmentsCache) {
            console.log('🔄 Cache leeg, bereken alle segmenten...');
            await calculateAllSegments();
        }

        const segments = allSegmentsCache[distance];
        
        if (!segments || segments.length === 0) {
            resultsContainer.innerHTML = `
                <div class="no-rankings">
                    <p>❌ Geen ${distance} km segmenten gevonden</p>
                    <p><small>Mogelijke oorzaken:</small></p>
                    <ul style="text-align: left; margin: 10px 0; padding-left: 20px;">
                        <li>Ritten hebben onvoldoende afstand (minimaal ${distance} km nodig)</li>
                        <li>Geen GPS/tijd data in bestanden</li>
                        <li>Probleem met bestandsformaat</li>
                    </ul>
                    <p><small>Open browser console voor gedetailleerde logs</small></p>
                </div>
            `;
            return;
        }

        // Haal de huidige sortering op (standaard is 'date')
        const sortBy = document.getElementById('chartSortBy')?.value || 'date';
        
        // Toon rangschikking met grafiek
        let html = `
            <div class="rankings-chart-container">
                <div class="rankings-chart-header">
                    <h4>📊 Snelheidsverdeling - ${distance} km Segmenten</h4>
                    <div class="rankings-chart-filters">
                        <label>Toon top:</label>
                        <select id="chartTopLimit">
                            <option value="10">Top 10</option>
                            <option value="20">Top 20</option>
                            <option value="50" selected>Top 50</option>
                            <option value="100">Top 100</option>
                            <option value="0">Alle</option>
                        </select>
                        <label>Sorteer op:</label>
                        <select id="chartSortBy">
                            <option value="date" ${sortBy === 'date' ? 'selected' : ''}>Datum</option>
                            <option value="speed" ${sortBy === 'speed' ? 'selected' : ''}>Snelheid</option>
                            <option value="duration" ${sortBy === 'duration' ? 'selected' : ''}>Tijd</option>
                        </select>
                    </div>
                </div>
                <div class="rankings-chart-wrapper">
                    <canvas id="rankingsChart"></canvas>
                </div>
                <div class="rankings-legend">
                    <div class="legend-item">
                        <div class="legend-color" style="background: #3b82f6;"></div>
                        <span>Snelheid (km/u)</span>
                    </div>
                    ${sortBy === 'date' ? `
                    <div class="legend-item">
                        <div class="legend-color" style="background: #dc2626;"></div>
                        <span>Trendlijn</span>
                    </div>
                    ` : ''}
                    <div class="legend-item">
                        <div class="legend-color" style="background: #f59e0b;"></div>
                        <span>Gemiddeld</span>
                    </div>
                </div>
            </div>

            <div class="rankings-stats">
                <div class="ranking-stat-card">
                    <div class="ranking-stat-value">${segments.length}</div>
                    <div class="ranking-stat-label">Totaal Segmenten</div>
                </div>
                <div class="ranking-stat-card">
                    <div class="ranking-stat-value">${calculateAverageSpeed(segments).toFixed(1)}</div>
                    <div class="ranking-stat-label">Gem. Snelheid</div>
                </div>
                <div class="ranking-stat-card">
                    <div class="ranking-stat-value">${segments[0]?.avgKmh?.toFixed(1) || '0'}</div>
                    <div class="ranking-stat-label">Beste Snelheid</div>
                </div>
                <div class="ranking-stat-card">
                    <div class="ranking-stat-value">${calculateSpeedRange(segments)}</div>
                    <div class="ranking-stat-label">Snelheid Range</div>
                </div>
            </div>

            <div style="margin: 25px 0; padding: 15px; background: var(--success-color); color: white; border-radius: 8px; text-align: center;">
                ✅ ${segments.length} ${distance} km segmenten gevonden - Toont ${sortBy === 'date' ? 'op datum (oud → nieuw)' : sortBy === 'speed' ? 'op snelheid' : 'op tijd'}
            </div>
        `;

        // Voeg MSE analyse toe (alleen voor datum-sortering)
        if (sortBy === 'date') {
            const regression = calculateLinearRegression(segments, 'date');
            if (regression) {
                html += `
                    <div class="mse-analysis">
                        <div class="mse-stats">
                            <h5>📈 Trendanalyse (Op Datum)</h5>
                            <div class="mse-grid">
                                <div class="mse-stat">
                                    <span class="mse-label">Trendvergelijking:</span>
                                    <span class="mse-value">${regression.equation}</span>
                                </div>
                                <div class="mse-stat">
                                    <span class="mse-label">R² (verklaarde variantie):</span>
                                    <span class="mse-value">${regression.rSquared.toFixed(4)}</span>
                                </div>
                                <div class="mse-stat">
                                    <span class="mse-label">Helling (km/u per dag):</span>
                                    <span class="mse-value">${regression.slope.toFixed(4)}</span>
                                </div>
                                <div class="mse-stat">
                                    <span class="mse-label">Startpunt (oudste rit):</span>
                                    <span class="mse-value">${regression.intercept.toFixed(1)} km/u</span>
                                </div>
                            </div>
                            <div class="mse-explanation">
                                <p><strong>Interpretatie:</strong> De trendlijn laat zien hoe je snelheid zich ontwikkelt over tijd.</p>
                                <p>${regression.slope > 0 ? 
                                    `📈 <strong>Positieve trend (+${regression.slope.toFixed(3)} km/u per dag)</strong> - Je snelheid verbetert over tijd!` : 
                                    regression.slope < 0 ? 
                                    `📉 <strong>Negatieve trend (${regression.slope.toFixed(3)} km/u per dag)</strong> - Je snelheid neemt af over tijd.` :
                                    `➡️ <strong>Stabiele trend</strong> - Je snelheid blijft constant over tijd.`
                                }</p>
                                <p>R² = ${regression.rSquared.toFixed(3)} betekent dat ${(regression.rSquared * 100).toFixed(1)}% 
                                van de snelheidsverschillen verklaard wordt door het tijdsverloop.</p>
                            </div>
                        </div>
                    </div>
                `;
            }
        }

        // Voeg de tabel toe
        html += `
            <table class="ranking-table">
                <thead>
                    <tr>
                        <th style="width: 60px">#</th>
                        <th>Rit</th>
                        <th style="width: 100px">Snelheid</th>
                        <th style="width: 120px">Tijd</th>
                        <th style="width: 100px">Datum</th>
                        <th style="width: 120px">Acties</th>
                    </tr>
                </thead>
                <tbody>
        `;

        // Sorteer segments voor de tabel weergave
        let tableSegments = [...segments];
        if (sortBy === 'date') {
            tableSegments.sort((a, b) => {
                const dateA = a.rideDate ? new Date(a.rideDate) : new Date(0);
                const dateB = b.rideDate ? new Date(b.rideDate) : new Date(0);
                return dateA - dateB; // Oudste eerst
            });
        } else if (sortBy === 'speed') {
            tableSegments.sort((a, b) => b.avgKmh - a.avgKmh);
        } else if (sortBy === 'duration') {
            tableSegments.sort((a, b) => a.durationSec - b.durationSec);
        }

        tableSegments.slice(0, 50).forEach((segment, index) => {
            const rank = index + 1;
            const dateStr = segment.rideDate ? 
                new Date(segment.rideDate).toLocaleDateString('nl-NL') : 'Onbekend';
            
            const performanceClass = getPerformanceClass(segment.avgKmh, segments);
            
            html += `
                <tr class="rank-${rank <= 3 ? rank : ''}">
                    <td>
                        <div class="rank-badge">${rank}</div>
                    </td>
                    <td>
                        <div class="file-name">${segment.fileName}</div>
                    </td>
                    <td>
                        <span class="speed-value">${segment.avgKmh?.toFixed(1) || '0'} km/u</span>
                        <span class="performance-badge ${performanceClass}">${getPerformanceLabel(segment.avgKmh, segments)}</span>
                    </td>
                    <td>
                        <span class="duration-value">${formatDuration(segment.durationSec)}</span>
                    </td>
                    <td>
                        <span class="ride-date">${dateStr}</span>
                    </td>
                    <td>
                        <div class="ranking-actions">
                            <button onclick="loadRankingActivity('${segment.activityId}')" title="Rit openen">
                                📂
                            </button>
                            <button onclick="highlightRankingSegment('${segment.activityId}', ${distance})" title="Segment markeren">
                                🔍
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        });

        html += `
                </tbody>
            </table>
            <div style="margin-top: 15px; text-align: center; color: var(--text-secondary); font-size: 0.9rem;">
                Toont ${Math.min(tableSegments.length, 50)} van ${tableSegments.length} segmenten - gesorteerd op ${sortBy === 'date' ? 'datum (oud → nieuw)' : sortBy === 'speed' ? 'snelheid' : 'tijd'}
            </div>
        `;

        resultsContainer.innerHTML = html;

        // Maak de chart aan
        setTimeout(() => {
            createRankingsChart(segments, distance);
        }, 100);

        // Voeg event listeners toe voor filters
        const topLimitSelect = document.getElementById('chartTopLimit');
        const sortBySelect = document.getElementById('chartSortBy');
        
        if (topLimitSelect) {
            topLimitSelect.addEventListener('change', () => updateRankingsChart(segments, distance));
        }
        if (sortBySelect) {
            sortBySelect.addEventListener('change', () => updateRankingsChart(segments, distance));
        }

    } catch (error) {
        console.error('💥 Fout bij tonen rangschikking:', error);
        resultsContainer.innerHTML = `
            <div class="no-rankings">
                <p>❌ Fout bij berekenen rangschikking</p>
                <p><small>${error.message}</small></p>
                <p><small>Open browser console voor details</small></p>
            </div>
        `;
    }
}

function createRankingsChart(segments, distance) {
    const ctx = document.getElementById('rankingsChart')?.getContext('2d');
    if (!ctx) return;

    // Vernietig bestaande chart
    if (rankingsChart && typeof rankingsChart.destroy === 'function') {
        rankingsChart.destroy();
    }

    const topLimit = parseInt(document.getElementById('chartTopLimit')?.value || '50');
    const sortBy = document.getElementById('chartSortBy')?.value || 'speed';
    
    let displaySegments = [...segments];
    
    // Sorteer altijd eerst op snelheid voor de echte ranking
    displaySegments.sort((a, b) => b.avgKmh - a.avgKmh);
    
    // Bereken lineaire regressie
    const regression = calculateLinearRegression(displaySegments);
    const regressionMSE = calculateRegressionMSE(displaySegments, regression);
    
    // Pas daarna extra sortering toe voor weergave
    if (sortBy === 'date') {
        displaySegments.sort((a, b) => {
            const dateA = a.rideDate ? new Date(a.rideDate) : new Date(0);
            const dateB = b.rideDate ? new Date(b.rideDate) : new Date(0);
            return dateA - dateB;
        });
    } else if (sortBy === 'duration') {
        displaySegments.sort((a, b) => a.durationSec - b.durationSec);
    }
    
    // Beperk aantal weergave
    if (topLimit > 0) {
        displaySegments = displaySegments.slice(0, topLimit);
    }

    if (displaySegments.length === 0) {
        console.warn('Geen segmenten om weer te geven in de grafiek');
        return;
    }

    const labels = displaySegments.map((segment, index) => {
        const speedSorted = [...segments].sort((a, b) => b.avgKmh - a.avgKmh);
        const actualRank = speedSorted.findIndex(s => s.activityId === segment.activityId) + 1;
        return `#${actualRank}`;
    });
    
    const speeds = displaySegments.map(segment => segment.avgKmh);
    const averageSpeed = calculateAverageSpeed(displaySegments);
    
    // Bereken regressielijn punten voor bar chart (gebruik x-as labels als positie)
    const regressionData = labels.map((_, index) => {
        const x = index + 1;
        return regression.slope * x + regression.intercept;
    });

    // Bepaal kleuren op basis van ECHTE ranking
    const backgroundColors = displaySegments.map((segment) => {
        const speedSorted = [...segments].sort((a, b) => b.avgKmh - a.avgKmh);
        const actualRank = speedSorted.findIndex(s => s.activityId === segment.activityId) + 1;
        
        if (actualRank === 1) return '#10b981';
        if (actualRank === 2) return '#22c55e';  
        if (actualRank === 3) return '#16a34a';
        return '#2563eb';
    });

    rankingsChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: `Snelheid (km/u) - ${distance}km`,
                    data: speeds,
                    backgroundColor: backgroundColors,
                    borderColor: backgroundColors.map(color => {
                        if (color === '#10b981') return '#059669';
                        if (color === '#22c55e') return '#16a34a';
                        if (color === '#16a34a') return '#15803d';
                        return '#1d4ed8';
                    }),
                    borderWidth: 2,
                    borderRadius: 6,
                    borderSkipped: false,
                },
                {
                    label: `Regressielijn: ${regression.equation}`,
                    data: regressionData,
                    type: 'line',
                    borderColor: '#dc2626',
                    backgroundColor: 'rgba(220, 38, 38, 0.1)',
                    borderWidth: 3,
                    pointRadius: 0,
                    fill: false,
                    tension: 0,
                    order: 1
                },
                {
                    label: `Gemiddelde (${averageSpeed.toFixed(1)} km/u)`,
                    data: new Array(displaySegments.length).fill(averageSpeed),
                    type: 'line',
                    borderColor: '#f59e0b',
                    backgroundColor: 'rgba(245, 158, 11, 0.1)',
                    borderWidth: 2,
                    borderDash: [5, 5],
                    pointRadius: 0,
                    fill: false,
                    tension: 0,
                    order: 2
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: {
                        usePointStyle: true,
                        padding: 20,
                        font: {
                            size: 12
                        }
                    }
                },
                tooltip: {
                    callbacks: {
                        title: (tooltipItems) => {
                            const index = tooltipItems[0].dataIndex;
                            const segment = displaySegments[index];
                            const speedSorted = [...segments].sort((a, b) => b.avgKmh - a.avgKmh);
                            const actualRank = speedSorted.findIndex(s => s.activityId === segment.activityId) + 1;
                            
                            let rankText = '';
                            if (actualRank === 1) rankText = '🥇 1e plaats';
                            else if (actualRank === 2) rankText = '🥈 2e plaats';
                            else if (actualRank === 3) rankText = '🥉 3e plaats';
                            else rankText = `#${actualRank}`;
                            
                            return `${rankText} - ${segment.fileName}`;
                        },
                        label: (context) => {
                            if (context.datasetIndex === 0) {
                                const segment = displaySegments[context.dataIndex];
                                const yPredicted = regressionData[context.dataIndex];
                                const error = segment.avgKmh - yPredicted;
                                const squaredError = Math.pow(error, 2);
                                
                                return [
                                    `Snelheid: ${segment.avgKmh?.toFixed(1)} km/u`,
                                    `Voorspeld: ${yPredicted.toFixed(1)} km/u`,
                                    `Fout: ${error >= 0 ? '+' : ''}${error.toFixed(1)} km/u`,
                                    `Kwadratische fout: ${squaredError.toFixed(2)}`
                                ];
                            } else if (context.datasetIndex === 1) {
                                return `Regressie: ${context.parsed.y.toFixed(1)} km/u`;
                            } else if (context.datasetIndex === 2) {
                                return `Gemiddelde: ${averageSpeed.toFixed(1)} km/u`;
                            }
                            return '';
                        },
                        afterLabel: (context) => {
                            if (context.datasetIndex === 0) {
                                return [
                                    `MSE regressie: ${regressionMSE.toFixed(2)}`,
                                    `R²: ${regression.rSquared.toFixed(3)}`
                                ];
                            }
                            return '';
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: false,
                    title: {
                        display: true,
                        text: 'Snelheid (km/u)',
                        font: {
                            size: 13,
                            weight: 'bold'
                        }
                    },
                    grid: {
                        color: 'rgba(0,0,0,0.05)'
                    },
                    min: Math.max(0, Math.min(...speeds) - 2),
                    ticks: {
                        font: {
                            size: 11
                        }
                    }
                },
                x: {
                    title: {
                        display: true,
                        text: 'Ranking Positie',
                        font: {
                            size: 13,
                            weight: 'bold'
                        }
                    },
                    grid: {
                        display: false
                    },
                    ticks: {
                        font: {
                            size: 11
                        }
                    }
                }
            },
            interaction: {
                intersect: false,
                mode: 'index'
            },
            animation: {
                duration: 1000,
                easing: 'easeOutQuart'
            }
        }
    });
}

function updateRankingsChart(segments, distance) {
    const sortBy = document.getElementById('chartSortBy')?.value || 'speed';
    createRankingsChart(segments, distance);
    addMSEToRankingDetails(segments, sortBy);
}

function calculateAverageSpeed(segments) {
    if (!segments.length) return 0;
    const total = segments.reduce((sum, segment) => sum + segment.avgKmh, 0);
    return total / segments.length;
}

function calculateSpeedRange(segments) {
    if (!segments.length) return '0-0';
    const min = Math.min(...segments.map(s => s.avgKmh));
    const max = Math.max(...segments.map(s => s.avgKmh));
    return `${min.toFixed(1)}-${max.toFixed(1)}`;
}

function getPerformanceClass(speed, segments) {
    const maxSpeed = Math.max(...segments.map(s => s.avgKmh));
    const percentage = (speed / maxSpeed) * 100;
    
    if (percentage >= 90) return 'performance-excellent';
    if (percentage >= 75) return 'performance-good';
    return 'performance-average';
}

function getPerformanceLabel(speed, segments) {
    const maxSpeed = Math.max(...segments.map(s => s.avgKmh));
    const percentage = (speed / maxSpeed) * 100;
    
    if (percentage >= 90) return 'Excellent';
    if (percentage >= 75) return 'Goed';
    return 'Gemiddeld';
}

async function loadRankingActivity(activityId) {
    const activity = await getActivityFromDB(activityId);
    const text = await activity.fileBlob.text();
    await analyzeText(text, activity.fileBlob, activity.fileName);
    
    const chartsTab = document.querySelector('[data-tab="charts"]');
    if (chartsTab) chartsTab.click();
}

async function highlightRankingSegment(activityId, distance) {
    const activity = await getActivityFromDB(activityId);
    const text = await activity.fileBlob.text();
    await analyzeText(text, activity.fileBlob, activity.fileName);
    
    setTimeout(() => {
        const targetMeters = distance * 1000;
        const segments = computeFastestSegments(currentAnalysis.trackpoints, currentAnalysis.cumDist, [targetMeters]);
        
        if (segments[0]) {
            const startDistanceKm = currentAnalysis.cumDist[segments[0].startIdx] / 1000;
            const endDistanceKm = currentAnalysis.cumDist[segments[0].endIdx] / 1000;
            highlightSegmentInChart(startDistanceKm, endDistanceKm, distance, true);
            
            // Markeer ook de rij in de tabel
            document.querySelectorAll('.table-row-selected').forEach(row => {
                row.classList.remove('table-row-selected');
            });
            
            const fastestTableBody = document.querySelector('#fastestTableBody');
            if (fastestTableBody) {
                const rows = fastestTableBody.querySelectorAll('tr');
                for (const row of rows) {
                    if (row.textContent.includes(`${distance} km`)) {
                        row.classList.add('table-row-selected');
                        break;
                    }
                }
            }
            
            showTemporaryMessage(`${distance} km segment gemarkeerd (${segments[0].avgKmh.toFixed(1)} km/u)`);
        }
    }, 500);
    
    const chartsTab = document.querySelector('[data-tab="charts"]');
    if (chartsTab) chartsTab.click();
}

function initRankings() {
    const rankingsDistance = document.getElementById('rankingsDistance');
    const refreshRankings = document.getElementById('refreshRankings');
    const chartSortBy = document.getElementById('chartSortBy');
    
    // Zet datum als default waarde in de dropdown
    if (chartSortBy) {
        chartSortBy.value = 'date';
    }
    
    if (rankingsDistance && refreshRankings) {
        // Laad direct met datum sortering
        showRankings('5');
        
        rankingsDistance.addEventListener('change', (e) => {
            showRankings(e.target.value);
        });
        
        refreshRankings.addEventListener('click', async () => {
            allSegmentsCache = null;
            await calculateAllSegments();
            showRankings(rankingsDistance.value);
        });
    }
}

/* ========== Initialize ========== */
window.addEventListener('load', async () => {
    console.log('🚀 Initialiseer applicatie...');
    
    // Initialize tabs
    initTabs();
    
    // Load quick stats
    await updateQuickStats();
    
    // Show dashboard by default
    showDashboard();
    
    console.log('✅ Applicatie klaar');
});


/**
 * Debug functie om huidige annotations te tonen
 */
function debugAnnotations() {
    if (!window.speedChart || !window.speedChart.options) {
        console.log('❌ Geen speed chart gevonden');
        return;
    }
    
    const chart = window.speedChart;
    const annotations = chart.options.plugins?.annotation?.annotations;
    
    console.log('🔍 Huidige annotations:', annotations ? Object.keys(annotations) : 'geen');
    
    if (annotations) {
        for (const key in annotations) {
            console.log(`📌 ${key}:`, annotations[key].xMin, '-', annotations[key].xMax);
        }
    }
}

// Voeg CSS animatie toe
if (!document.querySelector('#segment-highlight-style')) {
    const style = document.createElement('style');
    style.id = 'segment-highlight-style';
    style.textContent = `
        @keyframes slideInRight {
            from {
                transform: translateX(100%);
                opacity: 0;
            }
            to {
                transform: translateX(0);
                opacity: 1;
            }
        }
        
        /* MSE Styles */
        .mse-analysis {
            background: var(--card-background);
            border-radius: 12px;
            padding: 20px;
            margin: 20px 0;
            border: 2px solid var(--border-color);
            box-shadow: var(--shadow);
        }
        
        .mse-analysis h5 {
            margin: 0 0 15px 0;
            color: var(--text-primary);
            font-size: 1.1rem;
            text-align: center;
        }
        
        .mse-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 12px;
        }
        
        .mse-stat {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px;
            background: var(--background-color);
            border-radius: 8px;
            border-left: 4px solid var(--primary-color);
        }
        
        .mse-label {
            font-weight: 600;
            color: var(--text-secondary);
            font-size: 0.9rem;
        }
        
        .mse-value {
            font-weight: 700;
            color: var(--text-primary);
            font-family: 'Courier New', monospace;
        }
        
        .mse-stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin-top: 20px;
        }
        
        @media (max-width: 768px) {
            .mse-grid {
                grid-template-columns: 1fr;
            }
            
            .mse-stat {
                flex-direction: column;
                align-items: flex-start;
                gap: 5px;
            }
            
            .mse-stats-grid {
                grid-template-columns: 1fr;
            }
        }
    `;
    document.head.appendChild(style);
}

console.log('✅ MSE functionaliteit voor snelheid ranking toegevoegd');


/* ========== COMPARISON STATE ========== */
let comparisonActivities = [];
let comparisonChart1 = null;
let comparisonChart2 = null;
let comparisonChart3 = null;
let maxComparisons = 5;
let currentComparisonCount = 2;
let currentSelections = {};

function createSearchableSelect(selectId, label) {
    const selectContainer = document.createElement('div');
    selectContainer.className = 'searchable-select-container';
    selectContainer.innerHTML = `
        <div class="select-header">
            <label class="select-label">${label}</label>
            <div class="search-box">
                <input type="text" placeholder="Typ om te zoeken... (Enter voor alle resultaten)" class="search-input" 
                       data-for="${selectId}">
                <span class="search-icon">🔍</span>
            </div>
        </div>
        <select id="${selectId}" class="comparison-select searchable-select">
            <option value="">-- Selecteer een rit --</option>
        </select>
        <div class="select-info" id="${selectId}-info">
            <div class="info-placeholder">
                <span class="info-icon">💡</span>
                <span>Kies een rit om details te zien</span>
            </div>
        </div>
    `;
    
    return selectContainer;
}

function formatActivityDisplay(activity) {
    const summary = activity.summary || {};
    const distance = summary.distanceKm ? `${parseFloat(summary.distanceKm).toFixed(1)} km` : '? km';
    const elevation = summary.elevationGain ? `${summary.elevationGain} m` : '? m';
    const date = summary.rideDate ? 
        new Date(summary.rideDate).toLocaleDateString('nl-NL') : 'onbekende datum';
    
    const fileName = activity.fileName.length > 25 ? 
        activity.fileName.substring(0, 25) + '...' : activity.fileName;
    
    return `${fileName} • ${distance} • ${elevation} • ${date}`;
}

async function populateComparisonSelects() {
    const selectIds = ['comparisonSelect1', 'comparisonSelect2', 'comparisonSelect3', 'comparisonSelect4', 'comparisonSelect5'];
    const labels = ['Rit 1', 'Rit 2', 'Rit 3', 'Rit 4', 'Rit 5'];
    
    const comparisonSelectGroup = document.querySelector('.comparison-select-group');
    if (!comparisonSelectGroup) return;
    
    try {
        const activities = await listActivitiesFromDB();
        comparisonActivities = activities;
        
        comparisonSelectGroup.innerHTML = '';
        for (let i = 0; i < currentComparisonCount; i++) {
            const selectContainer = createSearchableSelect(selectIds[i], labels[i]);
            comparisonSelectGroup.appendChild(selectContainer);
        }
        
        selectIds.forEach(id => {
            const select = document.getElementById(id);
            if (!select) return;
            
            select.innerHTML = '<option value="">-- Selecteer een rit --</option>';
            
            const otherSelectedValues = {};
            selectIds.forEach(otherId => {
                if (otherId !== id && currentSelections[otherId]) {
                    otherSelectedValues[otherId] = currentSelections[otherId];
                }
            });
            
            let availableCount = 0;
            activities.forEach(activity => {
                let isSelectedInOther = false;
                
                for (const otherSelectId in otherSelectedValues) {
                    if (otherSelectedValues[otherSelectId] === activity.id) {
                        isSelectedInOther = true;
                        break;
                    }
                }
                
                if (!isSelectedInOther) {
                    const displayText = formatActivityDisplay(activity);
                    const option = new Option(displayText, activity.id);
                    option.setAttribute('data-search-text', 
                        `${activity.fileName} ${activity.summary?.distanceKm || ''} ${activity.summary?.elevationGain || ''}`.toLowerCase()
                    );
                    select.add(option);
                    availableCount++;
                }
            });
            
            if (currentSelections[id] && Array.from(select.options).some(opt => opt.value === currentSelections[id])) {
                select.value = currentSelections[id];
            }
            
            const placeholder = select.options[0];
            if (availableCount === 0) {
                placeholder.text = '-- Geen ritten beschikbaar --';
            } else {
                placeholder.text = `-- Kies uit ${availableCount} rit${availableCount !== 1 ? 'ten' : ''} --`;
            }
            
            updateSelectInfo(id, select.value, activities);
        });
        
        setupSearchFunctionality();
        setupComparisonSelectListeners();
        
    } catch (error) {
        console.error('Fout bij laden vergelijkingsdata:', error);
    }
}

function setupSearchFunctionality() {
    document.querySelectorAll('.search-input').forEach(input => {
        const newInput = input.cloneNode(true);
        input.parentNode.replaceChild(newInput, input);
    });
    
    document.querySelectorAll('.search-input').forEach(input => {
        const selectId = input.getAttribute('data-for');
        let currentSearchTerm = '';
        
        input.addEventListener('input', function(e) {
            currentSearchTerm = e.target.value.toLowerCase().trim();
            performSearch(selectId, currentSearchTerm, false);
        });
        
        // Enter-toets voor uitgebreide zoekresultaten
        input.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && currentSearchTerm.length > 0) {
                e.preventDefault();
                showSearchResultsOverlay(selectId, currentSearchTerm);
            }
            
            if (e.key === 'Escape') {
                if (document.getElementById('searchResultsOverlay').style.display === 'flex') {
                    closeSearchResults();
                } else {
                    e.target.value = '';
                    currentSearchTerm = '';
                    performSearch(selectId, '', false);
                }
            }
        });
        
        // Animation bij focus
        input.addEventListener('focus', function() {
            this.parentElement.style.transform = 'scale(1.02)';
        });
        
        input.addEventListener('blur', function() {
            this.parentElement.style.transform = 'scale(1)';
        });
    });
    
    // Close overlay bij klik buiten of op close button
    document.addEventListener('click', function(e) {
        if (e.target.id === 'searchResultsOverlay' || e.target.classList.contains('close-results')) {
            closeSearchResults();
        }
    });
    
    // Escape-toets om overlay te sluiten
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && document.getElementById('searchResultsOverlay').style.display === 'flex') {
            closeSearchResults();
        }
    });
}

function performSearch(selectId, searchTerm, showAll = false) {
    const select = document.getElementById(selectId);
    if (!select) return;
    
    let visibleCount = 0;
    let hasExactMatch = false;
    const matchingOptions = [];
    
    Array.from(select.options).forEach(option => {
        if (option.value === '') {
            option.style.display = '';
            return;
        }
        
        const searchText = option.getAttribute('data-search-text') || option.text.toLowerCase();
        const matches = searchText.includes(searchTerm) || showAll;
        
        if (matches) {
            option.style.display = '';
            visibleCount++;
            
            if (searchText === searchTerm) {
                hasExactMatch = true;
                option.style.fontWeight = 'bold';
                option.style.background = 'rgba(37, 99, 235, 0.1)';
            } else {
                option.style.fontWeight = '';
                option.style.background = '';
            }
            
            matchingOptions.push({
                element: option,
                text: searchText,
                exactMatch: searchText === searchTerm
            });
        } else {
            option.style.display = 'none';
            option.style.fontWeight = '';
            option.style.background = '';
        }
    });
    
    const placeholder = select.options[0];
    if (searchTerm && visibleCount === 0) {
        placeholder.text = '❌ Geen ritten gevonden';
        placeholder.style.color = '#dc2626';
    } else if (searchTerm) {
        placeholder.text = `🔍 ${visibleCount} rit${visibleCount !== 1 ? 'ten' : ''} gevonden`;
        placeholder.style.color = '#059669';
    } else {
        placeholder.text = '-- Selecteer een rit --';
        placeholder.style.color = '';
    }
    
    // Auto-select bij exacte match (alleen bij normale zoekopdracht)
    if (!showAll && hasExactMatch && searchTerm.length > 2) {
        const exactOption = Array.from(select.options).find(opt => 
            opt.value !== '' && 
            opt.getAttribute('data-search-text') === searchTerm
        );
        if (exactOption) {
            select.value = exactOption.value;
            const event = new Event('change');
            select.dispatchEvent(event);
        }
    }
    
    return matchingOptions;
}

function showSearchResultsOverlay(selectId, searchTerm) {
    const select = document.getElementById(selectId);
    const activities = comparisonActivities;
    
    if (!select || !activities) return;
    
    // Zoek alle matching activiteiten
    const matchingActivities = activities.filter(activity => {
        const searchText = `${activity.fileName} ${activity.summary?.distanceKm || ''} ${activity.summary?.elevationGain || ''} ${activity.summary?.rideDate || ''}`.toLowerCase();
        return searchText.includes(searchTerm);
    });
    
    // Creëer of update overlay
    let overlay = document.getElementById('searchResultsOverlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'searchResultsOverlay';
        overlay.className = 'search-results-overlay';
        overlay.innerHTML = `
            <div class="search-results-container">
                <div class="search-results-header">
                    <h3>Zoekresultaten</h3>
                    <button class="close-results">×</button>
                </div>
                <div id="searchResultsContent"></div>
            </div>
        `;
        document.body.appendChild(overlay);
    }
    
    const content = document.getElementById('searchResultsContent');
    
    if (matchingActivities.length === 0) {
        content.innerHTML = `
            <div class="no-results-message">
                <div class="icon">🔍</div>
                <h4>Geen ritten gevonden</h4>
                <p>Geen ritten gevonden voor "${searchTerm}"</p>
                <p><small>Probeer een andere zoekterm</small></p>
            </div>
        `;
    } else {
        let resultsHTML = `
            <div class="search-results-info">
                <p><strong>${matchingActivities.length}</strong> rit${matchingActivities.length !== 1 ? 'ten' : ''} gevonden voor "<strong>${searchTerm}</strong>"</p>
            </div>
            <div class="search-results-grid">
        `;
        
        matchingActivities.forEach((activity, index) => {
            const summary = activity.summary || {};
            const fileName = highlightText(activity.fileName, searchTerm);
            const date = summary.rideDate ? new Date(summary.rideDate).toLocaleDateString('nl-NL') : 'Onbekende datum';
            
            resultsHTML += `
                <div class="search-result-item" data-activity-id="${activity.id}" data-select-id="${selectId}">
                    <div class="result-item-header">
                        <div class="result-item-name">${fileName}</div>
                        <div class="result-item-date">${date}</div>
                    </div>
                    <div class="result-item-stats">
                        <div class="result-stat">
                            <span class="result-stat-icon">📏</span>
                            ${summary.distanceKm || '?'} km
                        </div>
                        <div class="result-stat">
                            <span class="result-stat-icon">⛰️</span>
                            ${summary.elevationGain || '?'} m
                        </div>
                        <div class="result-stat">
                            <span class="result-stat-icon">🚀</span>
                            ${summary.avgSpeed ? summary.avgSpeed.toFixed(1) + ' km/u' : '?'}
                        </div>
                        <div class="result-stat">
                            <span class="result-stat-icon">⏱️</span>
                            ${summary.durationSec ? formatDuration(summary.durationSec) : '?'}
                        </div>
                    </div>
                    <div class="result-item-actions">
                        <button class="select-result-btn" onclick="selectSearchResult('${selectId}', '${activity.id}')">
                            Selecteren
                        </button>
                    </div>
                </div>
            `;
        });
        
        resultsHTML += `
            </div>
            <div class="quick-actions">
                <button class="quick-action-btn" onclick="closeSearchResults()">
                    ❌ Sluiten
                </button>
                <button class="quick-action-btn" onclick="clearSearch('${selectId}')">
                    🔄 Wissen
                </button>
            </div>
        `;
        
        content.innerHTML = resultsHTML;
        
        // Voeg click event toe aan result items
        content.querySelectorAll('.search-result-item').forEach(item => {
            item.addEventListener('click', function(e) {
                if (!e.target.classList.contains('select-result-btn')) {
                    const activityId = this.getAttribute('data-activity-id');
                    const selectId = this.getAttribute('data-select-id');
                    selectSearchResult(selectId, activityId);
                }
            });
        });
    }
    
    overlay.style.display = 'flex';
    
    // Focus op eerste resultaat
    setTimeout(() => {
        const firstResult = content.querySelector('.search-result-item');
        if (firstResult) {
            firstResult.focus();
        }
    }, 100);
}

function highlightText(text, searchTerm) {
    if (!searchTerm) return text;
    
    const regex = new RegExp(`(${escapeRegex(searchTerm)})`, 'gi');
    return text.replace(regex, '<span class="highlight-match">$1</span>');
}

function escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Selecteer een zoekresultaat
function selectSearchResult(selectId, activityId) {
    const select = document.getElementById(selectId);
    if (select) {
        select.value = activityId;
        const event = new Event('change');
        select.dispatchEvent(event);
    }
    closeSearchResults();
}
function closeSearchResults() {
    const overlay = document.getElementById('searchResultsOverlay');
    if (overlay) {
        overlay.style.display = 'none';
    }
}

// Wis zoekopdracht
function clearSearch(selectId) {
    const input = document.querySelector(`.search-input[data-for="${selectId}"]`);
    if (input) {
        input.value = '';
        performSearch(selectId, '', false);
    }
    closeSearchResults();
}


function updateSelectInfo(selectId, selectedValue, activities) {
    const infoElement = document.getElementById(`${selectId}-info`);
    if (!infoElement) return;
    
    if (!selectedValue) {
        infoElement.innerHTML = `
            <div class="activity-info-empty">
                <span class="info-icon">💡</span>
                <div>
                    <strong>Selecteer een rit</strong><br>
                    <small>Kies een rit uit de dropdown om details te zien</small>
                </div>
            </div>
        `;
        return;
    }
    
    const activity = activities.find(a => a.id === selectedValue);
    if (!activity) {
        infoElement.innerHTML = `
            <div class="activity-info-error">
                <span>❌</span>
                <div>
                    <strong>Rit niet gevonden</strong><br>
                    <small>Probeer een andere rit te selecteren</small>
                </div>
            </div>
        `;
        return;
    }
    
    const summary = activity.summary || {};
    const index = parseInt(selectId.replace('comparisonSelect', ''));
    
    infoElement.innerHTML = `
        <div class="activity-info-details">
            <div class="activity-name">
                ${activity.fileName}
                <span class="rit-badge rit-${index}">Rit ${index}</span>
            </div>
            <div class="activity-stats">
                <span class="stat">📏 ${summary.distanceKm || '?'} km</span>
                <span class="stat">⛰️ ${summary.elevationGain || '?'} m</span>
                <span class="stat">🚀 ${summary.avgSpeed ? summary.avgSpeed.toFixed(1) + ' km/u' : '?'}</span>
                <span class="stat">📅 ${summary.rideDate ? new Date(summary.rideDate).toLocaleDateString('nl-NL') : 'onbekend'}</span>
            </div>
        </div>
    `;
}
function updateAvailableCount(selectId) {
    const select = document.getElementById(selectId);
    if (!select) return;
    
    const availableOptions = Array.from(select.options).filter(opt => 
        opt.value !== '' && opt.style.display !== 'none'
    ).length;
    
    const placeholder = select.options[0];
    placeholder.text = `-- Kies een rit (${availableOptions} beschikbaar) --`;
}

function setupComparisonSelectListeners() {
    const selectIds = ['comparisonSelect1', 'comparisonSelect2', 'comparisonSelect3', 'comparisonSelect4', 'comparisonSelect5'];
    
    selectIds.forEach(id => {
        const select = document.getElementById(id);
        if (select) {
            const newSelect = select.cloneNode(true);
            select.parentNode.replaceChild(newSelect, select);
        }
    });
    
    selectIds.forEach(id => {
        const select = document.getElementById(id);
        if (select) {
            select.addEventListener('change', () => {
                console.log(`Select ${id} changed to:`, select.value);
                
                currentSelections[id] = select.value;
                
                updateSelectInfo(id, select.value, comparisonActivities);
                
                setTimeout(() => {
                    populateComparisonSelects();
                }, 50);
            });
        }
    });
}

function addComparisonSelect() {
    if (currentComparisonCount >= maxComparisons) {
        alert(`Maximum van ${maxComparisons} ritten bereikt`);
        return;
    }
    
    currentComparisonCount++;
    currentSelections[`comparisonSelect${currentComparisonCount}`] = '';
    populateComparisonSelects();
}

function removeComparisonSelect() {
    if (currentComparisonCount <= 2) {
        alert('Minimum van 2 ritten nodig voor vergelijking');
        return;
    }
    
    const removedSelectId = `comparisonSelect${currentComparisonCount}`;
    delete currentSelections[removedSelectId];
    
    currentComparisonCount--;
    populateComparisonSelects();
}

async function compareActivities() {
    const selectIds = ['comparisonSelect1', 'comparisonSelect2', 'comparisonSelect3', 'comparisonSelect4', 'comparisonSelect5'];
    const resultsContainer = document.getElementById('comparisonResults');
    
    if (!resultsContainer) return;
    
    const selectedActivities = [];
    const selectedIds = new Set();
    
    for (let i = 0; i < currentComparisonCount; i++) {
        const selectId = selectIds[i];
        const activityId = currentSelections[selectId];
        
        if (activityId) {
            if (selectedIds.has(activityId)) {
                alert('Er zijn dubbele ritten geselecteerd. Dit zou niet moeten voorkomen.');
                return;
            }
            selectedIds.add(activityId);
            selectedActivities.push({
                selectId: selectId,
                activityId: activityId,
                index: i + 1
            });
        }
    }
    
    if (selectedActivities.length < 2) {
        alert('Selecteer minimaal 2 ritten om te vergelijken');
        return;
    }
    
    try {
        resultsContainer.innerHTML = `
            <div class="comparison-loading">
                <div class="loading-spinner"></div>
                <h4>Ritten worden vergeleken...</h4>
                <p>Even geduld, dit kan even duren bij veel data</p>
            </div>
        `;
        resultsContainer.classList.remove('hidden');
        
        const analyses = [];
        for (const selected of selectedActivities) {
            const activity = await getActivityFromDB(selected.activityId);
            const analysis = await analyzeActivityForComparison(activity);
            analyses.push({
                ...analysis,
                colorIndex: selected.index,
                originalActivity: activity
            });
        }
        
        displayMultiComparisonResults(analyses);
        
    } catch (error) {
        console.error('Fout bij vergelijken:', error);
        resultsContainer.innerHTML = `
            <div class="comparison-error">
                <h4>❌ Fout bij vergelijken</h4>
                <p>${error.message}</p>
                <small>Controleer of de bestanden geldige GPS data bevatten</small>
            </div>
        `;
    }
}

function clearComparison() {
    const resultsContainer = document.getElementById('comparisonResults');
    
    currentSelections = {};
    
    currentComparisonCount = 2;
    populateComparisonSelects();
    
    if (resultsContainer) {
        resultsContainer.classList.add('hidden');
        resultsContainer.innerHTML = '';
    }
    
    [comparisonChart1, comparisonChart2, comparisonChart3].forEach(chart => {
        if (chart) {
            chart.destroy();
            chart = null;
        }
    });
}

async function analyzeActivityForComparison(activity) {
    console.log(`🔍 Analyseer voor vergelijking: ${activity.fileName}`);
    
    const text = await activity.fileBlob.text();
    const doc = new DOMParser().parseFromString(text, "application/xml");
    
    const xpath = "//*[local-name()='Trackpoint' or local-name()='trkpt']";
    const nodes = [];
    const iter = doc.evaluate(xpath, doc, null, XPathResult.ORDERED_NODE_ITERATOR_TYPE, null);
    let node;
    while ((node = iter.iterateNext())) nodes.push(node);
    
    if (nodes.length < 2) {
        throw new Error('Te weinig trackpoints voor vergelijking');
    }
    
    const getChildText = (el, names) => {
        for (const n of names) {
            const found = Array.from(el.childNodes).find(ch => ch.localName === n);
            if (found && found.textContent) return found.textContent;
            const q = el.querySelector(n);
            if (q && q.textContent) return q.textContent;
        }
        return null;
    };
    
    const trackpoints = nodes.map(tp => {
        const timeStr = getChildText(tp, ["Time", "time"]);
        const time = timeStr ? new Date(timeStr) : null;
        const altStr = getChildText(tp, ["AltitudeMeters", "ele"]);
        const altitude = altStr !== null ? toNumberSafe(altStr) : NaN;
        const distStr = getChildText(tp, ["DistanceMeters"]);
        const distance = distStr !== null ? toNumberSafe(distStr) : NaN;
        
        let lat = NaN, lon = NaN;
        if (tp.hasAttribute && (tp.hasAttribute("lat") || tp.hasAttribute("lon"))) {
            lat = toNumberSafe(tp.getAttribute("lat"));
            lon = toNumberSafe(tp.getAttribute("lon"));
        }
        
        return { time, altitude, distance, lat, lon };
    });
    
    const cumDist = new Array(trackpoints.length).fill(0);
    const hasDistanceValues = trackpoints.some(tp => !isNaN(tp.distance));
    
    if (hasDistanceValues) {
        const base = isNaN(trackpoints[0].distance) ? 0 : trackpoints[0].distance;
        for (let i = 0; i < trackpoints.length; i++) {
            const d = isNaN(trackpoints[i].distance) ? NaN : trackpoints[i].distance - base;
            cumDist[i] = isNaN(d) ? (i === 0 ? 0 : cumDist[i-1]) : d;
        }
    } else {
        let sum = 0;
        cumDist[0] = 0;
        for (let i = 1; i < trackpoints.length; i++) {
            const a = trackpoints[i-1], b = trackpoints[i];
            if (!isNaN(a.lat) && !isNaN(a.lon) && !isNaN(b.lat) && !isNaN(b.lon)) {
                sum += haversine(a.lat, a.lon, b.lat, b.lon);
            }
            cumDist[i] = sum;
        }
    }
    
    const totalDistance = cumDist[cumDist.length - 1];
    const hasTimes = trackpoints.every(tp => tp.time instanceof Date && !isNaN(tp.time));
    
    let totalMovingSeconds = 0;
    let totalElapsedSeconds = NaN;
    
    if (hasTimes) {
        totalElapsedSeconds = (trackpoints[trackpoints.length-1].time - trackpoints[0].time) / 1000;
        totalMovingSeconds = calculateMovingTime(trackpoints, cumDist);
    }
    
    let avgSpeedKmh = NaN;
    if (!isNaN(totalDistance) && !isNaN(totalMovingSeconds) && totalMovingSeconds > 0) {
        avgSpeedKmh = (totalDistance / 1000) / (totalMovingSeconds / 3600);
    }
    
    let elevationGain = 0;
    let lastAlt = isNaN(trackpoints[0].altitude) ? null : trackpoints[0].altitude;
    for (const tp of trackpoints) {
        if (isNaN(tp.altitude)) continue;
        if (lastAlt === null) { lastAlt = tp.altitude; continue; }
        const diff = tp.altitude - lastAlt;
        if (diff > 0) elevationGain += diff;
        lastAlt = tp.altitude;
    }
    
    const rideDate = (trackpoints[0] && trackpoints[0].time && !isNaN(trackpoints[0].time)) ? 
        trackpoints[0].time.toISOString() : null;
    
    return {
        fileName: activity.fileName,
        totalDistance,
        totalSeconds: totalMovingSeconds,
        totalElapsedSeconds,
        elevationGain: Math.round(elevationGain),
        avgSpeedKmh,
        trackpoints,
        cumDist,
        hasTimes,
        rideDate
    };
}

function displayMultiComparisonResults(analyses) {
    const resultsContainer = document.getElementById('comparisonResults');
    
    resultsContainer.innerHTML = `
        <div class="text-center" style="padding: 40px;">
            <div class="spinner" style="width: 40px; height: 40px; margin: 0 auto 20px;"></div>
            <p>Vergelijking wordt geladen...</p>
        </div>
    `;
    
    setTimeout(() => {
        const colors = [
            { bg: 'rgba(37, 99, 235, 0.9)', light: 'rgba(37, 99, 235, 0.1)' },
            { bg: 'rgba(245, 158, 11, 0.9)', light: 'rgba(245, 158, 11, 0.1)' },
            { bg: 'rgba(16, 185, 129, 0.9)', light: 'rgba(16, 185, 129, 0.1)' },
            { bg: 'rgba(139, 92, 246, 0.9)', light: 'rgba(139, 92, 246, 0.1)' },
            { bg: 'rgba(236, 72, 153, 0.9)', light: 'rgba(236, 72, 153, 0.1)' }
        ];
        
        // Definieer de statistieken in de gewenste volgorde: 2 boven, 2 onder
        const comparisonData = [
            {
                label: 'Afstand',
                unit: 'km',
                better: 'higher',
                icon: '📏',
                type: 'distance',
                getValue: (analysis) => analysis.totalDistance ? (analysis.totalDistance / 1000).toFixed(2) : '0.00',
                getNumeric: (analysis) => analysis.totalDistance ? analysis.totalDistance / 1000 : 0
            },
            {
                label: 'Bewegingstijd',
                unit: '',
                better: 'lower',
                icon: '⏱️',
                type: 'duration',
                getValue: (analysis) => analysis.totalSeconds ? formatDuration(analysis.totalSeconds) : '00:00:00',
                getNumeric: (analysis) => analysis.totalSeconds || 0,
                format: 'duration'
            },
            {
                label: 'Gem. Snelheid',
                unit: 'km/u',
                better: 'higher',
                icon: '🚀',
                type: 'speed',
                getValue: (analysis) => analysis.avgSpeedKmh ? analysis.avgSpeedKmh.toFixed(1) : '0.0',
                getNumeric: (analysis) => analysis.avgSpeedKmh || 0
            },
            {
                label: 'Hoogtemeters',
                unit: 'm',
                better: 'higher',
                icon: '⛰️',
                type: 'elevation',
                getValue: (analysis) => analysis.elevationGain ? analysis.elevationGain.toString() : '0',
                getNumeric: (analysis) => analysis.elevationGain || 0
            }
        ];
        
        let html = `
            <div class="comparison-header">
                <h4>🔄 Rit Vergelijking (${analyses.length} ritten)</h4>
                <div class="comparison-rit-titles">
        `;
        
        analyses.forEach((analysis, index) => {
            const color = colors[index] || colors[0];
            html += `
                <div class="comparison-rit-badge rit-color-${index + 1}">
                    <span class="color-dot" style="background: ${color.bg};"></span>
                    ${analysis.fileName} (${(analysis.totalDistance / 1000).toFixed(1)} km)
                </div>
            `;
        });
        
        html += `
                </div>
            </div>
            
            <div class="comparison-stats-grid">
        `;
        
        // Toon eerst 2 statistieken (rij 1)
        comparisonData.slice(0, 2).forEach(metric => {
            html += createStatItemHTML(metric, analyses, colors);
        });
        
        html += `
            </div>
            <div class="comparison-stats-grid">
        `;
        
        // Toon volgende 2 statistieken (rij 2)
        comparisonData.slice(2, 4).forEach(metric => {
            html += createStatItemHTML(metric, analyses, colors);
        });
        
        html += `
            </div>
            
            <div class="comparison-charts-multi">
                <div class="comparison-chart-multi">
                    <h5>📈 Hoogteprofiel Vergelijking</h5>
                    <div class="chart-container-wrapper">
                        <canvas id="comparisonElevationChart"></canvas>
                    </div>
                </div>
                <div class="comparison-chart-multi">
                    <h5>🚀 Snelheidsprofiel Vergelijking</h5>
                    <div class="chart-container-wrapper">
                        <canvas id="comparisonSpeedChart"></canvas>
                    </div>
                </div>
                <div class="comparison-chart-multi">
                    <h5>📊 Statistieken Vergelijking</h5>
                    <div class="chart-container-wrapper">
                        <canvas id="comparisonStatsChart"></canvas>
                    </div>
                </div>
            </div>
        `;
        
        resultsContainer.innerHTML = html;
        resultsContainer.classList.remove('hidden');
        
        setTimeout(() => {
            createMultiComparisonCharts(analyses, colors);
        }, 100);
        
    }, 50);
}

function createStatItemHTML(metric, analyses, colors) {
    let html = `
        <div class="comparison-stat-item" data-stat-type="${metric.type}">
            <div class="stat-header">
                <div class="stat-icon">${metric.icon}</div>
                <div class="stat-label">${metric.label}</div>
            </div>
            <div class="comparison-stat-values">
    `;
    
    const values = analyses.map(analysis => metric.getNumeric(analysis));
    const validValues = values.filter(v => !isNaN(v) && v > 0);
    
    let bestValue = null;
    if (validValues.length > 0) {
        bestValue = metric.better === 'higher' ? 
            Math.max(...validValues) : 
            Math.min(...validValues);
    }
    
    analyses.forEach((analysis, index) => {
        const value = metric.getNumeric(analysis);
        const displayValue = metric.format === 'duration' ? 
            formatDuration(metric.getNumeric(analysis)) : metric.getValue(analysis);
        const isWinner = bestValue !== null && !isNaN(value) && value === bestValue && value > 0;
        const color = colors[index] || colors[0];
        
        html += `
            <div class="stat-value-multi ${isWinner ? 'winner' : ''}" style="border-color: ${isWinner ? 'var(--success-color)' : color.bg}">
                <div class="value">${displayValue}</div>
                <div class="unit">${metric.unit}</div>
                <div class="rit-indicator rit-indicator-${index + 1}">
                    Rit ${index + 1}
                </div>
        `;
        
        // Voeg verschil indicator toe voor snelheid en afstand (alleen voor rit 2 en hoger)
        if (index > 0 && (metric.type === 'speed' || metric.type === 'distance')) {
            const firstValue = metric.getNumeric(analyses[0]);
            if (firstValue > 0 && value > 0) {
                const difference = value - firstValue;
                const percentage = ((difference / firstValue) * 100);
                
                if (Math.abs(percentage) > 0.1) { // Alleen tonen bij significante verschillen
                    const differenceClass = difference > 0 ? 'difference-positive' : 
                                          difference < 0 ? 'difference-negative' : 'difference-neutral';
                    const differenceSymbol = difference > 0 ? '↗' : difference < 0 ? '↘' : '→';
                    
                    html += `
                        <div class="difference-indicator ${differenceClass}">
                            ${differenceSymbol} ${Math.abs(percentage).toFixed(1)}%
                        </div>
                    `;
                }
            }
        }
        
        html += `</div>`;
    });
    
    html += `
            </div>
        </div>
    `;
    
    return html;
}

function createMultiComparisonCharts(analyses, colors) {
    [comparisonChart1, comparisonChart2, comparisonChart3].forEach(chart => {
        if (chart && typeof chart.destroy === 'function') {
            chart.destroy();
        }
    });

    const percentageLabels = Array.from({length: 11}, (_, i) => (i * 10) + '%');
    
    const elevationCtx = document.getElementById('comparisonElevationChart')?.getContext('2d');
    if (elevationCtx) {
        const datasets = analyses.map((analysis, index) => {
            const color = colors[index] || colors[0];
            const elevationData = prepareComparisonData(analysis, 'elevation');
            
            return {
                label: `${analysis.fileName} (${(analysis.totalDistance / 1000).toFixed(1)} km)`,
                data: elevationData,
                borderColor: color.bg.replace('0.9', '1'),
                backgroundColor: color.light,
                tension: 0.4,
                pointRadius: 0,
                borderWidth: 2,
                fill: false
            };
        });
        
        comparisonChart1 = new Chart(elevationCtx, {
            type: 'line',
            data: {
                labels: percentageLabels,
                datasets: datasets
            },
            options: getMultiComparisonChartOptions('Hoogte (m)', 'Rit Progressie (%)', true)
        });
    }
    
    const speedCtx = document.getElementById('comparisonSpeedChart')?.getContext('2d');
    if (speedCtx) {
        const datasets = analyses.map((analysis, index) => {
            const color = colors[index] || colors[0];
            const speedData = prepareComparisonData(analysis, 'speed');
            
            return {
                label: `${analysis.fileName} (${(analysis.totalDistance / 1000).toFixed(1)} km)`,
                data: speedData,
                borderColor: color.bg.replace('0.9', '1'),
                backgroundColor: color.light,
                tension: 0.4,
                pointRadius: 0,
                borderWidth: 2,
                fill: false
            };
        });
        
        comparisonChart2 = new Chart(speedCtx, {
            type: 'line',
            data: {
                labels: percentageLabels,
                datasets: datasets
            },
            options: getMultiComparisonChartOptions('Snelheid (km/u)', 'Rit Progressie (%)', false)
        });
    }
    
    const statsCtx = document.getElementById('comparisonStatsChart')?.getContext('2d');
    if (statsCtx) {
        const labels = ['Afstand (km)', 'Snelheid (km/u)', 'Hoogtemeters (m)'];
        const datasets = analyses.map((analysis, index) => {
            const color = colors[index] || colors[0];
            
            return {
                label: analysis.fileName,
                data: [
                    analysis.totalDistance / 1000,
                    analysis.avgSpeedKmh || 0,
                    analysis.elevationGain
                ],
                backgroundColor: color.bg,
                borderColor: color.bg.replace('0.9', '1'),
                borderWidth: 1,
                borderRadius: 4,
                barPercentage: 0.6,
                categoryPercentage: 0.8
            };
        });
        
        comparisonChart3 = new Chart(statsCtx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { 
                        display: true,
                        position: 'top',
                        labels: {
                            boxWidth: 12,
                            padding: 15
                        }
                    },
                    tooltip: {
                        mode: 'index',
                        intersect: false
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: {
                            color: 'rgba(0,0,0,0.05)'
                        }
                    },
                    x: {
                        grid: {
                            display: false
                        }
                    }
                },
                interaction: {
                    mode: 'nearest',
                    axis: 'x',
                    intersect: false
                }
            }
        });
    }
}

function getMultiComparisonChartOptions(yTitle, xTitle, beginAtZero = false) {
    return {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { 
                display: true,
                position: 'top',
                labels: {
                    boxWidth: 12,
                    padding: 15,
                    usePointStyle: true
                }
            },
            tooltip: {
                mode: 'index',
                intersect: false,
                callbacks: {
                    title: (ctx) => {
                        const percentage = ctx[0].dataIndex * 10;
                        return `${percentage}% van rit`;
                    },
                    label: (context) => {
                        const label = context.dataset.label || '';
                        const value = context.parsed.y;
                        if (yTitle.includes('Snelheid')) {
                            return `${label}: ${value?.toFixed(1) || '0'} km/u`;
                        } else {
                            return `${label}: ${value?.toFixed(0) || '0'} m`;
                        }
                    }
                }
            }
        },
        scales: {
            y: {
                beginAtZero: beginAtZero,
                title: { 
                    display: true, 
                    text: yTitle,
                    font: { weight: 'bold', size: 12 }
                },
                grid: { 
                    color: 'rgba(0,0,0,0.05)'
                },
                ticks: {
                    font: { size: 11 }
                }
            },
            x: {
                title: { 
                    display: true, 
                    text: xTitle,
                    font: { weight: 'bold', size: 12 }
                },
                grid: { 
                    color: 'rgba(0,0,0,0.05)'
                },
                ticks: {
                    font: { size: 11 }
                }
            }
        },
        interaction: {
            mode: 'nearest',
            axis: 'x',
            intersect: false
        },
        elements: {
            line: {
                tension: 0.4
            }
        }
    };
}

function prepareComparisonData(analysis, dataType) {
    if (!analysis.trackpoints || analysis.trackpoints.length === 0) {
        return new Array(11).fill(null);
    }
    
    const result = new Array(11).fill(null);
    const totalDistance = analysis.totalDistance;
    
    let speedValues = [];
    if (dataType === 'speed' && analysis.trackpoints.length > 1) {
        for (let i = 1; i < analysis.trackpoints.length; i++) {
            const timeDiff = (analysis.trackpoints[i].time - analysis.trackpoints[i-1].time) / 1000;
            const distDiff = analysis.cumDist[i] - analysis.cumDist[i-1];
            
            if (timeDiff > 0 && distDiff >= 0) {
                const speed = (distDiff / 1000) / (timeDiff / 3600);
                speedValues.push({
                    distance: analysis.cumDist[i],
                    speed: speed
                });
            }
        }
    }
    
    for (let i = 0; i <= 10; i++) {
        const percentage = i * 10;
        const targetDistance = (percentage / 100) * totalDistance;
        
        if (dataType === 'elevation') {
            let closestPoint = null;
            let minDistanceDiff = Infinity;
            
            for (let j = 0; j < analysis.trackpoints.length; j++) {
                const pointDistance = analysis.cumDist[j];
                const distanceDiff = Math.abs(pointDistance - targetDistance);
                
                if (distanceDiff < minDistanceDiff) {
                    minDistanceDiff = distanceDiff;
                    closestPoint = analysis.trackpoints[j];
                }
            }
            
            if (closestPoint && !isNaN(closestPoint.altitude)) {
                result[i] = closestPoint.altitude;
            }
        } 
        else if (dataType === 'speed') {
            let closestSpeed = null;
            let minSpeedDiff = Infinity;
            
            for (const speedPoint of speedValues) {
                const distanceDiff = Math.abs(speedPoint.distance - targetDistance);
                if (distanceDiff < minSpeedDiff) {
                    minSpeedDiff = distanceDiff;
                    closestSpeed = speedPoint.speed;
                }
            }
            
            if (closestSpeed !== null) {
                result[i] = closestSpeed;
            } else if (analysis.avgSpeedKmh && !isNaN(analysis.avgSpeedKmh)) {
                result[i] = analysis.avgSpeedKmh;
            }
        }
    }
    
    if (dataType === 'speed') {
        smoothSpeedEndpoints(result, analysis.avgSpeedKmh);
    }
    
    return result;
}

function smoothSpeedEndpoints(speedData, avgSpeed) {
    if (!speedData || speedData.length < 3) return;
    
    const avg = avgSpeed || 25;
    const last = speedData.length - 1;
    
    if (speedData[0] !== null && speedData[1] !== null && speedData[2] !== null) {
        const current = speedData[0];
        const next1 = speedData[1];
        const next2 = speedData[2];
        
        if (current < 5 || current > 50) {
            speedData[0] = (current + next1 + next2) / 3;
        }
        else if (Math.abs(current - next1) > 15) {
            speedData[0] = next1 * 0.9;
        }
    }
    
    if (speedData[last] !== null && speedData[last-1] !== null && speedData[last-2] !== null) {
        const current = speedData[last];
        const prev1 = speedData[last-1];
        const prev2 = speedData[last-2];
        
        if (current < 5 || current > 50) {
            speedData[last] = (prev2 + prev1 + current) / 3;
        }
        else if (Math.abs(current - prev1) > 15) {
            speedData[last] = prev1 * 0.9;
        }
    }
    
    if (speedData[0] !== null && Math.abs(speedData[0] - avg) > avg * 0.8) {
        speedData[0] = avg * 0.8;
    }
    
    if (speedData[last] !== null && Math.abs(speedData[last] - avg) > avg * 0.8) {
        speedData[last] = avg * 0.8;
    }
}

// Initialisatie functie voor vergelijking
function initComparison() {
    currentSelections = {
        'comparisonSelect1': '',
        'comparisonSelect2': ''
    };
    
    const compareBtn = document.getElementById('compareBtn');
    const clearComparisonBtn = document.getElementById('clearComparisonBtn');
    const addComparisonBtn = document.getElementById('addComparisonBtn');
    const removeComparisonBtn = document.getElementById('removeComparisonBtn');
    
    if (compareBtn) {
        compareBtn.addEventListener('click', compareActivities);
    }
    
    if (clearComparisonBtn) {
        clearComparisonBtn.addEventListener('click', clearComparison);
    }
    
    if (addComparisonBtn) {
        addComparisonBtn.addEventListener('click', addComparisonSelect);
    }
    
    if (removeComparisonBtn) {
        removeComparisonBtn.addEventListener('click', removeComparisonSelect);
    }
    
    setTimeout(async () => {
        const comparisonContainer = document.getElementById('comparisonContainer');
        const activities = await listActivitiesFromDB();
        if (activities.length >= 2 && comparisonContainer) {
            comparisonContainer.classList.remove('hidden');
            await populateComparisonSelects();
        }
    }, 1000);
}

// Voeg deze initialisatie toe aan de bestaande init functies
document.addEventListener('DOMContentLoaded', function() {
    initComparison();
});

javascript
/* ========== DASHBOARD MANAGEMENT ========== */
function showDashboard() {
    document.getElementById('analysisResults').classList.add('hidden');
    document.querySelector('.dashboard-grid').style.display = 'grid';
    updateQuickStats();
}

function showAnalysis() {
    // Verberg dashboard en toon analysis results
    const dashboard = document.querySelector('.dashboard-grid');
    const analysisResults = document.getElementById('analysisResults');
    
    if (dashboard) dashboard.style.display = 'none';
    if (analysisResults) analysisResults.classList.remove('hidden');
}

function showTab(tabName) {
    showAnalysis();
    
    // Switch to the requested tab
    const tabButton = document.querySelector(`[data-tab="${tabName}"]`);
    if (tabButton) {
        tabButton.click();
    }
}

/* ========== QUICK STATS ========== */
async function updateQuickStats() {
    try {
        const activities = await listActivitiesFromDB();
        
        // Total rides
        document.getElementById('quickTotalRides').textContent = activities.length;
        
        // Total distance
        const totalDistance = activities.reduce((sum, item) => {
            return sum + (item.summary?.distanceKm ? parseFloat(item.summary.distanceKm) : 0);
        }, 0);
        document.getElementById('quickTotalDistance').textContent = totalDistance.toFixed(0);
        
        // Total elevation
        const totalElevation = activities.reduce((sum, item) => {
            return sum + (item.summary?.elevationGain || 0);
        }, 0);
        document.getElementById('quickTotalElevation').textContent = totalElevation;
        
        // Update saved preview
        updateSavedPreview(activities);
        
    } catch (error) {
        console.error('Error updating quick stats:', error);
    }
}

function updateSavedPreview(activities) {
    const preview = document.getElementById('savedPreview');
    if (!preview) return;
    
    if (activities.length === 0) {
        preview.innerHTML = '<p>Geen ritten opgeslagen</p>';
        return;
    }
    
    // Show last 3 activities
    const recentActivities = activities.slice(-3).reverse();
    preview.innerHTML = recentActivities.map(activity => `
        <div style="text-align: left; margin-bottom: 10px; padding: 10px; background: rgba(255,255,255,0.05); border-radius: 8px;">
            <div style="font-weight: 600; margin-bottom: 5px;">${activity.fileName}</div>
            <div style="font-size: 0.8rem; color: var(--text-secondary);">
                ${activity.summary?.distanceKm || '?'} km • 
                ${activity.summary?.elevationGain || '?'} m
            </div>
        </div>
    `).join('');
}