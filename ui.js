// ui.js - Dashboard, Recap, Rankings, ROUTE PLANNER (Apart) & Heatmap Interactie

let allActivitiesCache = null; 
let muniMap = null; 
let heatmapMap = null; 
let routeMap = null; 
let geoJsonLayer = null; 
let conqueredMunis = new Set(); 
let selectedRides = new Set(); 
let activeCharts = {};
let heatmapLayerGroup = null; 
let tileLayerGroup = null;    
let currentWorldMode = 'muni';
let isShowingAll = false;
let currentActivityPage = 1;
const ACTIVITY_PAGE_SIZE = 25;
let currentCalDate = new Date();

// Route Planner variabelen (GECORRIGEERD)
let waypoints = []; 
let routePolyline = null; 
let routeSegments = []; 

const REGIONS = [
    { code: 'be', url: 'communes.json', type: 'topojson', nameFields: ['Gemeente', 'name', 'NAME_4', 'Name'] },
    { code: 'nl', url: 'https://cartomap.github.io/nl/wgs84/gemeente_2023.geojson', type: 'geojson', nameFields: ['statnaam'] }
];


document.addEventListener('DOMContentLoaded', () => {
    // 1. THEMA CHECK (Dark mode is nu standaard in HTML)
    // Als de gebruiker expliciet 'light' heeft opgeslagen, halen we dark mode weg
    if (localStorage.getItem('theme') === 'light') {
        document.body.classList.remove('dark-mode');
    }

    // 2. Navigatie & Selectors laden
    setupNavigation();
    setupSegmentSelector();
    
    // 3. Datum instellen voor recap
    const now = new Date();
    const ms = document.getElementById('recap-month-select');
    const ys = document.getElementById('recap-year-select');
    if(ms) ms.value = now.getMonth();
    if(ys) ys.value = now.getFullYear();
    
    // 4. Heatmap cache check voor tegels
    if(typeof setWorldMode === 'function' && typeof currentWorldMode !== 'undefined') {
        // Zorg dat de wereld jager knoppen werken
    }
});
function setupNavigation() {
    document.querySelectorAll('.nav-btn[data-target]').forEach(btn => 
        btn.addEventListener('click', () => switchTab(btn.dataset.target))
    );
}

// IN ui.js

function setupSegmentSelector() {
    const select = document.getElementById('segmentSelector');
    if (select) {
        select.innerHTML = ''; 
        // Vul dropdown: 5km t/m 100km
        for (let k = 5; k <= 100; k += 5) {
            const opt = document.createElement('option');
            opt.value = k; 
            opt.text = `${k} km`; 
            select.appendChild(opt);
        }
        select.value = "5"; // Standaard 5km
    }
    
    // Pas de tekst van de knop aan zodat duidelijk is wat hij doet
    const fixBtn = document.getElementById('fix-data-btn');
    if(fixBtn) {
        fixBtn.innerHTML = "🔄 <strong>Update Alle Data</strong>";
        fixBtn.title = "Klik hier om alle ritten opnieuw te berekenen voor de ranglijsten";
        fixBtn.style.width = "auto";
        fixBtn.style.padding = "10px 20px";
    }
}

function calculateTrendLine(data) {
    const n = data.length;
    if (n < 2) return data;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (let i = 0; i < n; i++) { sumX += i; sumY += data[i]; sumXY += i * data[i]; sumX2 += i * i; }
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    return data.map((_, i) => slope * i + intercept);
}

function switchTab(tabName) {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    const activeBtn = document.querySelector(`.nav-btn[data-target="${tabName}"]`);
    if(activeBtn) activeBtn.classList.add('active');

    document.querySelectorAll('.view-section').forEach(v => v.classList.add('hidden'));
    const target = document.getElementById(`view-${tabName}`);
    if(target) target.classList.remove('hidden');

    // --- NIEUW: Flow-logica voor het 'Analyse'-tabblad via het Menu ---
    if (tabName === 'analysis') {
        const sumDash = document.getElementById('ride-summary-dashboard');
        const mapView = document.getElementById('ride-map-view');

        // Als we via het zijmenu komen (dus we klikken op de 🗺️ knop), 
        // verbergen we de summary en tonen we direct de kaartomgeving.
        if (sumDash && mapView) {
             sumDash.classList.add('hidden');
             mapView.classList.remove('hidden');
        }
    }

    setTimeout(() => {
        // Fix voor Analysis map
        if(tabName === 'analysis' && typeof map !== 'undefined' && map) {
            map.invalidateSize();
            
            // Controleer of er iets op de kaart staat om op te focussen
            if (typeof activeSegment !== 'undefined' && activeSegment && typeof segmentLayer !== 'undefined' && segmentLayer) {
                 // Focus op segment met padding onderin
                 map.fitBounds(segmentLayer.getBounds(), { paddingTopLeft: [20, 20], paddingBottomRight: [20, 300] });
            } else if (typeof polyline !== 'undefined' && polyline) {
                 // Focus op hele rit met padding onderin
                 map.fitBounds(polyline.getBounds(), { paddingTopLeft: [20, 20], paddingBottomRight: [20, 300] });
            } else {
                 // Geen rit/segment geladen? Centreer op Eeklo / België!
                 map.setView([51.185, 3.565], 11);
            }
        }

        if(tabName === 'routes') { initRouteMap(); updateSavedRoutesList(); } 
        if(tabName === 'municipalities') {
            initMuniMap(); 
            setWorldMode(currentWorldMode);
        }
    }, 150);

    if(tabName === 'dashboard') updateDashboard();
    if(tabName === 'recap') updateRecapView();
    if(tabName === 'rankings') loadRankings();
    if(tabName === 'achievements') window.renderAchievements();
}

// --- ROUTE PLANNER LOGICA ---
function initRouteMap() {
    if (routeMap) { routeMap.invalidateSize(); return; }
    routeMap = L.map('map-routes').setView([50.85, 4.35], 8);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(routeMap);
    routeMap.on('click', handleRouteMapClick);
}

async function handleRouteMapClick(e) {
    addRouteWaypoint(e.latlng);
}

async function addRouteWaypoint(latlng) {
    const marker = L.marker(latlng, {draggable: true}).addTo(routeMap);
    const index = waypoints.length;
    
    marker.on('dragend', async (e) => {
        waypoints[index].latlng = e.target.getLatLng();
        await recalculateFullRoute();
    });

    waypoints.push({ marker: marker, latlng: latlng });

    if (waypoints.length > 1) {
        const prev = waypoints[waypoints.length - 2].latlng;
        await calculateRouteSegment(prev, latlng);
    }
}

async function calculateRouteSegment(start, end) {
    const url = `https://routing.openstreetmap.de/routed-bike/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson`;
    try {
        const res = await fetch(url);
        const data = await res.json();
        if (data.routes && data.routes.length > 0) {
            routeSegments.push(data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]));
        } else {
            routeSegments.push([[start.lat, start.lng], [end.lat, end.lng]]);
        }
        drawFullRoute();
    } catch (e) {
        routeSegments.push([[start.lat, start.lng], [end.lat, end.lng]]);
        drawFullRoute();
    }
}

async function recalculateFullRoute() {
    routeSegments = [];
    for (let i = 1; i < waypoints.length; i++) {
        const start = waypoints[i-1].latlng;
        const end = waypoints[i].latlng;
        const url = `https://routing.openstreetmap.de/routed-bike/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson`;
        try {
            const res = await fetch(url);
            const data = await res.json();
            if (data.routes && data.routes.length > 0) {
                routeSegments.push(data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]));
            } else {
                routeSegments.push([[start.lat, start.lng], [end.lat, end.lng]]);
            }
        } catch(e) { routeSegments.push([[start.lat, start.lng], [end.lat, end.lng]]); }
    }
    drawFullRoute();
}

// IN ui.js - VERVANG DEZE FUNCTIE
function drawFullRoute() {
    if (routePolyline) routeMap.removeLayer(routePolyline);
    
    // Alle coordinaten van alle segmenten samenvoegen
    // Let op: routeSegments bevat [[lat,lon], [lat,lon]...]
    const fullPath = routeSegments.flat();
    
    // Teken de lijn
    routePolyline = L.polyline(fullPath, {color: '#fc4c02', weight: 5}).addTo(routeMap);
    
    // Update afstand en tijd
    updateRouteStats(fullPath);
    
    // NIEUW: Update Hoogtemeters
    fetchElevationForRoute(fullPath);
}

function updateRouteStats(latlngs) {
    let totalDist = 0;
    for(let i=1; i<latlngs.length; i++) {
        totalDist += routeMap.distance(latlngs[i-1], latlngs[i]);
    }
    const km = (totalDist/1000).toFixed(2);
    document.getElementById('routeDist').innerText = km;
    const hours = (totalDist/1000) / 22;
    const h = Math.floor(hours);
    const m = Math.floor((hours%1)*60).toString().padStart(2,'0');
    document.getElementById('routeTime').innerText = `${h}:${m}`;
}

window.undoLastRoutePoint = function() {
    if (waypoints.length === 0) return;
    const lastPoint = waypoints.pop();
    routeMap.removeLayer(lastPoint.marker);
    if (routeSegments.length > 0) routeSegments.pop();
    drawFullRoute();
    if(waypoints.length === 0) {
        document.getElementById('routeDist').innerText = "0";
        document.getElementById('routeTime').innerText = "0:00";
    }
};

window.clearRoute = function() {
    waypoints.forEach(w => routeMap.removeLayer(w.marker));
    waypoints = [];
    routeSegments = [];
    if(routePolyline) routeMap.removeLayer(routePolyline);
    document.getElementById('routeDist').innerText = "0";
    document.getElementById('routeTime').innerText = "0:00";
    document.getElementById('route-name-input').value = "";
};

window.saveCreatedRoute = async function() {
    if (waypoints.length < 2) { alert("Teken eerst een route!"); return; }
    
    const name = document.getElementById('route-name-input').value || "Mijn Route";
    const btn = document.getElementById('save-route-btn');
    btn.innerText = "Opslaan..."; btn.disabled = true;

    const flatCoords = routeSegments.flat();
    let gpxContent = `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1"><trk><name>${name}</name><trkseg>`;
    flatCoords.forEach(c => { gpxContent += `<trkpt lat="${c[0]}" lon="${c[1]}"></trkpt>`; });
    gpxContent += `</trkseg></trk></gpx>`;
    
    const blob = new Blob([gpxContent], {type: 'application/xml'});
    
    try {
        await window.supabaseAuth.saveActivity({
            fileBlob: blob,
            fileName: name,
            summary: {
                distanceKm: parseFloat(document.getElementById('routeDist').innerText),
    
                // AANGEPAST: Pak de waarde uit de HTML of de globale variabele
                elevationGain: window.currentRouteElevation || parseInt(document.getElementById('routeElev').innerText) || 0,
                
                avgSpeed: 22.0,
                rideDate: new Date().toISOString(),
                segments: [],
                type: 'route' 
            }
        });
        alert("Route opgeslagen!");
        btn.innerText = "💾 Route Opslaan"; btn.disabled = false;
        clearRoute();
        updateSavedRoutesList(); 
        if(window.updateDashboard) window.updateDashboard(); 
    } catch(e) {
        console.error(e);
        alert("Fout bij opslaan: " + e.message);
        btn.innerText = "💾 Route Opslaan"; btn.disabled = false;
    }
};


window.loadSavedRoute = async function(id) {
    clearRoute();
    try {
        const blob = await window.supabaseAuth.getActivityFile(id);
        const text = await blob.text();
        const regex = /lat="([\d\.-]+)"\s+lon="([\d\.-]+)"/g;
        let m; const coords = [];
        while ((m = regex.exec(text)) !== null) { coords.push([parseFloat(m[1]), parseFloat(m[2])]); }
        if (coords.length > 0) {
            routePolyline = L.polyline(coords, {color: '#28a745', weight: 5, dashArray: '10, 10'}).addTo(routeMap);
            routeMap.fitBounds(routePolyline.getBounds());
        }
    } catch(e) { console.error(e); }
};

window.deleteRoute = async function(id) {
    if(confirm("Route definitief verwijderen?")) {
        await window.supabaseAuth.deleteActivities([id]);
        allActivitiesCache = null; 
        updateSavedRoutesList(); 
    }
};

// ui.js - VOLLEDIGE FUNCTIE VERVANGEN
async function updateDashboard() {
    if(!window.supabaseAuth.getCurrentUser()) return;

    window.checkProfileSetup();
    document.getElementById('dashboard-list').innerHTML = `<div class="skeleton skeleton-list-item"></div><div class="skeleton skeleton-list-item"></div>`;
    
    const loaders = `<span class="skeleton skeleton-val" style="width: 60%;"></span>`;
    document.getElementById('total-dist').innerHTML = loaders;
    document.getElementById('total-elev').innerHTML = loaders;
    document.getElementById('total-rides').innerHTML = loaders;
    if(document.getElementById('total-tiles')) document.getElementById('total-tiles').innerHTML = loaders;

    allActivitiesCache = await window.supabaseAuth.listActivities();
    const realRides = allActivitiesCache.filter(a => a.summary.type !== 'route');

    let d=0, e=0;
    realRides.forEach(a => {
        d += parseFloat(a.summary.distanceKm||0);
        e += parseFloat(a.summary.elevationGain||0);
    });

    animateValue("total-dist", 0, d, 1000, " km");
    animateValue("total-elev", 0, e, 1000, " m");
    document.getElementById('total-rides').innerText = realRides.length;

    const user = window.supabaseAuth.getCurrentUser();
    const cacheKey = `heatmap_coords_${user.id}`;
    const heatmapCache = JSON.parse(localStorage.getItem(cacheKey) || "{}");
    const uniqueTiles = new Set();
    Object.values(heatmapCache).forEach(points => {
        points.forEach(p => { uniqueTiles.add(`${Math.floor(p[0] * 100) / 100},${Math.floor(p[1] * 100) / 100}`); });
    });
    if(document.getElementById('total-tiles')) animateValue("total-tiles", 0, uniqueTiles.size, 1000, "");

    const hour = new Date().getHours();
    let greeting = "Goedenacht";
    if (hour >= 6 && hour < 12) greeting = "Goedemorgen";
    else if (hour >= 12 && hour < 18) greeting = "Goedemiddag";
    else if (hour >= 18) greeting = "Goedenavond";
    const userEmail = window.supabaseAuth.getCurrentUser().email.split('@')[0];
    const name = userEmail.charAt(0).toUpperCase() + userEmail.slice(1);
    document.getElementById('welcome-msg').innerText = `${greeting}, ${name}! 👋`;

    document.getElementById('streak-count').innerText = calculateWeeklyStreak(realRides);

    if (typeof currentCalDate === 'undefined') window.currentCalDate = new Date();
    renderCalendar(currentCalDate.getMonth(), currentCalDate.getFullYear());

    renderActivityListBasedOnView();

    // --- NIEUW: Teken de YTD / Maand grafieken op het Dashboard! ---
    renderYTDChart(allActivitiesCache);
    renderMonthlyComparisonChart(allActivitiesCache);
}

// VOLLEDIGE FUNCTIE VERVANGEN (Zonder de YTD grafiek)
async function updateRecapView() {
    document.getElementById('recap-best-list').innerHTML = `<div class="skeleton skeleton-list-item"></div>`;

    if(!allActivitiesCache) allActivitiesCache = await window.supabaseAuth.listActivities();

    const selMonth = document.getElementById('recap-month-select').value;
    const selYear = document.getElementById('recap-year-select').value;
    const monthSelect = document.getElementById('recap-month-select');
    
    if (selYear === 'all') { monthSelect.disabled = true; monthSelect.style.opacity = '0.5'; } 
    else { monthSelect.disabled = false; monthSelect.style.opacity = '1'; }

    const filtered = allActivitiesCache.filter(act => {
        if (act.summary.type === 'route') return false;
        const d = new Date(act.summary.rideDate);
        const yearMatch = selYear === 'all' || d.getFullYear() === parseInt(selYear);
        const monthMatch = (selYear === 'all' || selMonth === 'all') ? true : d.getMonth() === parseInt(selMonth);
        return yearMatch && monthMatch;
    });

    let d=0, e=0, s=0, maxDist = 0, maxElev = 0, maxSpeed = 0;
    filtered.forEach(act => {
        const dist = parseFloat(act.summary.distanceKm) || 0;
        const elev = parseFloat(act.summary.elevationGain) || 0;
        const spd = parseFloat(act.summary.avgSpeed) || 0;
        d += dist; e += elev; s += spd;
        if(dist > maxDist) maxDist = dist;
        if(elev > maxElev) maxElev = elev;
        if(spd > maxSpeed) maxSpeed = spd;
    });

    let title = "Overzicht";
    if (selYear === 'all') title = "🌍 All-Time Overzicht";
    else if (selMonth === 'all') title = `Jaaroverzicht ${selYear}`;
    else title = `${document.getElementById('recap-month-select').options[document.getElementById('recap-month-select').selectedIndex].text} ${selYear}`;
    document.getElementById('recap-period-title').innerText = title;

    document.getElementById('recap-dist').innerText = d.toFixed(0) + ' km';
    document.getElementById('recap-elev').innerText = e.toFixed(0);
    document.getElementById('recap-count').innerText = filtered.length;
    document.getElementById('recap-longest').innerText = maxDist.toFixed(1) + ' km';
    document.getElementById('recap-highest').innerText = maxElev.toFixed(0) + ' m';
    document.getElementById('recap-fastest').innerText = maxSpeed.toFixed(1) + ' km/u';

    const goalKey = selYear === 'all' ? 'goal_all' : (selMonth === 'all' ? `goal_${selYear}` : `goal_${selYear}_${selMonth}`);
    const defaultGoal = selYear === 'all' ? 10000 : (selMonth === 'all' ? 5000 : 400);
    const targetKm = parseFloat(localStorage.getItem(goalKey) || defaultGoal);
    document.getElementById('recap-goal-val').innerText = targetKm;
    document.getElementById('recap-goal-label').innerText = selYear === 'all' ? "Totaaldoel" : (selMonth === 'all' ? "Jaardoel" : "Maanddoel");

    const goalPercent = Math.min(100, (targetKm > 0 ? (d / targetKm) * 100 : 0)).toFixed(1);
    document.getElementById('recap-goal-percent').innerText = goalPercent + '%';
    document.getElementById('recap-goal-fill').style.width = goalPercent + '%';

    // GRAFIEKEN
    renderRecapChart(filtered, selMonth, selYear);
    renderDistributionChart(filtered); 
    
    // (YTD en Maandgrafiek zijn hier succesvol verwijderd, ze staan nu in updateDashboard!)

    const sorted = [...filtered].sort((a,b) => b.summary.distanceKm - a.summary.distanceKm).slice(0, 5);
    document.getElementById('recap-best-list').innerHTML = sorted.map((act, i) => `
        <div class="rank-card" style="border-left: 4px solid ${i===0?'gold':i===1?'silver':i===2?'#cd7f32':'transparent'}" onclick="switchTab('analysis'); window.openRide(${JSON.stringify(act).replace(/"/g, '&quot;')})">
            <div style="flex:1;"><strong>${act.fileName}</strong><br><small>${new Date(act.summary.rideDate).toLocaleDateString()}</small></div>
            <div style="text-align:right; font-size:0.9rem;">
                <span style="display:block; font-weight:bold;">${parseFloat(act.summary.distanceKm).toFixed(1)} km</span>
                <span style="color:var(--text-muted); font-size:0.8rem;">${act.summary.elevationGain}m</span>
            </div>
        </div>`).join('') || '<p style="text-align:center; color:var(--text-muted); padding:20px;">Geen ritten gevonden.</p>';
}

// ui.js - VOLLEDIGE FUNCTIE VERVANGEN (Nu mét werkende Max Hoogte filter)
window.loadRankings = async function(distArg) {
    const listEl = document.getElementById('ranking-list');
    
    // Skeletons tonen
    listEl.innerHTML = `
        <div class="skeleton skeleton-list-item"></div>
        <div class="skeleton skeleton-list-item"></div>
        <div class="skeleton skeleton-list-item"></div>
    `;

    if(!allActivitiesCache) allActivitiesCache = await window.supabaseAuth.listActivities();

    const selector = document.getElementById('segmentSelector');
    const selectedDist = parseInt(distArg || (selector ? selector.value : "5"));
    const trendFilter = document.getElementById('segmentTrendFilter').value;
    
    // 1. HAAL DE INGEVULDE MAX HOOGTE OP
    const maxElevInput = document.getElementById('segmentMaxElev');
    // Als er niks is ingevuld, zetten we het op Infinity (zodat alles wordt getoond)
    const maxElev = maxElevInput && maxElevInput.value ? parseFloat(maxElevInput.value) : Infinity;

    let rankingData = [];

    allActivitiesCache.forEach(act => {
        if (act.summary.type === 'route') return;
        
        // 2. FILTER: Check of de rit onder de maximum hoogtemeters blijft!
        const rideElev = parseFloat(act.summary.elevationGain) || 0;
        if (rideElev > maxElev) return; // Deze rit is te heuvelachtig, we slaan hem over!

        const segs = act.summary.segments || [];
        const match = segs.find(s => parseInt(s.distance) === selectedDist);

        if (match) {
            rankingData.push({
                activity: act,
                speed: match.speed,
                timeMs: match.timeMs,
                date: new Date(act.summary.rideDate)
            });
        }
    });

    rankingData.sort((a,b) => b.speed - a.speed);
    listEl.innerHTML = '';

    if (rankingData.length === 0) {
        listEl.innerHTML = `
            <div style="text-align:center; padding:40px; color:var(--text-muted);">
                <h3>Geen data gevonden</h3>
                <p>Er zijn geen ritten van ${selectedDist} km die voldoen aan je ingestelde maximum klim van ${maxElev !== Infinity ? maxElev + 'm' : ''}.</p>
            </div>`;
        document.getElementById('segment-progression-container').style.display = 'none';
        return;
    }

    listEl.innerHTML = rankingData.map((item, i) => {
        const medal = i===0 ? '🥇' : i===1 ? '🥈' : i===2 ? '🥉' : `#${i+1}`;
        const borderStyle = i===0 ? 'border-left: 4px solid gold;' : i===1 ? 'border-left: 4px solid silver;' : i===2 ? 'border-left: 4px solid #cd7f32;' : '';

        const totSec = Math.floor(item.timeMs / 1000);
        const h = Math.floor(totSec / 3600);
        const m = Math.floor((totSec % 3600) / 60);
        const s = totSec % 60;
        const timeStr = h > 0 ? `${h}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}` : `${m}:${s.toString().padStart(2,'0')}`;

        return `
        <div class="rank-card" style="${borderStyle}" onclick="switchTab('analysis'); window.openRide(${JSON.stringify(item.activity).replace(/"/g, '&quot;')})">
            <div style="display:flex; align-items:center; gap:15px;">
                <span style="font-size:1.5rem; width:40px; text-align:center;">${medal}</span>
                <div>
                    <strong style="font-size:1rem; display:block;">${item.activity.fileName}</strong>
                    <small style="color:var(--text-muted);">📅 ${item.date.toLocaleDateString()} • ⏱️ ${timeStr}</small>
                </div>
            </div>
            <div style="text-align:right;">
                <strong style="font-size:1.4rem; color:var(--primary);">${item.speed.toFixed(1)} <small>km/u</small></strong>
            </div>
        </div>`;
    }).join('');

    const chartContainer = document.getElementById('segment-progression-container');
    if (rankingData.length > 1) {
        chartContainer.style.display = 'block';
        updateTrendChart(rankingData); 
    } else {
        chartContainer.style.display = 'none';
    }
};

// VOLLEDIGE FUNCTIE VERVANGEN
async function updateSavedRoutesList() {
    const list = document.getElementById('saved-routes-list');
    if(!list) return;
    
    // Skeleton tonen
    list.innerHTML = `<div class="skeleton skeleton-list-item"></div>`;
    
    if(!allActivitiesCache) allActivitiesCache = await window.supabaseAuth.listActivities();
    const routes = allActivitiesCache.filter(a => a.summary.type === 'route');
    
    if(routes.length === 0) { 
        list.innerHTML = '<small style="color:var(--text-muted); padding:10px;">Nog geen routes.</small>'; 
        return; 
    }
    
    list.innerHTML = routes.map(r => `
        <div class="dash-list-item" style="flex-direction:column; align-items:flex-start;">
            <div style="display:flex; justify-content:space-between; width:100%; align-items:center;">
                <strong>${r.fileName}</strong>
                <button class="delete-btn" style="padding:2px 6px; font-size:0.7rem;" onclick="deleteRoute('${r.id}')">🗑️</button>
            </div>
            <div style="font-size:0.8rem; color:var(--text-muted); display:flex; justify-content:space-between; width:100%; margin-top:5px;">
                <span>${parseFloat(r.summary.distanceKm).toFixed(1)} km</span>
                <span style="color:var(--primary); cursor:pointer;" onclick="loadSavedRoute('${r.id}')">👁️ Kaart</span>
            </div>
        </div>`).join('');
}

renderCalendar(currentCalDate.getMonth(), currentCalDate.getFullYear());

// --- NIEUW: Paginatie & Lijst Logica ---
window.filterActivities = function() {
    currentActivityPage = 1; // Als je zoekt, ga altijd terug naar pagina 1
    renderActivityListBasedOnView();
};

window.changeActivityPage = function(dir) {
    currentActivityPage += dir;
    renderActivityListBasedOnView();
};

function renderActivityListBasedOnView() {
    let list = allActivitiesCache || [];
    const term = document.getElementById('activity-search').value.toLowerCase();

    // 1. Zoeken toepassen
    if (term) {
        list = list.filter(a => a.fileName.toLowerCase().includes(term));
    }

    // 2. Paginatie wiskunde
    const totalPages = Math.ceil(list.length / ACTIVITY_PAGE_SIZE) || 1;
    if (currentActivityPage > totalPages) currentActivityPage = totalPages;
    if (currentActivityPage < 1) currentActivityPage = 1;

    const startIndex = (currentActivityPage - 1) * ACTIVITY_PAGE_SIZE;
    const endIndex = startIndex + ACTIVITY_PAGE_SIZE;
    const pageList = list.slice(startIndex, endIndex);

    // 3. UI updaten
    const pageInfo = document.getElementById('page-info');
    const prevBtn = document.getElementById('prev-page-btn');
    const nextBtn = document.getElementById('next-page-btn');

    if (pageInfo) pageInfo.innerText = `Pagina ${currentActivityPage} / ${totalPages}`;
    if (prevBtn) prevBtn.disabled = currentActivityPage === 1;
    if (nextBtn) nextBtn.disabled = currentActivityPage === totalPages;

    // 4. Lijst renderen
    renderActivityList(pageList);
}

// --- NIEUW: Kalender Logica ---
window.changeCalendarMonth = function(dir) {
    currentCalDate.setMonth(currentCalDate.getMonth() + dir);
    renderCalendar(currentCalDate.getMonth(), currentCalDate.getFullYear());
};

function renderCalendar(month, year) {
    const grid = document.getElementById('calendar-grid');
    const title = document.getElementById('calendar-month-year');
    if(!grid || !title) return;

    const months = ['Januari', 'Februari', 'Maart', 'April', 'Mei', 'Juni', 'Juli', 'Augustus', 'September', 'Oktober', 'November', 'December'];
    title.innerText = `${months[month]} ${year}`;

    // 1. Dagen van de week header
    let html = ['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo'].map(d => `<div class="calendar-day-name">${d}</div>`).join('');

    // 2. Bepaal start offset (Maandag = 0, Zondag = 6)
    const firstDay = new Date(year, month, 1).getDay();
    const offset = firstDay === 0 ? 6 : firstDay - 1; 
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // 3. Lege vakjes voor de 1e dag
    for (let i = 0; i < offset; i++) {
        html += `<div class="calendar-day empty"></div>`;
    }

    // 4. Zoek actieve fietsdagen
    const activeDays = new Map();
    if (allActivitiesCache) {
        allActivitiesCache.forEach(act => {
            if(act.summary.type === 'route') return;
            const d = new Date(act.summary.rideDate);
            // Als de rit in de getoonde maand valt, bewaar hem op de "dag"
            if (d.getMonth() === month && d.getFullYear() === year) {
                activeDays.set(d.getDate(), act);
            }
        });
    }

    // 5. Genereer de dagen
    for (let day = 1; day <= daysInMonth; day++) {
        if (activeDays.has(day)) {
            const act = activeDays.get(day);
            // Bij een klik op een gereden dag, openen we direct dat rapport!
            html += `<div class="calendar-day active-day" title="${act.fileName}" onclick='switchTab("analysis"); window.openRide(${JSON.stringify(act).replace(/"/g, '&quot;')})'>${day}</div>`;
        } else {
            html += `<div class="calendar-day">${day}</div>`;
        }
    }

    grid.innerHTML = html;
}

// 3. NIEUWE FUNCTIE: KNOP "TOON ALLES"
window.toggleActivityView = function() {
    isShowingAll = !isShowingAll;
    const btn = document.getElementById('toggle-view-btn');
    
    if (isShowingAll) {
        btn.innerText = "⬆️ Toon Minder";
        btn.style.background = "var(--primary)";
    } else {
        btn.innerText = "⬇️ Toon Alles";
        btn.style.background = "var(--bg-nav)";
        document.getElementById('activity-search').value = ""; // Reset zoekbalk
    }
    
    renderActivityListBasedOnView();
};

// 4. NIEUWE FUNCTIE: ZOEKBALK
window.filterActivities = function() {
    renderActivityListBasedOnView();
};

// 5. UPDATE DE RENDER FUNCTIE (Kleine update voor styling)
window.renderActivityList = function(acts) {
    const list = document.getElementById('dashboard-list');
    if(!list) return;
    
    if (acts.length === 0) {
        list.innerHTML = '<div style="padding:15px; text-align:center; color:var(--text-muted);">Geen activiteiten gevonden.</div>';
        return;
    }

    list.innerHTML = acts.map(act => {
        // Icon based on type
        const icon = act.summary.type === 'route' ? '✏️' : '🚴';
        const detail = act.summary.type === 'route' 
            ? 'Route' 
            : `${new Date(act.summary.rideDate).toLocaleDateString()}`;

        return `
        <div class="dash-list-item" style="align-items:center;">
            <input type="checkbox" class="list-checkbox" style="width:20px; height:20px; margin-right:15px; cursor:pointer; pointer-events:auto;" 
                onchange="toggleSelection('${act.id}')" ${selectedRides.has(act.id)?'checked':''}>
            
            <div style="flex:1; display:flex; justify-content:space-between; align-items:center; cursor:pointer;" 
                onclick="if(event.target.type !== 'checkbox') { switchTab('analysis'); window.openRide(${JSON.stringify(act).replace(/"/g, '&quot;')}); }">
                
                <div style="display:flex; flex-direction:column;">
                    <strong>${icon} ${act.fileName}</strong>
                    <small style="font-size:0.75rem;">${detail}</small>
                </div>
                
                <span style="font-weight:bold; color:var(--primary);">${parseFloat(act.summary.distanceKm).toFixed(1)} km</span>
            </div>
        </div>`;
    }).join('');
};
// --- NIEUWE HULPFUNCTIES VOOR DASHBOARD ---

// Telt hoeveel aaneengesloten weken je hebt gefietst
function calculateWeeklyStreak(activities) {
    if (activities.length === 0) return 0;
    
    // Haal unieke weeknummers op (Jaar-Week)
    const weeks = new Set();
    activities.forEach(act => {
        const date = new Date(act.summary.rideDate);
        const onejan = new Date(date.getFullYear(), 0, 1);
        const week = Math.ceil((((date.getTime() - onejan.getTime()) / 86400000) + onejan.getDay() + 1) / 7);
        weeks.add(`${date.getFullYear()}-${week}`);
    });
    
    // Simpele logica: voor nu gewoon het aantal unieke weken dat je actief was
    // (Echte streak logica is complexer met gaten vullen, dit is een 'consistency score')
    return weeks.size; 
}

// ui.js - Nieuwe Achievements Logica (Inclusief Tijd!)
window.renderAchievements = function() {
    const container = document.getElementById('achievements-page-container');
    if(!container) return;

    if(!allActivitiesCache) return;

    // 1. Basis stats berekenen
    const realRides = allActivitiesCache.filter(a => a.summary.type !== 'route');
    let totalDist = 0;
    let maxSingleDist = 0;
    let totalElev = 0;
    let maxSingleElev = 0;
    let totalTimeSec = 0;
    let maxSingleTimeSec = 0;
    
    realRides.forEach(a => {
        const d = parseFloat(a.summary.distanceKm || 0);
        const e = parseFloat(a.summary.elevationGain || 0);
        const t = parseFloat(a.summary.durationSec || 0); // Tijd in seconden
        
        totalDist += d;
        totalElev += e;
        totalTimeSec += t;
        
        if (d > maxSingleDist) maxSingleDist = d;
        if (e > maxSingleElev) maxSingleElev = e;
        if (t > maxSingleTimeSec) maxSingleTimeSec = t;
    });

    // Reken de tijd om naar uren voor makkelijkere vergelijking
    const totalTimeHours = totalTimeSec / 3600;
    const maxSingleTimeHours = maxSingleTimeSec / 3600;

    // We maken groepen (categorieën) aan voor het overzicht
    const categories = [
        { id: 'total-dist', title: '🌍 Totale Afstand', achievements: [] },
        { id: 'single-ride', title: '🚴 Langste Enkele Rit', achievements: [] },
        { id: 'total-elev', title: '⛰️ Totale Hoogtemeters', achievements: [] },
        { id: 'single-elev', title: '🏔️ Klimgeit (Enkele Rit)', achievements: [] },
        { id: 'total-time', title: '⏱️ Totale Tijd in het Zadel', achievements: [] },
        { id: 'single-time', title: '⏳ Uithoudingsvermogen (Enkele Rit)', achievements: [] }
    ];

    // =========================================================
    // CATEGORIE 1: TOTALE AFSTAND
    // =========================================================
    const totalMilestones = [
        { dist: 10, icon: '🚲', name: 'De Eerste Meters' },
        { dist: 50, icon: '🥉', name: 'Op Dreef' },
        { dist: 100, icon: '💯', name: 'Honderdklapper' },
        { dist: 200, icon: '✌️', name: 'Dubbele Century' },
        { dist: 500, icon: '🥈', name: 'Halve Duizend' },
        { dist: 1000, icon: '🥇', name: 'Kilometervreter' }
    ];

    for (let d = 1500; d <= 10000; d += 500) {
        let icon = '🚀';
        let name = `${d} km Club`;
        if (d === 5000) { icon = '🌍'; name = 'Wereldreiziger'; }
        if (d === 10000) { icon = '👑'; name = 'Koning van de Weg'; }
        totalMilestones.push({ dist: d, icon: icon, name: name });
    }

    totalMilestones.forEach(m => {
        categories[0].achievements.push({
            icon: m.icon, name: m.name,
            desc: `Fiets in totaal ${m.dist} kilometer.`,
            unlocked: totalDist >= m.dist
        });
    });

    // =========================================================
    // CATEGORIE 2: ENKELE RIT (Afstand)
    // =========================================================
    for (let d = 10; d <= 200; d += 10) {
        let icon = '🔥';
        let name = `${d} km Rit`;

        if (d === 50) { icon = '🥉'; name = 'Halve Fondo'; }
        if (d === 100) { icon = '🥈'; name = 'Gran Fondo'; }
        if (d === 150) { icon = '🥇'; name = 'Epic Fondo'; }
        if (d === 200) { icon = '🦄'; name = 'Double Century'; }

        categories[1].achievements.push({
            icon: icon, name: name,
            desc: `Voltooi een enkele rit van minimaal ${d} kilometer.`,
            unlocked: maxSingleDist >= d
        });
    }

    // =========================================================
    // CATEGORIE 3: TOTALE HOOGTEMETERS
    // =========================================================
    const elevMilestones = [
        { elev: 500, icon: '🧗', name: 'Klimmer in de Dop' },
        { elev: 1000, icon: '⛰️', name: 'Berggeit' },
        { elev: 2500, icon: '🚠', name: 'Kabelbaan' },
        { elev: 5000, icon: '☁️', name: 'In de Wolken' },
        { elev: 8848, icon: '🏔️', name: 'Everesting' },
        { elev: 10000, icon: '🦅', name: 'Adelaarsnest' },
        { elev: 20000, icon: '✈️', name: 'Vlieghoogte' },
        { elev: 50000, icon: '🚀', name: 'Stratosfeer' }
    ];

    elevMilestones.forEach(m => {
        categories[2].achievements.push({
            icon: m.icon, name: m.name,
            desc: `Klim in totaal ${m.elev.toLocaleString('nl-NL')} meter.`,
            unlocked: totalElev >= m.elev
        });
    });

    // =========================================================
    // CATEGORIE 4: ENKELE RIT (Hoogtemeters)
    // =========================================================
    const singleElevMilestones = [
        { elev: 100, icon: '🎢', name: 'Rollercoaster' },
        { elev: 250, icon: '🚵', name: 'Vlaamse Ardennen' },
        { elev: 500, icon: '🔥', name: 'Brandende Kuiten' },
        { elev: 1000, icon: '🐐', name: 'Echte Berggeit' },
        { elev: 1500, icon: '🥵', name: 'De Muur' },
        { elev: 2000, icon: '🏔️', name: 'Alpenkoning' }
    ];

    singleElevMilestones.forEach(m => {
        categories[3].achievements.push({
            icon: m.icon, name: m.name,
            desc: `Klim minimaal ${m.elev.toLocaleString('nl-NL')} meter tijdens één rit.`,
            unlocked: maxSingleElev >= m.elev
        });
    });

    // =========================================================
    // CATEGORIE 5: TOTALE TIJD IN HET ZADEL
    // =========================================================
    const totalTimeMilestones = [
        { hours: 10, icon: '⏱️', name: 'De Kop is Eraf' },
        { hours: 24, icon: '🌙', name: 'Een Volle Dag' },
        { hours: 50, icon: '🥉', name: 'Flink op Weg' },
        { hours: 100, icon: '🥈', name: 'Honderd Uur' },
        { hours: 250, icon: '🥇', name: 'Fanatiekeling' },
        { hours: 500, icon: '🦄', name: 'Stalen Zitvlak' },
        { hours: 1000, icon: '👑', name: 'Veteraan' }
    ];

    totalTimeMilestones.forEach(m => {
        categories[4].achievements.push({
            icon: m.icon, name: m.name,
            desc: `Zit in totaal ${m.hours} uur op de fiets.`,
            unlocked: totalTimeHours >= m.hours
        });
    });

    // =========================================================
    // CATEGORIE 6: ENKELE RIT (Tijd)
    // =========================================================
    const singleTimeMilestones = [
        { hours: 1, icon: '🚴', name: 'Even Eruit' },
        { hours: 2, icon: '✌️', name: 'Twee Uur Trappen' },
        { hours: 3, icon: '🥉', name: 'Drie Uur Afzien' },
        { hours: 4, icon: '🥈', name: 'Halve Werkdag' },
        { hours: 5, icon: '🥇', name: 'Uithoudingsvermogen' },
        { hours: 6, icon: '🥵', name: 'Zes Uur Zwoegen' },
        { hours: 8, icon: '🛠️', name: 'Volle Werkdag' },
        { hours: 10, icon: '☠️', name: 'Ultra Fietser' }
    ];

    singleTimeMilestones.forEach(m => {
        categories[5].achievements.push({
            icon: m.icon, name: m.name,
            desc: `Fiets minimaal ${m.hours} uur onafgebroken in één rit.`,
            unlocked: maxSingleTimeHours >= m.hours
        });
    });

    // =========================================================
    // 3. RENDEREN NAAR HTML MET KOPJES
    // =========================================================
    container.innerHTML = categories.map(cat => {
        
        const badgesHTML = cat.achievements.map(ach => {
            const opacity = ach.unlocked ? '1' : '0.4';
            const filter = ach.unlocked ? 'none' : 'grayscale(100%)';
            const bg = ach.unlocked ? 'var(--bg-body)' : 'var(--hover-bg)';
            const border = ach.unlocked ? '2px solid var(--primary)' : '1px dashed var(--border-color)';

            return `
                <div class="badge-item clickable-badge" style="opacity: ${opacity}; filter: ${filter}; background: ${bg}; border: ${border}; width: 100%; height: 100%; padding: 20px 10px; cursor: pointer;" onclick="openBadgeModal(${JSON.stringify(ach).replace(/"/g, '&quot;')})">
                    <div class="badge-icon" style="font-size: 3rem;">${ach.icon}</div>
                    <div class="badge-name" style="font-size: 1rem; margin-top: 10px;">${ach.name}</div>
                    <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 5px; padding: 0 5px;">
                        ${ach.unlocked ? '✅ Ontgrendeld' : '🔒 Vergrendeld'}
                    </div>
                </div>
            `;
        }).join('');

        return `
            <div style="margin-bottom: 50px;">
                <h3 style="margin-bottom: 20px; font-size: 1.5rem; color: var(--text-main); border-bottom: 2px solid var(--border-color); padding-bottom: 10px;">
                    ${cat.title}
                </h3>
                <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 20px;">
                    ${badgesHTML}
                </div>
            </div>
        `;
    }).join('');
};

// Leuke teller animatie
function animateValue(id, start, end, duration, suffix = "") {
    const obj = document.getElementById(id);
    if (!obj) return;
    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        // Easing functie voor soepel verloop
        const ease = 1 - Math.pow(1 - progress, 3); 
        const val = Math.floor(progress * (end - start) + start);
        obj.innerHTML = val + suffix;
        if (progress < 1) {
            window.requestAnimationFrame(step);
        } else {
            // Zorg dat het eindgetal exact klopt (met decimalen als nodig)
            obj.innerHTML = (end % 1 === 0 ? end : end.toFixed(0)) + suffix;
        }
    };
    window.requestAnimationFrame(step);
}

function renderRecapChart(activities, monthMode, year) {
    const ctx = document.getElementById('recapComparisonChart').getContext('2d');
    if (activeCharts['recap']) activeCharts['recap'].destroy();

    let labels = [], dataPoints = [], labelText = "", chartType = 'line';

    if (year === 'all') {
        // --- ALL TIME: Gegroepeerd per jaar ---
        labelText = `Afstand per jaar`;
        
        // Zoek alle unieke jaren in je ritten
        const yearsMap = {};
        activities.forEach(act => {
            const y = new Date(act.summary.rideDate).getFullYear();
            if (!yearsMap[y]) yearsMap[y] = 0;
            yearsMap[y] += parseFloat(act.summary.distanceKm);
        });
        
        labels = Object.keys(yearsMap).sort(); // Sorteer jaren oud -> nieuw
        dataPoints = labels.map(y => yearsMap[y]);
        
        // Grafiek hack: als je maar 1 jaar gefietst hebt, voeg een leeg 
        // vorig jaar toe, anders tekent hij maar 1 stipje in plaats van een lijn.
        if(labels.length === 1) {
            labels.unshift((parseInt(labels[0])-1).toString());
            dataPoints.unshift(0);
        }

    } else if (monthMode === 'all') {
        // --- JAAR: Gegroepeerd per maand ---
        labelText = `Afstand per maand (${year})`;
        labels = ['Jan', 'Feb', 'Mrt', 'Apr', 'Mei', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec'];
        dataPoints = new Array(12).fill(0);
        activities.forEach(act => {
            const m = new Date(act.summary.rideDate).getMonth();
            dataPoints[m] += parseFloat(act.summary.distanceKm);
        });
    } else {
        // --- MAAND: Gegroepeerd per week ---
        labelText = `Afstand per week`;

        const yearNum = parseInt(year);
        const monthIdx = parseInt(monthMode);
        const firstDay = new Date(yearNum, monthIdx, 1);
        const dayOfWeek = firstDay.getDay(); 
        const offset = (dayOfWeek === 0) ? 6 : dayOfWeek - 1;
        const daysInMonth = new Date(yearNum, monthIdx + 1, 0).getDate();
        const totalWeeks = Math.ceil((daysInMonth + offset) / 7);

        labels = Array.from({length: totalWeeks}, (_, i) => `Week ${i + 1}`);
        dataPoints = new Array(totalWeeks).fill(0);

        activities.forEach(act => {
            const dateObj = new Date(act.summary.rideDate);
            const d = dateObj.getDate();
            const weekIndex = Math.floor((d - 1 + offset) / 7);
            dataPoints[weekIndex] += parseFloat(act.summary.distanceKm);
        });
    }

    activeCharts['recap'] = new Chart(ctx, {
        type: chartType,
        data: {
            labels: labels,
            datasets: [{
                label: labelText,
                data: dataPoints,
                backgroundColor: 'rgba(252, 76, 2, 0.5)',
                borderColor: '#fc4c02',
                borderWidth: 2,
                borderRadius: 4,
                tension: 0.3,
                fill: true // Zorgt voor de vulling
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: { y: { beginAtZero: true }, x: { grid: { display: false } } },
            plugins: { legend: { display: false } }
        }
    });
}

// NIEUWE FUNCTIE: Verdeelt ritten in categorieën
function renderDistributionChart(activities) {
    const ctx = document.getElementById('recapDistributionChart').getContext('2d');
    if (activeCharts['distrib']) activeCharts['distrib'].destroy();

    let short = 0, medium = 0, long = 0, epic = 0;

    activities.forEach(act => {
        const d = parseFloat(act.summary.distanceKm);
        if (d < 30) short++;
        else if (d < 60) medium++;
        else if (d < 100) long++;
        else epic++;
    });

    activeCharts['distrib'] = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Kort (<30km)', 'Middel (30-60km)', 'Lang (60-100km)', 'Epic (>100km)'],
            datasets: [{
                data: [short, medium, long, epic],
                backgroundColor: ['#28a745', '#17a2b8', '#ffc107', '#dc3545'],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'right', labels: { boxWidth: 10, font: { size: 10 } } }
            },
            cutout: '60%'
        }
    });
}

async function initMuniMap() {
    if (muniMap) { muniMap.invalidateSize(); return; }
    muniMap = L.map('map-municipalities').setView([50.85, 4.35], 8);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png').addTo(muniMap);
    loadFeatures();
}

async function loadFeatures() {
    let allF = [];
    const loading = document.getElementById('muni-loading');
    if(loading) loading.style.display = 'block';
    for(const r of REGIONS) {
        try {
            const res = await fetch(r.url);
            let data = await res.json();
            if (r.type === 'topojson') data = topojson.feature(data, data.objects[Object.keys(data.objects)[0]]);
            data.features.forEach(f => {
                let n = "Onbekend";
                for(const field of r.nameFields) { if(f.properties[field]) { n = f.properties[field]; break; } }
                f.properties.muniName = `${n} (${r.code.toUpperCase()})`; 
            });
            allF.push(...data.features);
        } catch (e) {}
    }
    if(geoJsonLayer && muniMap) muniMap.removeLayer(geoJsonLayer);
    geoJsonLayer = L.geoJSON({ type: "FeatureCollection", features: allF }, {
        onEachFeature: (f, l) => { l.muniName = f.properties.muniName; l.bindTooltip(l.muniName, { sticky: true }); }
    }).addTo(muniMap);
    const names = await window.supabaseAuth.getConqueredMunicipalities();
    conqueredMunis = new Set(names);
    updateMuniUI();
    if(loading) loading.style.display = 'none';
}

function updateMuniUI() {
    if(!geoJsonLayer) return;
    const total = geoJsonLayer.getLayers().length;
    // Gebruik de nieuwe stats functie
    updateWorldStats('muni', conqueredMunis.size, total);
    
    geoJsonLayer.eachLayer(l => {
        if (conqueredMunis.has(l.muniName)) l.setStyle({ fillColor: '#fc4c02', fillOpacity: 0.7, color: '#d94002', weight: 2 });
        else l.setStyle({ fillColor: 'transparent', color: 'transparent', weight: 0 });
    });
}

window.openRideFromHeatmap = function(act) { heatmapMap.closePopup(); switchTab('analysis'); window.openRide(act); };


window.switchRankingTab = async function(tab) {
    document.querySelectorAll('.sub-nav-btn').forEach(b => b.classList.toggle('active', b.onclick.toString().includes(tab)));
    document.querySelectorAll('.rank-tab-content').forEach(c => c.classList.toggle('hidden', !c.id.includes(tab)));
    
    if(!allActivitiesCache) allActivitiesCache = await window.supabaseAuth.listActivities();
    
    if(tab === 'segments') loadRankings(document.getElementById('segmentSelector').value);
    else if(tab === 'distance') renderTrendGraph(allActivitiesCache, 'distanceKm', 'distance-table-body', 'distanceTrendChart', 'distanceTopFilter', 'Afstand (km)');
    else if(tab === 'elevation') renderTrendGraph(allActivitiesCache, 'elevationGain', 'elevation-table-body', 'elevationTrendChart', 'elevationTopFilter', 'Hoogte (m)');
    else if(tab === 'speed') renderTrendGraph(allActivitiesCache, 'maxSpeed', 'speed-table-body', 'speedTrendChart', 'speedTopFilter', 'Max Snelheid (km/u)');
    // NIEUW: Suffer Score inladen!
    else if(tab === 'suffer') {
        calculateSufferScores(); // Bereken actuele 1-100 scores
        renderTrendGraph(allActivitiesCache, 'sufferScore', 'suffer-table-body', 'sufferTrendChart', 'sufferTopFilter', 'Suffer Score (1-100)');
    }
};


function renderTrendGraph(activities, key, tableId, chartId, filterId, label) {
    const fv = document.getElementById(filterId)?.value || 'all';
    
    // 1. SORTEREN: Hoogste waarde eerst (rekening houdend met lege waardes)
    let r = [...activities.filter(a => a.summary.type !== 'route')].sort((a, b) => {
        const valA = parseFloat(a.summary[key]) || 0;
        const valB = parseFloat(b.summary[key]) || 0;
        return valB - valA;
    });
    
    // Filter aantal (Top 5, Top 10, etc.)
    if(fv !== 'all') r = r.slice(0, parseInt(fv));
    
    // 2. GRAFIEK DATA: Chronologisch sorteren voor de lijn
    const ch = [...r].sort((a,b) => new Date(a.summary.rideDate) - new Date(b.summary.rideDate));
    const v = ch.map(a => parseFloat(a.summary[key]) || 0);
    const tr = calculateTrendLine(v);
    
    // Teken Grafiek
    const ctx = document.getElementById(chartId).getContext('2d');
    if(activeCharts[chartId]) activeCharts[chartId].destroy();
    
    activeCharts[chartId] = new Chart(ctx, {
        type: 'line',
        data: {
            labels: ch.map(a => new Date(a.summary.rideDate).toLocaleDateString()),
            datasets: [
                { label: label, data: v, borderColor: '#fc4c02', fill: true, tension: 0.2, backgroundColor: 'rgba(252,76,2,0.1)' }, 
                { label: 'Trend', data: tr, borderColor: '#333', borderDash: [5,5], fill: false, pointRadius:0 }
            ]
        },
        options: { responsive: true, maintainAspectRatio: false }
    });
    
    // 3. TABEL VULLEN
    const tb = document.getElementById(tableId);
    if(tb) {
        tb.innerHTML = `
        <div class="table-container">
            <table class="data-table">
                <thead><tr><th>#</th><th>Naam</th><th>Datum</th><th>${label}</th></tr></thead>
                <tbody>
                    ${r.map((act, i) => {
                        // ui.js (binnen renderTrendGraph)
                        const val = parseFloat(act.summary[key]) || 0;
                        
                        // GECORRIGEERD: Gebruik de contrasterende CSS-variabelen voor de tekstkleur
                        const color = i===0 ? 'var(--medal-text-gold)' : i===1 ? 'var(--medal-text-silver)' : i===2 ? 'var(--medal-text-bronze)' : 'var(--text-main)';
                        const weight = i<3 ? '900' : 'bold';
                        
                        return `
                        <tr onclick="switchTab('analysis'); window.openRide(${JSON.stringify(act).replace(/"/g, '&quot;')})">
                            <td style="color:${color}; font-weight:${weight};">#${i+1}</td>
                            <td>${act.fileName}</td>
                            <td>${new Date(act.summary.rideDate).toLocaleDateString()}</td>
                            <td><strong style="color:${color};">${val.toFixed(1)}</strong></td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>
        </div>`;
    }
}


// Helper voor de grafiek (zet deze ook in ui.js)
function updateTrendChart(data) {
    const ctx = document.getElementById('segmentProgressionChart').getContext('2d');
    if(activeCharts['segChart']) activeCharts['segChart'].destroy();

    // Sorteer op datum voor de grafiek
    const chronological = [...data].sort((a,b) => a.date - b.date);
    
    // Pak trend filter (laatste 5, 10, etc)
    const filterVal = document.getElementById('segmentTrendFilter').value;
    const chartData = filterVal === 'all' ? chronological : chronological.slice(-parseInt(filterVal));

    activeCharts['segChart'] = new Chart(ctx, {
        type: 'line',
        data: {
            labels: chartData.map(d => d.date.toLocaleDateString()),
            datasets: [{
                label: 'Snelheid (km/u)',
                data: chartData.map(d => d.speed),
                borderColor: '#28a745',
                backgroundColor: 'rgba(40,167,69,0.1)',
                tension: 0.3,
                fill: true
            }]
        },
        options: { responsive: true, maintainAspectRatio: false }
    });
}

function renderActivityList(acts) {
    const list = document.getElementById('dashboard-list');
    if(!list) return;
    list.innerHTML = acts.map(act => `<div class="dash-list-item"><input type="checkbox" onchange="toggleSelection('${act.id}')" ${selectedRides.has(act.id)?'checked':''}><div style="flex:1; display:flex; justify-content:space-between; margin-left:10px;" onclick="switchTab('analysis'); window.openRide(${JSON.stringify(act).replace(/"/g, '&quot;')})"><strong>${act.fileName}</strong><span>${act.summary.distanceKm} km</span></div></div>`).join('');
}

window.toggleSelection = (id) => { if(selectedRides.has(id)) selectedRides.delete(id); else selectedRides.add(id); document.getElementById('delete-btn').classList.toggle('hidden', selectedRides.size === 0); };
window.deleteSelectedRides = async function() { if(confirm("Verwijderen?")) { await window.supabaseAuth.deleteActivities(Array.from(selectedRides)); selectedRides.clear(); updateDashboard(); } };
window.triggerUpload = () => document.getElementById('gpxInput').click();
window.toggleTheme = () => { 
    document.body.classList.toggle('dark-mode'); 
    localStorage.setItem('theme', document.body.classList.contains('dark-mode') ? 'dark' : 'light'); 
    
    // Voeg deze regel toe om de grafieken opnieuw te kleuren:
    if (window.updateDashboard) window.updateDashboard();
};

window.toggleTiles = function() {
    // Als ze al zichtbaar zijn, verwijder ze dan (toggle)
    if (tileLayerGroup) {
        heatmapMap.removeLayer(tileLayerGroup);
        tileLayerGroup = null;
        document.getElementById('show-tiles-btn').innerText = "🗺️ Toon Tegels";
        return;
    }

    const btn = document.getElementById('show-tiles-btn');
    btn.innerText = "⏳ Berekenen...";

    // Gebruik een timeout zodat de browser de knop tekst kan updaten
    setTimeout(() => {
        drawTilesOnMap();
        btn.innerText = "❌ Verberg Tegels";
    }, 50);
};

function drawTilesOnMap() {
    const user = window.supabaseAuth.getCurrentUser();
    const cacheKey = `heatmap_coords_${user.id}`;
    const heatmapCache = JSON.parse(localStorage.getItem(cacheKey) || "{}");
    
    // Set gebruiken om dubbele tegels te voorkomen
    const uniqueTiles = new Set();

    // 1. Bereken alle unieke vakjes
    Object.values(heatmapCache).forEach(points => {
        points.forEach(p => {
            // We ronden af naar beneden op 2 decimalen (bv 51.234 -> 51.23)
            // Dit creëert een vast raster van ca. 1.1km x 0.7km (in NL/BE)
            const latGrid = Math.floor(p[0] * 100) / 100;
            const lonGrid = Math.floor(p[1] * 100) / 100;
            uniqueTiles.add(`${latGrid},${lonGrid}`);
        });
    });

    // 2. Teken de vakjes
    tileLayerGroup = L.layerGroup();
    
    uniqueTiles.forEach(coordKey => {
        const [lat, lon] = coordKey.split(',').map(parseFloat);
        
        // De hoekpunten van het vierkantje
        const bounds = [
            [lat, lon],             // Linksonder
            [lat + 0.01, lon + 0.01] // Rechtsboven
        ];

        L.rectangle(bounds, {
            color: "#00acc1",       // Randkleur (Teal)
            weight: 1,
            fillColor: "#00acc1",   // Vulkleur
            fillOpacity: 0.2        // Transparant zodat je de kaart nog ziet
        }).addTo(tileLayerGroup);
    });

    // Voeg de laag toe aan de kaart
    if (heatmapMap) {
        tileLayerGroup.addTo(heatmapMap);
        
        // Zoom naar de tegels als er tegels zijn
        if (uniqueTiles.size > 0) {
            // Maak een tijdelijke group om de bounds te berekenen
            // (Leaflet layerGroup heeft geen getBounds, featureGroup wel)
            const group = L.featureGroup(tileLayerGroup.getLayers());
            heatmapMap.fitBounds(group.getBounds());
        }
    } else {
        alert("Open eerst de Heatmap tab.");
    }
}

window.setWorldMode = function(mode) {
    currentWorldMode = mode;
    
    // UI Update
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    const activeBtn = document.querySelector(`.mode-btn[onclick="setWorldMode('${mode}')"]`);
    if(activeBtn) activeBtn.classList.add('active');

    // Kaart opschonen
    if(geoJsonLayer) muniMap.removeLayer(geoJsonLayer);
    if(heatmapLayerGroup) muniMap.removeLayer(heatmapLayerGroup);
    if(tileLayerGroup) muniMap.removeLayer(tileLayerGroup);

    // Knoppen resetten
    document.getElementById('world-action-btn').style.display = 'none';
    document.getElementById('muni-loading').style.display = 'none';

    if (mode === 'muni') {
        loadFeatures(); // Laad gemeentes
    } else if (mode === 'heatmap') {
        document.getElementById('world-action-btn').style.display = 'inline-block';
        updateWorldStats('heatmap');
        // Check cache en teken direct als mogelijk
        const user = window.supabaseAuth.getCurrentUser();
        if(localStorage.getItem(`heatmap_coords_${user.id}`)) drawHeatmap();
    } else if (mode === 'tiles') {
        drawTiles(); // Teken tegels
    }
};

function updateWorldStats(mode, count = 0, total = 0) {
    const textEl = document.getElementById('world-stats-text');
    const fillEl = document.getElementById('world-progress-fill');
    
    if (mode === 'muni') {
        const p = total > 0 ? (count / total * 100).toFixed(1) : 0;
        textEl.innerHTML = `<strong>${count}</strong> / ${total} Gemeentes (${p}%)`;
        fillEl.style.width = `${p}%`;
    } else if (mode === 'heatmap') {
        textEl.innerHTML = `<strong>Heatmap Modus</strong>`;
        fillEl.style.width = `100%`;
    } else if (mode === 'tiles') {
        textEl.innerHTML = `<strong>${count}</strong> Tegels Ontdekt`;
        fillEl.style.width = `100%`;
    }
}

// AANGEPASTE HEATMAP FUNCTIE
window.drawHeatmap = async function() {
    document.getElementById('muni-loading').style.display = 'block';
    
    if(heatmapLayerGroup) muniMap.removeLayer(heatmapLayerGroup);
    heatmapLayerGroup = L.layerGroup().addTo(muniMap);

    let acts = allActivitiesCache || await window.supabaseAuth.listActivities();
    acts = acts.filter(a => a.summary.type !== 'route');
    
    const user = window.supabaseAuth.getCurrentUser();
    const cacheKey = `heatmap_coords_${user.id}`;
    let cached = JSON.parse(localStorage.getItem(cacheKey) || "{}");
    
    for (let i = 0; i < acts.length; i++) {
        let pts = cached[acts[i].id];
        if (!pts) {
            try {
                const b = await window.supabaseAuth.getActivityFile(acts[i].id);
                const t = await b.text();
                const c = []; const r = /lat="([\d\.-]+)"\s+lon="([\d\.-]+)"/g; let m;
                while ((m = r.exec(t)) !== null) c.push([parseFloat(m[1]), parseFloat(m[2])]);
                pts = c.filter((_, idx) => idx % 10 === 0);
                cached[acts[i].id] = pts;
            } catch (e) {}
        }
        if (pts) L.polyline(pts, { color: '#fc4c02', opacity: 0.35, weight: 2.5 }).addTo(heatmapLayerGroup);
    }
    
    localStorage.setItem(cacheKey, JSON.stringify(cached));
    document.getElementById('muni-loading').style.display = 'none';
};

// AANGEPASTE TEGELS FUNCTIE
function drawTiles() {
    const user = window.supabaseAuth.getCurrentUser();
    const cacheKey = `heatmap_coords_${user.id}`;
    const heatmapCache = JSON.parse(localStorage.getItem(cacheKey) || "{}");
    
    const uniqueTiles = new Set();
    Object.values(heatmapCache).forEach(points => {
        points.forEach(p => {
            const latGrid = Math.floor(p[0] * 100) / 100;
            const lonGrid = Math.floor(p[1] * 100) / 100;
            uniqueTiles.add(`${latGrid},${lonGrid}`);
        });
    });

    if(tileLayerGroup) muniMap.removeLayer(tileLayerGroup);
    tileLayerGroup = L.layerGroup().addTo(muniMap);
    
    uniqueTiles.forEach(coordKey => {
        const [lat, lon] = coordKey.split(',').map(parseFloat);
        const bounds = [[lat, lon], [lat + 0.01, lon + 0.01]];
        L.rectangle(bounds, { color: "#00acc1", weight: 1, fillColor: "#00acc1", fillOpacity: 0.3 }).addTo(tileLayerGroup);
    });
    
    updateWorldStats('tiles', uniqueTiles.size);
    if(uniqueTiles.size > 0) {
        const first = Array.from(uniqueTiles)[0].split(',').map(parseFloat);
        muniMap.setView(first, 10);
    }
}
// IN ui.js: Vervang updateStats

function updateStats(dist, timeMs, speed, ele, power, maxSpeed) { // maxSpeed toegevoegd als argument
    const d = document.getElementById('statDist');
    const t = document.getElementById('statTime');
    const s = document.getElementById('statSpeed');
    const e = document.getElementById('statElev');
    const p = document.getElementById('statPower');
    const ms = document.getElementById('statMaxSpeed'); // NIEUW

    if(d) d.innerText = typeof dist === 'string' ? dist : parseFloat(dist).toFixed(2);
    if(e) e.innerText = Math.round(ele);
    
    // Gemiddelde snelheid
    if(s) s.innerText = typeof speed === 'string' ? speed : parseFloat(speed).toFixed(1);
    
    // NIEUW: Max Snelheid invullen
    if(ms) ms.innerText = maxSpeed ? parseFloat(maxSpeed).toFixed(1) : "0.0";

    if(t) { 
        const h = Math.floor(timeMs / 3600000); 
        const m = Math.floor((timeMs % 3600000) / 60000); 
        t.innerText = `${h}:${m.toString().padStart(2,'0')}`; 
    }
    
    if(p) p.innerText = power || 0;
}

// IN ui.js - NIEUWE FUNCTIE
// Haalt hoogte op via Open-Meteo API (max 200 punten om URL lengte te beperken)
async function fetchElevationForRoute(latlngs) {
    const el = document.getElementById('routeElev');
    if(!latlngs || latlngs.length < 2) {
        if(el) el.innerText = "0";
        return;
    }

    if(el) el.innerText = "..."; // Laat zien dat hij aan het laden is

    // 1. Downsampling: We kunnen niet duizenden punten sturen.
    // We pakken maximaal 150 punten gelijkmatig verdeeld over de route.
    const sampleSize = 150;
    const step = Math.ceil(latlngs.length / sampleSize);
    const sampledPoints = latlngs.filter((_, i) => i % step === 0);

    // 2. Bouw de URL
    const lats = sampledPoints.map(p => p[0]).join(',');
    const lons = sampledPoints.map(p => p[1]).join(',');
    const url = `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lons}`;

    try {
        const res = await fetch(url);
        const data = await res.json();
        
        if (data.elevation) {
            // 3. Bereken hoogtemeters (alleen stijging)
            let gain = 0;
            const elevs = data.elevation;
            
            for(let i = 1; i < elevs.length; i++) {
                const diff = elevs[i] - elevs[i-1];
                if(diff > 0) {
                    gain += diff;
                }
            }
            
            // 4. Update UI
            if(el) el.innerText = Math.round(gain);
            
            // Sla op in een globale variabele voor als je opslaat
            window.currentRouteElevation = Math.round(gain);
        }
    } catch (e) {
        console.error("Fout bij ophalen hoogte:", e);
        if(el) el.innerText = "?";
    }
}



// Functie om de badge modal te openen en te vullen
window.openBadgeModal = function(badgeData) {
    const modal = document.getElementById('badge-modal');

    // Vul de modal met de data van de aangeklikte badge
    document.getElementById('modal-badge-name').innerText = badgeData.name;
    document.getElementById('modal-badge-icon').innerText = badgeData.icon;
    
    // FIX: Gebruik badgeData.desc (of explanation voor de zekerheid)
    document.getElementById('modal-badge-desc').innerText = badgeData.desc || badgeData.explanation;

    // Toon de modal
    modal.classList.add('show');

    // Voeg een event listener toe om te sluiten met de Escape-toets
    document.addEventListener('keydown', closeOnEscape);
}
// Functie om de modal te sluiten
window.closeBadgeModal = function(event) {
    const modal = document.getElementById('badge-modal');
    
    // Als event is meegegeven, check of er op de achtergrond is geklikt (niet op de content)
    if (event && event.target !== modal) {
        return;
    }
    
    modal.classList.remove('show');
    // Verwijder de Escape-toets listener
    document.removeEventListener('keydown', closeOnEscape);
}

// Helper functie om te sluiten met Escape
function closeOnEscape(event) {
    if (event.key === 'Escape') {
        closeBadgeModal();
    }
}

// ui.js - NIEUW: Bereken de Suffer Score op een schaal van 1 tot 100
function calculateSufferScores() {
    if (!allActivitiesCache) return;
    
    let maxRaw = 0;
    
    // Stap 1: Bereken de "Ruwe" Pijn Score voor elke rit
    allActivitiesCache.forEach(act => {
        if (act.summary.type === 'route') return;
        
        const dist = parseFloat(act.summary.distanceKm) || 0;
        const elev = parseFloat(act.summary.elevationGain) || 0;
        const spd = parseFloat(act.summary.avgSpeed) || 0;
        
        // DE FORMULE: Afstand is basis, elke 10m stijgen telt als 1 extra km, snelheid telt exponentieel mee.
        const rawScore = (dist * 1.0) + (elev * 0.1) + (Math.pow(spd, 2) * 0.05);
        act.rawSuffer = rawScore;
        
        if (rawScore > maxRaw) maxRaw = rawScore;
    });
    
    // Stap 2: Schaal alles ten opzichte van de zwaarste rit ooit (maxRaw = 100)
    allActivitiesCache.forEach(act => {
        if (act.summary.type === 'route') {
            act.summary.sufferScore = 0;
            return;
        }
        
        if (maxRaw === 0) {
            act.summary.sufferScore = 0;
        } else {
            let scaled = (act.rawSuffer / maxRaw) * 100;
            act.summary.sufferScore = Math.max(1, scaled).toFixed(1); // Minimaal 1 als je gefietst hebt
        }
    });
}

// ui.js - Bereken en Toon Premium Rit Details
window.updatePremiumRideHeader = function(act) {
    if (!act || act.summary.type === 'route') {
        document.getElementById('premium-ride-header').classList.add('hidden');
        return;
    }

    // 1. Toon de header en vul de basis info
    document.getElementById('premium-ride-header').classList.remove('hidden');
    document.getElementById('premium-ride-name').innerText = act.fileName;
    
    // Mooie datum notatie
    const d = new Date(act.summary.rideDate);
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute:'2-digit' };
    document.getElementById('premium-ride-date').innerText = `📅 ${d.toLocaleDateString('nl-NL', options)}`;

    // 2. Bereken de Rank/Records!
    const badgesContainer = document.getElementById('premium-badges');
    badgesContainer.innerHTML = ''; // Maak leeg

    if (!allActivitiesCache) return;
    const rides = allActivitiesCache.filter(a => a.summary.type !== 'route');
    let badgesHTML = '';

    // Helper functie om badges te maken
    const createBadge = (index, total, icon, label) => {
        if (index === -1 || index >= 25) return ''; // Alleen Top 25 tonen
        
        const rank = index + 1;
        let medal = '🏅';
        let colorClass = '';
        
        if (rank === 1) { medal = '🥇'; colorClass = 'gold'; }
        else if (rank === 2) { medal = '🥈'; colorClass = 'silver'; }
        else if (rank === 3) { medal = '🥉'; colorClass = 'bronze'; }

        return `<div class="record-badge ${colorClass}"><span>${medal}</span> ${rank}e ${label}</div>`;
    };

    // Afstand Rank
    const distSorted = [...rides].sort((a,b) => (parseFloat(b.summary.distanceKm)||0) - (parseFloat(a.summary.distanceKm)||0));
    const distIdx = distSorted.findIndex(a => a.id === act.id);
    badgesHTML += createBadge(distIdx, rides.length, '📏', 'Langste Rit');

    // Hoogte Rank
    const elevSorted = [...rides].sort((a,b) => (parseFloat(b.summary.elevationGain)||0) - (parseFloat(a.summary.elevationGain)||0));
    const elevIdx = elevSorted.findIndex(a => a.id === act.id);
    if ((parseFloat(act.summary.elevationGain)||0) > 50) { // Alleen tonen als je daadwerkelijk geklommen hebt
        badgesHTML += createBadge(elevIdx, rides.length, '⛰️', 'Hoogste Rit');
    }

    // Snelheid Rank
    const spdSorted = [...rides].sort((a,b) => (parseFloat(b.summary.avgSpeed)||0) - (parseFloat(a.summary.avgSpeed)||0));
    const spdIdx = spdSorted.findIndex(a => a.id === act.id);
    badgesHTML += createBadge(spdIdx, rides.length, '🚀', 'Snelste Rit');

    // Suffer Score Rank (als deze berekend is)
    if (act.summary.sufferScore) {
        const sufSorted = [...rides].sort((a,b) => (parseFloat(b.summary.sufferScore)||0) - (parseFloat(a.summary.sufferScore)||0));
        const sufIdx = sufSorted.findIndex(a => a.id === act.id);
        badgesHTML += createBadge(sufIdx, rides.length, '🥵', 'Zwaarste Rit');
    }

    badgesContainer.innerHTML = badgesHTML;
};

// ui.js - Gecorrigeerde populateRideSummary (ZONDER VAM, MET Efficiëntie)
window.populateRideSummary = function(act) {
    if (!act || !act.summary) return;

    document.getElementById('sum-title').innerText = act.fileName;
    const d = new Date(act.summary.rideDate);
    document.getElementById('sum-date').innerText = `📅 ${d.toLocaleDateString('nl-NL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute:'2-digit' })}`;

    document.getElementById('sum-dist').innerHTML = `${parseFloat(act.summary.distanceKm).toFixed(1)} <small>km</small>`;
    
    let timeStr = "0:00";
    let elapsedHours = 0;
    let movingHours = 0;

    // Tijd berekenen
    if (act.summary.durationSec) {
        elapsedHours = act.summary.durationSec / 3600;
        const h = Math.floor(elapsedHours);
        const m = Math.floor((act.summary.durationSec % 3600) / 60);
        timeStr = `${h}:${m.toString().padStart(2, '0')}`;
    }
    
    if (act.summary.distanceKm && act.summary.avgSpeed) {
        movingHours = act.summary.distanceKm / act.summary.avgSpeed;
        if (elapsedHours === 0) {
            elapsedHours = movingHours; // Fallback
            const h = Math.floor(elapsedHours);
            const m = Math.floor((elapsedHours % 1) * 60);
            timeStr = `${h}:${m.toString().padStart(2, '0')}`;
        }
    }

    document.getElementById('sum-time').innerText = timeStr;
    document.getElementById('sum-avg').innerHTML = `${parseFloat(act.summary.avgSpeed || 0).toFixed(1)} <small>km/u</small>`;
    document.getElementById('sum-max').innerHTML = `${parseFloat(act.summary.maxSpeed || 0).toFixed(1)} <small>km/u</small>`;
    document.getElementById('sum-elev').innerHTML = `${Math.round(act.summary.elevationGain || 0)} <small>m</small>`;
    document.getElementById('sum-power').innerHTML = `${Math.round(act.summary.avgPower || 0)} <small>W</small>`;


    // Fysisch model voor Vermogen
    const massKg = 85; 
    const avgSpeedMs = parseFloat(act.summary.avgSpeed || 0) / 3.6; 
    let powerW = 0;
    if (avgSpeedMs > 1) { 
        powerW = (0.5 * 1.225 * 0.5 * 1.1 * Math.pow(avgSpeedMs, 3)) + (0.005 * massKg * 9.81 * avgSpeedMs);
    }
    act.summary.avgPower = Math.round(powerW);
    document.getElementById('sum-power').innerHTML = `${act.summary.avgPower} <small>W</small>`;

    // Rankings
    const badgesContainer = document.getElementById('sum-badges');
    badgesContainer.innerHTML = ''; 
    if (allActivitiesCache) {
        const rides = allActivitiesCache.filter(a => a.summary.type !== 'route');
        const createBadge = (index, icon, label) => {
            if (index === -1) return '';
            const rank = index + 1;
            let color = rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : '';
            return `<div class="record-badge ${color}"><span>${icon}</span> <strong>${rank}e</strong> ${label}</div>`;
        };

        const distIdx = [...rides].sort((a,b) => (parseFloat(b.summary.distanceKm)||0) - (parseFloat(a.summary.distanceKm)||0)).findIndex(a => a.id === act.id);
        badgesContainer.innerHTML += createBadge(distIdx, '📏', 'Langste Rit');

        const elevIdx = [...rides].sort((a,b) => (parseFloat(b.summary.elevationGain)||0) - (parseFloat(a.summary.elevationGain)||0)).findIndex(a => a.id === act.id);
        if ((parseFloat(act.summary.elevationGain)||0) > 0) badgesContainer.innerHTML += createBadge(elevIdx, '⛰️', 'Hoogste Rit');

        const spdIdx = [...rides].sort((a,b) => (parseFloat(b.summary.avgSpeed)||0) - (parseFloat(a.summary.avgSpeed)||0)).findIndex(a => a.id === act.id);
        badgesContainer.innerHTML += createBadge(spdIdx, '🚀', 'Snelste Rit');
    }

    // Segmenten
    const segContainer = document.getElementById('sum-segments');
    segContainer.innerHTML = '';
    if (act.summary.segments && act.summary.segments.length > 0) {
        const topSegs = act.summary.segments.slice(0, 3);
        segContainer.innerHTML = topSegs.map(s => `<div class="summary-segment-item"><strong>${s.distance} km Sprint</strong><span style="color:var(--primary); font-weight:bold;">${s.speed.toFixed(1)} km/u</span></div>`).join('');
    } else {
        segContainer.innerHTML = '<p style="color:var(--text-muted); font-size:0.9rem;">Geen segmenten berekend voor deze rit.</p>';
    }
};

// --- NIEUW: Toggle tussen YTD en Per Maand grafieken ---
window.switchCompareChart = function(type) {
    // Knoppen stijlen updaten
    document.getElementById('btn-chart-ytd').style.background = type === 'ytd' ? 'linear-gradient(135deg, #fc4c02 0%, #ff8c00 100%)' : 'var(--bg-nav)';
    document.getElementById('btn-chart-month').style.background = type === 'month' ? 'linear-gradient(135deg, #fc4c02 0%, #ff8c00 100%)' : 'var(--bg-nav)';

    // Grafieken wisselen
    if (type === 'ytd') {
        document.getElementById('wrapper-ytd').classList.remove('hidden');
        document.getElementById('wrapper-month').classList.add('hidden');
    } else {
        document.getElementById('wrapper-ytd').classList.add('hidden');
        document.getElementById('wrapper-month').classList.remove('hidden');
    }
};

// --- GEÜPDATE: Maandelijkse Vergelijking (Als LIJNGRAFIEK in de juiste stijl) ---
function renderMonthlyComparisonChart(activities) {
    const ctx = document.getElementById('monthlyComparisonChart').getContext('2d');
    if (activeCharts['monthlyCompChart']) activeCharts['monthlyCompChart'].destroy();

    const currentYear = new Date().getFullYear();
    const yearlyData = {};

    // 1. Setup lege arrays voor elk jaar dat we vinden
    activities.forEach(act => {
        if (act.summary.type === 'route') return;
        const y = new Date(act.summary.rideDate).getFullYear();
        if (!yearlyData[y]) yearlyData[y] = new Array(12).fill(0);
    });

    if (!yearlyData[currentYear]) yearlyData[currentYear] = new Array(12).fill(0);

    // 2. Vul de ruwe maand-totalen in (Niet opgeteld bij elkaar)
    activities.forEach(act => {
        if (act.summary.type === 'route') return;
        const d = new Date(act.summary.rideDate);
        yearlyData[d.getFullYear()][d.getMonth()] += parseFloat(act.summary.distanceKm) || 0;
    });

    // 3. Bouw de datasets op in dezelfde strakke stijl als YTD
    const sortedYears = Object.keys(yearlyData).sort((a, b) => b - a); // Nieuwste jaar eerst
    const pastColors = ['#888888', '#00acc1', '#28a745', '#ffc107', '#dc3545'];

    const datasets = sortedYears.map((year, index) => {
        const isCurrent = parseInt(year) === currentYear;
        const color = isCurrent ? '#fc4c02' : (pastColors[index - 1] || '#555555');

        return {
            label: `Jaar ${year}`,
            data: yearlyData[year],
            borderColor: color,
            backgroundColor: isCurrent ? 'rgba(252, 76, 2, 0.1)' : 'transparent',
            borderWidth: isCurrent ? 3 : 2,
            borderDash: isCurrent ? [] : [5, 5], // Stippellijn voor oude jaren
            fill: isCurrent, // Huidig jaar wordt ingekleurd onder de lijn
            tension: 0.3,
            pointRadius: isCurrent ? 4 : 0,
            pointBackgroundColor: color,
            order: isCurrent ? 0 : 1
        };
    });

    // Bepaal de kleuren voor de weergave (Dark Mode check)
    const isDark = document.body.classList.contains('dark-mode');
    const chartTextColor = isDark ? '#f0f0f0' : '#333333';
    const chartTextMuted = isDark ? '#aaaaaa' : '#666666';
    const chartGridColor = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';

    // 4. Teken de grafiek als Lijn
    activeCharts['monthlyCompChart'] = new Chart(ctx, {
        type: 'line', // Terug naar lijn in plaats van bar
        data: {
            labels: ['Jan', 'Feb', 'Mrt', 'Apr', 'Mei', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec'],
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { 
                    position: 'top', 
                    labels: { color: chartTextColor, usePointStyle: true, padding: 20 } 
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    titleColor: '#fff',
                    bodyColor: '#fff'
                }
            },
            scales: {
                x: { 
                    grid: { display: false }, 
                    ticks: { color: chartTextMuted } 
                },
                y: { 
                    grid: { color: chartGridColor }, 
                    ticks: { color: chartTextMuted } 
                }
            }
        }
    });
}

window.showMapAnalysis = function() {
    // 1. Wissel de schermen
    document.getElementById('ride-summary-dashboard').classList.add('hidden');
    document.getElementById('ride-map-view').classList.remove('hidden');
    
    // 2. Fix de kaart!
    if (typeof map !== 'undefined' && map) {
        // Geef de browser een fractie van een seconde om de div zichtbaar te maken
        setTimeout(() => {
            map.invalidateSize(); // Vertel Leaflet de nieuwe, echte afmetingen
            
            // Pas de zoom perfect aan op de getekende lijn (polyline)
            if (typeof polyline !== 'undefined' && polyline) {
                map.fitBounds(polyline.getBounds(), {
                    paddingTopLeft: [20, 20],
                    paddingBottomRight: [20, 300], // Ruimte voor de grafiek
                    animate: false // We doen dit zonder animatie zodat het direct goed staat
                });
            }
        }, 50);
    }
};

window.backToSummary = function() {
    document.getElementById('ride-map-view').classList.add('hidden');
    document.getElementById('ride-summary-dashboard').classList.remove('hidden');
};

// --- ELEVATE FEATURE 3: Year-to-Date (YTD) Progressie (ALLE JAREN) ---
function renderYTDChart(activities) {
    const ctx = document.getElementById('ytdProgressChart').getContext('2d');
    if (activeCharts['ytdChart']) activeCharts['ytdChart'].destroy();

    const currentYear = new Date().getFullYear();
    
    // 1. Vind alle unieke jaren waarin je gefietst hebt
    const yearlyData = {};
    
    activities.forEach(act => {
        if (act.summary.type === 'route') return;
        const d = new Date(act.summary.rideDate);
        const year = d.getFullYear();
        
        // Maak een lege array van 12 maanden aan voor elk nieuw jaar dat we tegenkomen
        if (!yearlyData[year]) {
            yearlyData[year] = new Array(12).fill(0);
        }
    });

    // Zorg dat het huidige jaar er altijd in staat, zelfs als je dit jaar nog niet gefietst hebt
    if (!yearlyData[currentYear]) {
        yearlyData[currentYear] = new Array(12).fill(0);
    }

    // 2. Vul de ruwe maand-totalen in
    activities.forEach(act => {
        if (act.summary.type === 'route') return;
        const d = new Date(act.summary.rideDate);
        const year = d.getFullYear();
        const month = d.getMonth();
        const dist = parseFloat(act.summary.distanceKm) || 0;
        
        yearlyData[year][month] += dist;
    });

    // 3. Cumulatief maken (YTD: tel elke maand op bij het totaal van de vorige maanden)
    Object.keys(yearlyData).forEach(year => {
        for (let i = 1; i < 12; i++) {
            yearlyData[year][i] += yearlyData[year][i - 1];
        }
    });

    // 4. Verberg de "toekomst" voor het huidige jaar
    const currentMonth = new Date().getMonth();
    for (let i = currentMonth + 1; i < 12; i++) {
        yearlyData[currentYear][i] = null; 
    }

    // 5. Bouw de datasets op voor de grafiek
    // We sorteren de jaren van nieuw naar oud, zodat het huidige jaar bovenaan staat in de legenda
    const sortedYears = Object.keys(yearlyData).sort((a, b) => b - a);
    
    // Een lijstje met leuke/strakke kleuren voor de oudere jaren
    const pastColors = ['#888888', '#00acc1', '#28a745', '#ffc107', '#dc3545'];
    
    const datasets = sortedYears.map((year, index) => {
        const isCurrent = parseInt(year) === currentYear;
        
        // Bepaal de kleur. Huidig = Oranje. Oud = Een kleur uit de lijst (of grijs als de lijst op is).
        const color = isCurrent ? '#fc4c02' : (pastColors[index - 1] || '#555555');
        
        return {
            label: `Jaar ${year}`,
            data: yearlyData[year],
            borderColor: color,
            backgroundColor: isCurrent ? 'rgba(252, 76, 2, 0.1)' : 'transparent',
            borderWidth: isCurrent ? 3 : 2,
            borderDash: isCurrent ? [] : [5, 5], // Oudere jaren zijn stippellijnen
            fill: isCurrent, // Alleen het huidige jaar wordt aan de onderkant ingekleurd
            tension: 0.3,
            pointRadius: isCurrent ? 4 : 0, // Alleen het huidige jaar heeft bolletjes
            pointBackgroundColor: color,
            order: isCurrent ? 0 : 1 // Zorg dat het huidige jaar visueel bovenop de andere lijnen ligt
        };
    });

    // Bepaal de kleuren voor de weergave (Dark Mode check)
    const isDark = document.body.classList.contains('dark-mode');
    const chartTextColor = isDark ? '#f0f0f0' : '#333333';
    const chartTextMuted = isDark ? '#aaaaaa' : '#666666';
    const chartGridColor = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';

    // 6. Teken de grafiek
    activeCharts['ytdChart'] = new Chart(ctx, {
        type: 'line',
        data: {
            labels: ['Jan', 'Feb', 'Mrt', 'Apr', 'Mei', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec'],
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { 
                    position: 'top', 
                    labels: { color: chartTextColor, usePointStyle: true, padding: 20 } 
                },
                tooltip: {
                    mode: 'index',      // Dit zorgt ervoor dat je bij hoveren álle jaren tegelijk in 1 tooltip ziet!
                    intersect: false,
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    titleColor: '#fff',
                    bodyColor: '#fff'
                }
            },
            scales: {
                x: { 
                    grid: { display: false }, 
                    ticks: { color: chartTextMuted } 
                },
                y: { 
                    grid: { color: chartGridColor }, 
                    ticks: { color: chartTextMuted } 
                }
            }
        }
    });
}

// ==========================================================================
// SOCIALE FUNCTIES (COMMUNITY)
// ==========================================================================

// 1. Check of de gebruiker al een naam heeft gekozen
window.checkProfileSetup = async function() {
    const profile = await window.supabaseAuth.getProfile();
    if (!profile || !profile.display_name) {
        document.getElementById('profile-modal').classList.add('show');
    } else {
        window.currentDisplayName = profile.display_name;
    }
};

// 2. Naam opslaan vanuit de Pop-up
window.saveProfileName = async function() {
    const name = document.getElementById('profile-name-input').value.trim();
    if (!name) {
        alert("Vul een naam in!");
        return;
    }
    
    const btn = event.target;
    btn.innerText = "Opslaan...";
    btn.disabled = true;

    try {
        await window.supabaseAuth.updateProfile(name);
        document.getElementById('profile-modal').classList.remove('show');
        window.currentDisplayName = name;
        alert("Profiel succesvol opgeslagen!");
    } catch (e) {
        console.error(e);
        alert("Fout bij opslaan profiel: " + e.message);
        btn.innerText = "Opslaan & Verder";
        btn.disabled = false;
    }
};

// 3. Andere gebruikers zoeken
window.searchCommunity = async function() {
    const term = document.getElementById('community-search').value.trim();
    const resultsContainer = document.getElementById('community-results');
    
    if (!term) {
        resultsContainer.innerHTML = '<p style="text-align:center; color:var(--text-muted); padding:20px;">Typ een naam om te zoeken.</p>';
        return;
    }

    resultsContainer.innerHTML = '<div class="skeleton skeleton-list-item"></div>';

    try {
        const users = await window.supabaseAuth.searchProfiles(term);
        
        if (users.length === 0) {
            resultsContainer.innerHTML = '<p style="text-align:center; color:var(--text-muted); padding:20px;">Niemand gevonden met die naam.</p>';
            return;
        }

        // Toon de gevonden gebruikers met werkende Bekijk knop!
        resultsContainer.innerHTML = users.map(u => `
            <div class="dash-list-item" style="align-items:center; cursor:default;">
                <div style="font-size: 2rem; margin-right: 15px;">👤</div>
                <div style="flex:1;">
                    <strong style="display:block; font-size:1.1rem; color:var(--text-main);">${u.display_name}</strong>
                </div>
                <button class="sub-nav-btn" style="font-size:0.8rem;" onclick="openPublicProfile('${u.id}', '${u.display_name}')">👁️ Bekijk</button>
            </div>
        `).join('');

    } catch (e) {
        console.error(e);
        resultsContainer.innerHTML = '<p style="color:#ff4444; text-align:center;">Fout bij zoeken.</p>';
    }
};

// 4. Open het profiel van een andere fietser
window.openPublicProfile = async function(userId, displayName) {
    // 1. Verberg alles en toon het openbare profiel
    document.querySelectorAll('.view-section').forEach(v => v.classList.add('hidden'));
    document.getElementById('view-public-profile').classList.remove('hidden');
    
    // 2. Naam updaten en laadschermen tonen
    document.getElementById('public-profile-name').innerText = `👤 Profiel van ${displayName}`;
    document.getElementById('public-total-dist').innerHTML = '<span class="skeleton skeleton-val"></span>';
    document.getElementById('public-total-elev').innerHTML = '<span class="skeleton skeleton-val"></span>';
    document.getElementById('public-total-rides').innerHTML = '<span class="skeleton skeleton-val"></span>';
    document.getElementById('public-activities-list').innerHTML = '<div class="skeleton skeleton-list-item"></div><div class="skeleton skeleton-list-item"></div>';

    try {
        // 3. Haal de activiteiten van DEZE specifieke speler op uit de database
        const { data, error } = await window.supabase.from('activities')
            .select('id, file_name, summary, ride_date')
            .eq('user_id', userId)
            .order('ride_date', { ascending: false });
        
        if (error) throw error;

        // Filter alleen de echte ritten
        const realRides = data.filter(a => a.summary && a.summary.type !== 'route');
        
        let dist = 0; let elev = 0;
        realRides.forEach(r => {
            dist += parseFloat(r.summary.distanceKm || 0);
            elev += parseFloat(r.summary.elevationGain || 0);
        });

        // Vul de dashboard statistieken in
        document.getElementById('public-total-dist').innerHTML = `${Math.round(dist)} <small>km</small>`;
        document.getElementById('public-total-elev').innerHTML = `${Math.round(elev)} <small>m</small>`;
        document.getElementById('public-total-rides').innerHTML = realRides.length;

        // Vul de lijst met recente ritten
        if (realRides.length === 0) {
            document.getElementById('public-activities-list').innerHTML = '<p style="color:var(--text-muted); padding: 15px; text-align: center;">Nog geen ritten gefietst.</p>';
        } else {
            document.getElementById('public-activities-list').innerHTML = realRides.map(act => `
                <div class="dash-list-item" style="cursor: default;">
                    <div style="flex:1; display:flex; justify-content:space-between; align-items:center;">
                        <div style="display:flex; flex-direction:column;">
                            <strong>🚴 ${act.file_name}</strong>
                            <small style="font-size:0.75rem; color:var(--text-muted);">${new Date(act.ride_date).toLocaleDateString()}</small>
                        </div>
                        <span style="font-weight:bold; color:var(--primary);">${parseFloat(act.summary.distanceKm).toFixed(1)} km</span>
                    </div>
                </div>
            `).join('');
        }
    } catch(e) {
        console.error(e);
        document.getElementById('public-activities-list').innerHTML = '<p style="color:#ff4444; padding: 15px;">Kon ritten niet inladen.</p>';
    }
};