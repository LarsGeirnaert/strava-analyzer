// ui.js - Dashboard, Recap, Rankings, ROUTE PLANNER, Heatmap, Squadrats & Theming

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

// Maakt tekst van gebruikers (bestandsnamen, profielnamen) veilig voor gebruik in innerHTML
function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
let currentCalDate = new Date();

let waypoints = [];
let routePolyline = null;
let routeSegments = [];

let statsUpdateTimeout = null;
let currentAbortController = null;
let lastWindCoord = null;

let heatmapSliderDate = null;
let sortedHeatmapActs = [];
let heatmapLayers = []; 

const REGIONS = [
    { code: 'be', url: 'communes.json', type: 'topojson', nameFields: ['Gemeente', 'name', 'NAME_4', 'Name'] },
    { code: 'nl', url: 'https://cartomap.github.io/nl/wgs84/gemeente_2023.geojson', type: 'geojson', nameFields: ['statnaam'] }
];

document.addEventListener('DOMContentLoaded', () => {
    if (localStorage.getItem('theme') === 'light') {
        document.body.classList.remove('dark-mode');
    }

    setupNavigation();
    setupSegmentSelector();

    const now = new Date();
    const ms = document.getElementById('recap-month-select');
    const ys = document.getElementById('recap-year-select');
    if(ms) ms.value = now.getMonth();
    if(ys) ys.value = now.getFullYear();
    
    const savedTheme = localStorage.getItem('theme') || 'classic'; 
    document.documentElement.setAttribute('data-theme', savedTheme);
    
    const themeMap = {
        'classic': { icon: '☀️', text: 'Classic Light' },
        'ocean': { icon: '🌊', text: 'Deep Ocean' },
        'gravel': { icon: '🌲', text: 'Gravel Explorer' },
        'cyberpunk': { icon: '🌃', text: 'Cyberpunk' },
        'stealth': { icon: '🦇', text: 'Stealth Mode' }
    };
    
    if (themeMap[savedTheme] && document.getElementById('current-theme-icon')) {
        document.getElementById('current-theme-icon').innerText = themeMap[savedTheme].icon;
        document.getElementById('current-theme-text').innerText = themeMap[savedTheme].text;
    }
});

function setupNavigation() {
    document.querySelectorAll('.nav-btn[data-target]').forEach(btn =>
        btn.addEventListener('click', () => switchTab(btn.dataset.target))
    );
}

function setupSegmentSelector() {
    const select = document.getElementById('segmentSelector');
    if (select) {
        select.innerHTML = '';
        for (let k = 5; k <= 100; k += 5) {
            const opt = document.createElement('option');
            opt.value = k;
            opt.text = `${k} km`;
            select.appendChild(opt);
        }
        select.value = "5"; 
    }
}

window.showToast = function(message, type = 'success') {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
    }
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerText = message;
    container.appendChild(toast);
    
    requestAnimationFrame(() => {
        setTimeout(() => toast.classList.add('show'), 10);
    });
    
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3500);
};

function calculateTrendLine(data) {
    const n = data.length;
    if (n < 2) return data;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (let i = 0; i < n; i++) { sumX += i; sumY += data[i]; sumXY += i * data[i]; sumX2 += i * i; }
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    return data.map((_, i) => slope * i + intercept);
}

window.switchTab = function(tabName) {
    document.querySelectorAll('.nav-btn[data-target]').forEach(b => b.classList.remove('active'));
    const activeBtn = document.querySelector(`.nav-btn[data-target="${tabName}"]`);
    if(activeBtn) activeBtn.classList.add('active');

    document.querySelectorAll('.view-section').forEach(v => v.classList.add('hidden'));
    const target = document.getElementById(`view-${tabName}`);
    if(target) target.classList.remove('hidden');

    if (tabName === 'analysis') {
        const sumDash = document.getElementById('ride-summary-dashboard');
        const mapView = document.getElementById('ride-map-view');
        if (sumDash && mapView) {
             sumDash.classList.add('hidden');
             mapView.classList.remove('hidden');
        }
    }

    setTimeout(() => {
        if(tabName === 'analysis' && typeof map !== 'undefined' && map) {
            map.invalidateSize();
            if (typeof activeSegment !== 'undefined' && activeSegment && typeof segmentLayer !== 'undefined' && segmentLayer) {
                 map.fitBounds(segmentLayer.getBounds(), { paddingTopLeft: [20, 20], paddingBottomRight: [20, 300] });
            } else if (typeof polyline !== 'undefined' && polyline) {
                 map.fitBounds(polyline.getBounds(), { paddingTopLeft: [20, 20], paddingBottomRight: [20, 300] });
            } else {
                 map.setView([51.185, 3.565], 11);
            }
        }
        if(tabName === 'routes') { initRouteMap(); updateSavedRoutesList(); }
        if(tabName === 'municipalities') {
            initMuniMap();
            setWorldMode(currentWorldMode);
        }
        if(tabName === 'squadrats') {
            initSquadratMap();
        }
    }, 150);

    if(tabName === 'dashboard') updateDashboard();
    if(tabName === 'recap') updateRecapView();
    if(tabName === 'rankings') loadRankings();
};

function initRouteMap() {
    if (routeMap) { 
        routeMap.invalidateSize(); 
        if (typeof fetchCurrentWind === 'function') fetchCurrentWind();
        return; 
    }
    
    routeMap = L.map('map-routes').setView([51.185, 3.565], 11);
    
    // Forceer een schone, heldere weergave zonder donkere filters voor de routeplanner
    const mapContainer = document.getElementById('map-routes');
    if(mapContainer) {
        mapContainer.style.filter = "none";
        mapContainer.style.webkitFilter = "none";
    }

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { 
        attribution: '© OpenStreetMap',
        className: 'clear-route-tiles' // Zorgt ervoor dat css-filters genegeerd worden
    }).addTo(routeMap);
    
    // Voeg een tijdelijke CSS regel toe om Leaflet dark mode inversie te annuleren
    const style = document.createElement('style');
    style.innerHTML = `
        #map-routes .leaflet-layer, #map-routes .clear-route-tiles {
            filter: none !important;
            -webkit-filter: none !important;
        }
    `;
    document.head.appendChild(style);
    
    routeMap.on('click', handleRouteMapClick);

    if (typeof fetchCurrentWind === 'function') fetchCurrentWind();
}

async function handleRouteMapClick(e) {
    window.addRouteWaypoint(e.latlng);
}

window.addRouteWaypoint = async function(latlng) {
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
};

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

async function drawFullRoute() {
    if (routePolyline) routeMap.removeLayer(routePolyline);
    const fullPath = routeSegments.flat();
    
    if (fullPath.length === 0) {
        document.getElementById('routeDist').innerText = "0";
        document.getElementById('routeTime').innerText = "0:00";
        document.getElementById('routeElev').innerText = "0";
        if (document.getElementById('pred-speed')) document.getElementById('pred-speed').innerText = "--";
        return;
    }
    
    routePolyline = L.polyline(fullPath, {color: '#FC5200', weight: 5}).addTo(routeMap);

    let totalDist = 0;
    for(let i = 1; i < fullPath.length; i++) {
        totalDist += routeMap.distance(fullPath[i-1], fullPath[i]);
    }
    const distKm = totalDist / 1000;
    document.getElementById('routeDist').innerText = distKm.toFixed(2);
    document.getElementById('routeElev').innerText = "...";
    
    clearTimeout(statsUpdateTimeout);
    if (currentAbortController) {
        currentAbortController.abort(); 
    }
    currentAbortController = new AbortController();
    const signal = currentAbortController.signal;
    
    statsUpdateTimeout = setTimeout(async () => {
        try {
            const startPoint = fullPath[0];
            fetchRouteWind(startPoint[0], startPoint[1], signal);

            const elevM = await fetchElevationForRoute(fullPath, distKm, signal);

            const predictedSpeed = predictAverageSpeed(distKm, elevM);
            const speedSpan = document.getElementById('pred-speed');
            if (speedSpan) speedSpan.innerText = predictedSpeed.toFixed(1);

            if (predictedSpeed > 0) {
                const hours = distKm / predictedSpeed;
                const h = Math.floor(hours);
                const m = Math.floor((hours % 1) * 60).toString().padStart(2, '0');
                document.getElementById('routeTime').innerText = `${h}:${m}`;
            }
        } catch (err) {
            if (err.name !== 'AbortError') console.error(err);
        }
    }, 1500); 
}

async function fetchRouteWind(lat, lon, signal) {
    const windEl = document.getElementById('routeWindInfo');
    
    if (lastWindCoord) {
        const latDiff = Math.abs(lastWindCoord.lat - lat);
        const lonDiff = Math.abs(lastWindCoord.lon - lon);
        if (latDiff < 0.05 && lonDiff < 0.05) return; 
    }
    
    if (windEl) windEl.innerText = "Weer ophalen...";
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&windspeed_unit=kmh`;
    
    try {
        const res = await fetch(url, { signal });
        if (!res.ok) throw new Error("Rate limit");
        const data = await res.json();
        
        lastWindCoord = { lat, lon };
        const windDir = data.current_weather.winddirection;
        const windSpeed = data.current_weather.windspeed;
        const directions = ['N', 'NNO', 'NO', 'ONO', 'O', 'OZO', 'ZO', 'ZZO', 'Z', 'ZZW', 'ZW', 'WZW', 'W', 'WNW', 'NW', 'NNW'];
        const dirString = directions[Math.round(windDir / 22.5) % 16];
        
        if(windEl) windEl.innerHTML = `<strong>${windSpeed.toFixed(1)} km/u</strong> uit <strong>${dirString}</strong>`;
    } catch(e) {
        if (e.name !== 'AbortError' && windEl) windEl.innerText = "Weer tijdelijk onbeschikbaar";
    }
}

async function fetchElevationForRoute(latlngs, distKm, signal) {
    const el = document.getElementById('routeElev');
    if(!latlngs || latlngs.length < 2) return 0;

    const maxPoints = 100;
    let sampledPoints = [];
    if (latlngs.length <= maxPoints) {
        sampledPoints = latlngs;
    } else {
        const step = latlngs.length / maxPoints;
        for (let i = 0; i < maxPoints; i++) {
            sampledPoints.push(latlngs[Math.floor(i * step)]);
        }
    }

    const lats = sampledPoints.map(p => p[0].toFixed(5)).join(',');
    const lons = sampledPoints.map(p => p[1].toFixed(5)).join(',');
    const url = `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lons}`;

    try {
        const res = await fetch(url, { signal });
        if (!res.ok) throw new Error("API Fout");
        const data = await res.json();
        
        if (!data.elevation) return 0;
        
        let gain = 0;
        const ev = data.elevation;
        
        for (let i = 1; i < ev.length; i++) {
            const diff = ev[i] - ev[i-1];
            if (diff > 0) gain += diff;
        }
        
        const metersPerPoint = (distKm * 1000) / sampledPoints.length;
        if (metersPerPoint > 150) {
            const scale = 1 + ((metersPerPoint - 150) / 1000); 
            gain = gain * Math.min(scale, 2.5);
        }

        const finalGain = Math.round(gain);
        if(el) el.innerText = finalGain;
        window.currentRouteElevation = finalGain;
        return finalGain;
        
    } catch (e) {
        if (e.name !== 'AbortError') console.error("Hoogte fout:", e);
        if (el) el.innerText = window.currentRouteElevation || "0";
        return window.currentRouteElevation || 0;
    }
}

function predictAverageSpeed(distKm, elevM) {
    const routeGradient = distKm > 0 ? (elevM / (distKm * 1000)) * 100 : 0;
    let predicted = 25.0 - (routeGradient * 1.5);

    if (!window.allActivitiesCache && window.supabaseAuth) {
        window.supabaseAuth.listActivities().then(data => window.allActivitiesCache = data).catch(()=>{});
    }

    if (window.allActivitiesCache && window.allActivitiesCache.length > 0) {
        const rides = window.allActivitiesCache.filter(a => a.summary && a.summary.type !== 'route' && parseFloat(a.summary.distanceKm) > 5);
        
        if (rides.length > 0) {
            const ridesWithGrad = rides.map(r => {
                const d = parseFloat(r.summary.distanceKm) || 1;
                const e = parseFloat(r.summary.elevationGain) || 0;
                let s = parseFloat(r.summary.avgSpeed);
                
                if (isNaN(s) || s < 10) s = 25.0; 
                
                const g = (e / (d * 1000)) * 100;
                return { speed: s, grad: g };
            });
            
            ridesWithGrad.sort((a, b) => Math.abs(a.grad - routeGradient) - Math.abs(b.grad - routeGradient));
            const top3 = ridesWithGrad.slice(0, 3);
            
            predicted = top3.reduce((sum, r) => sum + r.speed, 0) / top3.length;
        }
    }
    
    return Math.max(15, Math.min(predicted, 40)); 
}

window.downloadRouteGPX = function() {
    if (waypoints.length < 2) { 
        alert("Teken eerst een route voordat je kan downloaden!"); 
        return; 
    }

    const name = document.getElementById('route-name-input').value || "Mijn_Route";
    const flatCoords = routeSegments.flat();
    
    let gpxContent = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Strava 3.0">\n  <trk>\n    <name>${name}</name>\n    <trkseg>\n`;
    
    flatCoords.forEach(c => { 
        gpxContent += `      <trkpt lat="${c[0]}" lon="${c[1]}"></trkpt>\n`; 
    });
    gpxContent += `    </trkseg>\n  </trk>\n</gpx>`;

    const blob = new Blob([gpxContent], {type: 'application/gpx+xml'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${name.replace(/\s+/g, '_')}.gpx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
};

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
    btn.innerText = "Bezig met opslaan..."; btn.disabled = true;

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
                elevationGain: window.currentRouteElevation || parseInt(document.getElementById('routeElev').innerText) || 0,
                avgSpeed: 22.0,
                rideDate: new Date().toISOString(),
                segments: [],
                type: 'route'
            }
        });
        window.showToast("Route succesvol opgeslagen in de cloud!", "success");
        btn.innerHTML = '<i data-lucide="cloud-lightning" style="width:16px;height:16px;margin-right:6px;"></i> Opslaan in Cloud'; 
        btn.disabled = false;
        lucide.createIcons();
        window.clearRoute();
        updateSavedRoutesList();
        if(window.updateDashboard) window.updateDashboard();
    } catch(e) {
        console.error(e);
        window.showToast("Fout bij opslaan: " + e.message, "error");
        btn.innerHTML = '<i data-lucide="cloud-lightning" style="width:16px;height:16px;margin-right:6px;"></i> Opslaan in Cloud'; 
        btn.disabled = false;
        lucide.createIcons();
    }
};

window.loadSavedRoute = async function(id) {
    window.clearRoute();
    try {
        const blob = await window.supabaseAuth.getActivityFile(id);
        const text = await blob.text();
        const regex = /lat="([\d\.-]+)"\s+lon="([\d\.-]+)"/g;
        let m; const coords = [];
        while ((m = regex.exec(text)) !== null) { coords.push([parseFloat(m[1]), parseFloat(m[2])]); }
        if (coords.length > 0) {
            routePolyline = L.polyline(coords, {color: '#10B981', weight: 5, dashArray: '10, 10'}).addTo(routeMap);
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

async function updateDashboard() {
    if(!window.supabaseAuth.getCurrentUser()) return;

    window.checkProfileSetup();
    document.getElementById('dashboard-list').innerHTML = `<div class="skeleton skeleton-list-item"></div><div class="skeleton skeleton-list-item"></div>`;

    const loaders = `<span class="skeleton skeleton-val" style="width: 60%;"></span>`;
    document.getElementById('total-dist').innerHTML = loaders;
    document.getElementById('total-elev').innerHTML = loaders;
    document.getElementById('total-rides').innerHTML = loaders;

    allActivitiesCache = await window.supabaseAuth.listActivities();
    const realRides = allActivitiesCache.filter(a => a.summary.type !== 'route');

    let d=0, e=0;
    realRides.forEach(a => {
        d += parseFloat(a.summary.distanceKm||0);
        e += parseFloat(a.summary.elevationGain||0);
    });

    animateValue("total-dist", 0, d, 1000, "");
    animateValue("total-elev", 0, e, 1000, "");
    document.getElementById('total-rides').innerText = realRides.length;

    const hour = new Date().getHours();
    let greeting = "Goedenacht";
    if (hour >= 6 && hour < 12) greeting = "Goedemorgen";
    else if (hour >= 12 && hour < 18) greeting = "Goedemiddag";
    else if (hour >= 18) greeting = "Goedenavond";
    const userEmail = window.supabaseAuth.getCurrentUser().email.split('@')[0];
    const name = window.currentDisplayName || (userEmail.charAt(0).toUpperCase() + userEmail.slice(1));
    
    document.getElementById('welcome-msg').innerText = `${greeting}, ${name}.`;

    document.getElementById('streak-count').innerText = calculateWeeklyStreak(realRides);

    if (typeof currentCalDate === 'undefined') window.currentCalDate = new Date();
    renderCalendar(currentCalDate.getMonth(), currentCalDate.getFullYear());

    renderActivityListBasedOnView();
    renderYTDChart(allActivitiesCache);
    renderMonthlyComparisonChart(allActivitiesCache);
}

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
    if (selYear === 'all') title = "All-Time Overzicht";
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

    renderRecapChart(filtered, selMonth, selYear);
    renderDistributionChart(filtered);

    const list = document.getElementById('recap-best-list');
    const sorted = [...filtered].sort((a,b) => b.summary.distanceKm - a.summary.distanceKm).slice(0, 5);
    
    if (sorted.length === 0) {
        list.innerHTML = '<p class="empty-state">Geen ritten gevonden in deze periode.</p>';
        return;
    }
    
    const fragment = document.createDocumentFragment();
    sorted.forEach((act, i) => {
        const labelClass = i===0 ? 'primary-text' : '';
        const div = document.createElement('div');
        div.className = 'dash-list-item';
        div.style.cursor = 'pointer';
        div.innerHTML = `
            <div style="flex:1;">
                <strong class="${labelClass}">${i+1}. ${escapeHtml(act.fileName)}</strong><br>
                <small class="sub-text">${new Date(act.summary.rideDate).toLocaleDateString()}</small>
            </div>
            <div style="text-align:right;">
                <span style="display:block; font-weight:600; color:var(--text-main);">${parseFloat(act.summary.distanceKm).toFixed(1)} km</span>
                <span class="sub-text">${act.summary.elevationGain}m</span>
            </div>
        `;
        div.addEventListener('click', () => {
            switchTab('analysis');
            window.openRide(act); 
        });
        fragment.appendChild(div);
    });
    
    list.innerHTML = '';
    list.appendChild(fragment);
}


async function updateSavedRoutesList() {
    const list = document.getElementById('saved-routes-list');
    if(!list) return;

    list.innerHTML = `<div class="skeleton skeleton-list-item"></div>`;

    if(!allActivitiesCache) allActivitiesCache = await window.supabaseAuth.listActivities();
    const routes = allActivitiesCache.filter(a => a.summary.type === 'route');

    if(routes.length === 0) {
        list.innerHTML = '<small class="sub-text" style="padding:10px; display:block;">Nog geen routes.</small>';
        return;
    }

    const fragment = document.createDocumentFragment();
    routes.forEach(r => {
        const div = document.createElement('div');
        div.className = 'dash-list-item';
        div.style.flexDirection = 'column';
        div.style.alignItems = 'flex-start';
        div.innerHTML = `
            <div style="display:flex; justify-content:space-between; width:100%; align-items:center;">
                <strong style="font-weight:600;">${escapeHtml(r.fileName)}</strong>
                <button class="btn-danger delete-btn" style="padding:4px 8px; font-size:0.75rem;"><i data-lucide="trash-2" style="width:14px;height:14px;"></i></button>
            </div>
            <div style="font-size:0.85rem; color:var(--text-muted); display:flex; justify-content:space-between; width:100%; margin-top:8px;">
                <span>${parseFloat(r.summary.distanceKm).toFixed(1)} km</span>
                <span class="primary-text map-btn" style="cursor:pointer;"><i data-lucide="map-pin" style="width:14px;height:14px;"></i> Bekijk</span>
            </div>
        `;
        
        div.querySelector('.delete-btn').addEventListener('click', () => deleteRoute(r.id));
        div.querySelector('.map-btn').addEventListener('click', () => loadSavedRoute(r.id));
        
        fragment.appendChild(div);
    });
    
    list.innerHTML = '';
    list.appendChild(fragment);
    lucide.createIcons();
}

window.filterActivities = function() {
    currentActivityPage = 1;
    renderActivityListBasedOnView();
};

window.changeActivityPage = function(dir) {
    currentActivityPage += dir;
    renderActivityListBasedOnView();
};

function renderActivityListBasedOnView() {
    let list = allActivitiesCache || [];
    list = list.filter(a => !a.summary || a.summary.type !== 'route');

    const term = document.getElementById('activity-search').value.toLowerCase();
    if (term) {
        list = list.filter(a => a.fileName.toLowerCase().includes(term));
    }

    const totalPages = Math.ceil(list.length / ACTIVITY_PAGE_SIZE) || 1;
    if (currentActivityPage > totalPages) currentActivityPage = totalPages;
    if (currentActivityPage < 1) currentActivityPage = 1;

    const startIndex = (currentActivityPage - 1) * ACTIVITY_PAGE_SIZE;
    const endIndex = startIndex + ACTIVITY_PAGE_SIZE;
    const pageList = list.slice(startIndex, endIndex);

    const pageInfo = document.getElementById('page-info');
    const prevBtn = document.getElementById('prev-page-btn');
    const nextBtn = document.getElementById('next-page-btn');

    if (pageInfo) pageInfo.innerText = `Pagina ${currentActivityPage} / ${totalPages}`;
    if (prevBtn) prevBtn.disabled = currentActivityPage === 1;
    if (nextBtn) nextBtn.disabled = currentActivityPage === totalPages;

    window.renderActivityList(pageList);
}

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

    const fragment = document.createDocumentFragment();
    
    ['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo'].forEach(d => {
        const div = document.createElement('div');
        div.className = 'calendar-day-name';
        div.innerText = d;
        fragment.appendChild(div);
    });

    const firstDay = new Date(year, month, 1).getDay();
    const offset = firstDay === 0 ? 6 : firstDay - 1;
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    for (let i = 0; i < offset; i++) {
        const emptyDay = document.createElement('div');
        emptyDay.className = 'calendar-day empty';
        fragment.appendChild(emptyDay);
    }

    const activeDays = new Map();
    if (allActivitiesCache) {
        allActivitiesCache.forEach(act => {
            if(act.summary.type === 'route') return;
            const d = new Date(act.summary.rideDate);
            if (d.getMonth() === month && d.getFullYear() === year) {
                activeDays.set(d.getDate(), act);
            }
        });
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const dayDiv = document.createElement('div');
        dayDiv.className = 'calendar-day';
        dayDiv.innerText = day;
        
        if (activeDays.has(day)) {
            const act = activeDays.get(day);
            dayDiv.classList.add('active-day');
            dayDiv.title = act.fileName;
            dayDiv.addEventListener('click', () => {
                switchTab("analysis");
                window.openRide(act); 
            });
        }
        fragment.appendChild(dayDiv);
    }

    grid.innerHTML = '';
    grid.appendChild(fragment);
}

window.toggleActivityView = function() {
    isShowingAll = !isShowingAll;
    const btn = document.getElementById('toggle-view-btn');
    if(btn) {
        if (isShowingAll) {
            btn.innerText = "Toon Minder";
            btn.style.background = "var(--primary)";
        } else {
            btn.innerText = "Toon Alles";
            btn.style.background = "var(--bg-nav)";
            document.getElementById('activity-search').value = ""; 
        }
    }
    renderActivityListBasedOnView();
};

window.renderActivityList = function(acts) {
    const list = document.getElementById('dashboard-list');
    if(!list) return;

    if (acts.length === 0) {
        list.innerHTML = '<div class="empty-state">Geen activiteiten gevonden.</div>';
        return;
    }

    const fragment = document.createDocumentFragment();

    acts.forEach(act => {
        const typeLabel = act.summary.type === 'route' ? 'Route' : 'Rit';
        const detail = act.summary.type === 'route'
            ? 'Geplande Route'
            : new Date(act.summary.rideDate).toLocaleDateString();

        const div = document.createElement('div');
        div.className = 'dash-list-item';
        div.innerHTML = `
            <input type="checkbox" class="list-checkbox" ${selectedRides.has(act.id)?'checked':''}>
            <div style="flex:1; display:flex; justify-content:space-between; align-items:center; cursor:pointer;" class="clickable-area">
                <div style="display:flex; flex-direction:column; margin-left:16px;">
                    <strong style="color:var(--text-main); font-weight:600;">${escapeHtml(act.fileName)}</strong>
                    <small class="sub-text">${typeLabel} • ${detail}</small>
                </div>
                <span class="primary-text">${parseFloat(act.summary.distanceKm).toFixed(1)} km</span>
            </div>
        `;
        
        div.querySelector('.list-checkbox').addEventListener('change', () => toggleSelection(act.id));
        div.querySelector('.clickable-area').addEventListener('click', (e) => {
            if(e.target.type !== 'checkbox') {
                switchTab('analysis'); 
                window.openRide(act); 
            }
        });
        
        fragment.appendChild(div);
    });
    
    list.innerHTML = '';
    list.appendChild(fragment);
};

function calculateWeeklyStreak(activities) {
    if (activities.length === 0) return 0;
    const weeks = new Set();
    activities.forEach(act => {
        const date = new Date(act.summary.rideDate);
        const onejan = new Date(date.getFullYear(), 0, 1);
        const week = Math.ceil((((date.getTime() - onejan.getTime()) / 86400000) + onejan.getDay() + 1) / 7);
        weeks.add(`${date.getFullYear()}-${week}`);
    });
    return weeks.size;
}

function animateValue(id, start, end, duration, suffix = "") {
    const obj = document.getElementById(id);
    if (!obj) return;
    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        const ease = 1 - Math.pow(1 - progress, 3);
        const val = Math.floor(progress * (end - start) + start);
        obj.innerHTML = val + suffix;
        if (progress < 1) {
            window.requestAnimationFrame(step);
        } else {
            obj.innerHTML = (end % 1 === 0 ? end : end.toFixed(0)) + suffix;
        }
    };
    window.requestAnimationFrame(step);
}

window.renderYTDChart = function(activities) {
    const ctx = document.getElementById('ytdProgressChart');
    if(!ctx) return;
    if (activeCharts['ytdChart']) activeCharts['ytdChart'].destroy();

    const currentYear = new Date().getFullYear();
    const yearlyData = {};

    activities.forEach(act => {
        if (act.summary.type === 'route') return;
        const year = new Date(act.summary.rideDate).getFullYear();
        if (!yearlyData[year]) yearlyData[year] = new Array(12).fill(0);
    });
    if (!yearlyData[currentYear]) yearlyData[currentYear] = new Array(12).fill(0);

    activities.forEach(act => {
        if (act.summary.type === 'route') return;
        const d = new Date(act.summary.rideDate);
        yearlyData[d.getFullYear()][d.getMonth()] += parseFloat(act.summary.distanceKm) || 0;
    });

    Object.keys(yearlyData).forEach(year => {
        for (let i = 1; i < 12; i++) { yearlyData[year][i] += yearlyData[year][i - 1]; }
    });

    const currentMonth = new Date().getMonth();
    for (let i = currentMonth + 1; i < 12; i++) { yearlyData[currentYear][i] = null; }

    const sortedYears = Object.keys(yearlyData).sort((a, b) => b - a);
    const pastColors = ['#888888', '#00acc1', '#10B981', '#F59E0B', '#EF4444'];

    const datasets = sortedYears.map((year, index) => {
        const isCurrent = parseInt(year) === currentYear;
        const color = isCurrent ? '#FC5200' : (pastColors[index - 1] || '#555555');
        return {
            label: `Jaar ${year}`, data: yearlyData[year], borderColor: color,
            backgroundColor: isCurrent ? 'rgba(252, 82, 0, 0.1)' : 'transparent',
            borderWidth: isCurrent ? 3 : 2, borderDash: isCurrent ? [] : [5, 5], fill: isCurrent, tension: 0.3, pointRadius: isCurrent ? 4 : 0, order: isCurrent ? 0 : 1 
        };
    });

    activeCharts['ytdChart'] = new Chart(ctx.getContext('2d'), {
        type: 'line', data: { labels: ['Jan', 'Feb', 'Mrt', 'Apr', 'Mei', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec'], datasets: datasets },
        options: { responsive: true, maintainAspectRatio: false }
    });
};

window.renderMonthlyComparisonChart = function(activities) {
    const ctx = document.getElementById('monthlyComparisonChart');
    if(!ctx) return;
    if (activeCharts['monthlyCompChart']) activeCharts['monthlyCompChart'].destroy();

    const currentYear = new Date().getFullYear();
    const yearlyData = {};

    activities.forEach(act => {
        if (act.summary.type === 'route') return;
        const y = new Date(act.summary.rideDate).getFullYear();
        if (!yearlyData[y]) yearlyData[y] = new Array(12).fill(0);
    });
    if (!yearlyData[currentYear]) yearlyData[currentYear] = new Array(12).fill(0);

    activities.forEach(act => {
        if (act.summary.type === 'route') return;
        const d = new Date(act.summary.rideDate);
        yearlyData[d.getFullYear()][d.getMonth()] += parseFloat(act.summary.distanceKm) || 0;
    });

    const sortedYears = Object.keys(yearlyData).sort((a, b) => b - a); 
    const pastColors = ['#888888', '#00acc1', '#10B981', '#F59E0B', '#EF4444'];

    const datasets = sortedYears.map((year, index) => {
        const isCurrent = parseInt(year) === currentYear;
        const color = isCurrent ? '#FC5200' : (pastColors[index - 1] || '#555555');
        return {
            label: `Jaar ${year}`, data: yearlyData[year], borderColor: color,
            backgroundColor: isCurrent ? 'rgba(252, 82, 0, 0.1)' : 'transparent',
            borderWidth: isCurrent ? 3 : 2, borderDash: isCurrent ? [] : [5, 5], fill: isCurrent, tension: 0.4, pointRadius: isCurrent ? 4 : 0, order: isCurrent ? 0 : 1
        };
    });

    activeCharts['monthlyCompChart'] = new Chart(ctx.getContext('2d'), {
        type: 'line', data: { labels: ['Jan', 'Feb', 'Mrt', 'Apr', 'Mei', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec'], datasets: datasets },
        options: { responsive: true, maintainAspectRatio: false }
    });
};

function renderRecapChart(activities, monthMode, year) {
    const ctx = document.getElementById('recapComparisonChart').getContext('2d');
    if (activeCharts['recap']) activeCharts['recap'].destroy();

    let labels = [], dataPoints = [], labelText = "", chartType = 'line';

    if (year === 'all') {
        labelText = `Afstand per jaar`;
        const yearsMap = {};
        activities.forEach(act => {
            const y = new Date(act.summary.rideDate).getFullYear();
            if (!yearsMap[y]) yearsMap[y] = 0;
            yearsMap[y] += parseFloat(act.summary.distanceKm);
        });

        labels = Object.keys(yearsMap).sort();
        dataPoints = labels.map(y => yearsMap[y]);

        if(labels.length === 1) {
            labels.unshift((parseInt(labels[0])-1).toString());
            dataPoints.unshift(0);
        }

    } else if (monthMode === 'all') {
        labelText = `Afstand per maand (${year})`;
        labels = ['Jan', 'Feb', 'Mrt', 'Apr', 'Mei', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec'];
        dataPoints = new Array(12).fill(0);
        activities.forEach(act => {
            const m = new Date(act.summary.rideDate).getMonth();
            dataPoints[m] += parseFloat(act.summary.distanceKm);
        });
    } else {
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

    let gradient = ctx.createLinearGradient(0, 0, 0, 400);
    gradient.addColorStop(0, 'rgba(252, 82, 0, 0.5)'); 
    gradient.addColorStop(1, 'rgba(252, 82, 0, 0.0)'); 

    activeCharts['recap'] = new Chart(ctx, {
        type: chartType,
        data: {
            labels: labels,
            datasets: [{
                label: labelText,
                data: dataPoints,
                backgroundColor: gradient,
                borderColor: '#FC5200',
                borderWidth: 2,
                borderRadius: 4,
                tension: 0.4,
                fill: true
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
                backgroundColor: ['#10B981', '#3B82F6', '#F59E0B', '#EF4444'],
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

let muniBaseLayer = null;

async function initMuniMap() {
    if (muniMap) { 
        muniMap.invalidateSize(); 
        updateMuniMapTheme(); 
        return; 
    }
    muniMap = L.map('map-municipalities').setView([51.185, 3.565], 11);
    updateMuniMapTheme();
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
    updateWorldStats('muni', conqueredMunis.size, total);

    geoJsonLayer.eachLayer(l => {
        if (conqueredMunis.has(l.muniName)) l.setStyle({ fillColor: '#FC5200', fillOpacity: 0.7, color: '#DF4800', weight: 2 });
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
    else if(tab === 'suffer') {
        calculateSufferScores();
        renderTrendGraph(allActivitiesCache, 'sufferScore', 'suffer-table-body', 'sufferTrendChart', 'sufferTopFilter', 'Suffer Score (1-100)');
    }
};

function renderTrendGraph(activities, key, tableId, chartId, filterId, label) {
    const fv = document.getElementById(filterId)?.value || 'all';
    let r = [...activities.filter(a => a.summary.type !== 'route')].sort((a, b) => {
        const valA = parseFloat(a.summary[key]) || 0;
        const valB = parseFloat(b.summary[key]) || 0;
        return valB - valA;
    });

    if(fv !== 'all') r = r.slice(0, parseInt(fv));

    const ch = [...r].sort((a,b) => new Date(a.summary.rideDate) - new Date(b.summary.rideDate));
    const v = ch.map(a => parseFloat(a.summary[key]) || 0);
    const tr = calculateTrendLine(v);

    const ctx = document.getElementById(chartId).getContext('2d');
    if(activeCharts[chartId]) activeCharts[chartId].destroy();

    let gradient = ctx.createLinearGradient(0, 0, 0, 400);
    gradient.addColorStop(0, 'rgba(252, 82, 0, 0.5)');
    gradient.addColorStop(1, 'rgba(252, 82, 0, 0.0)');

    activeCharts[chartId] = new Chart(ctx, {
        type: 'line',
        data: {
            labels: ch.map(a => new Date(a.summary.rideDate).toLocaleDateString()),
            datasets: [
                { label: label, data: v, borderColor: '#FC5200', fill: true, tension: 0.4, backgroundColor: gradient },
                { label: 'Trend', data: tr, borderColor: '#333', borderDash: [5,5], fill: false, pointRadius:0 }
            ]
        },
        options: { responsive: true, maintainAspectRatio: false }
    });

    const tb = document.getElementById(tableId);
    if(tb) {
        const container = document.createElement('div');
        container.className = 'table-container';
        const table = document.createElement('table');
        table.className = 'data-table';
        table.innerHTML = `<thead><tr><th>#</th><th>Naam</th><th>Datum</th><th>${label}</th></tr></thead>`;
        
        const tbody = document.createElement('tbody');
        r.forEach((act, i) => {
            const val = parseFloat(act.summary[key]) || 0;
            const color = i===0 ? 'var(--medal-gold)' : i===1 ? 'var(--medal-silver)' : i===2 ? 'var(--medal-bronze)' : 'var(--text-main)';
            const weight = i<3 ? '700' : '500';

            const trObj = document.createElement('tr');
            trObj.innerHTML = `
                <td style="color:${color}; font-weight:${weight};">${i+1}</td>
                <td>${escapeHtml(act.fileName)}</td>
                <td>${new Date(act.summary.rideDate).toLocaleDateString()}</td>
                <td><strong style="color:${color};" class="stat-value">${val.toFixed(1)}</strong></td>
            `;
            trObj.addEventListener('click', () => {
                switchTab('analysis');
                window.openRide(act); 
            });
            tbody.appendChild(trObj);
        });
        
        table.appendChild(tbody);
        container.appendChild(table);
        tb.innerHTML = '';
        tb.appendChild(container);
    }
}

window.toggleSelection = (id) => { 
    if(selectedRides.has(id)) selectedRides.delete(id); 
    else selectedRides.add(id); 
    
    document.getElementById('delete-btn').classList.toggle('hidden', selectedRides.size === 0); 
    
    const compBtn = document.getElementById('compare-btn');
    if(compBtn) {
        compBtn.classList.toggle('hidden', selectedRides.size !== 2);
    }
};

window.deleteSelectedRides = async function() { 
    if(confirm("Verwijderen?")) { 
        await window.supabaseAuth.deleteActivities(Array.from(selectedRides)); 
        selectedRides.clear(); 
        updateDashboard(); 
    } 
};

window.triggerUpload = () => document.getElementById('gpxInput').click();

window.changeTheme = function(themeName) {
    document.documentElement.setAttribute('data-theme', themeName);
    localStorage.setItem('theme', themeName);
    
    const metaThemeColor = document.getElementById('theme-color-meta');
    if (metaThemeColor) {
        const colors = {
            'classic': '#FFFFFF',
            'ocean': '#0F172A',
            'gravel': '#1C1917',
            'cyberpunk': '#03040B',
            'stealth': '#000000'
        };
        metaThemeColor.setAttribute('content', colors[themeName] || '#03040B');
    }
    
    if (typeof updateCSMapTheme === 'function') updateCSMapTheme();
    if (typeof updateMuniMapTheme === 'function') updateMuniMapTheme();
    if (typeof updateSquadratMapTheme === 'function') updateSquadratMapTheme();
    
    if (window.updateDashboard) window.updateDashboard();
};

function updateMuniMapTheme() {
    if (!muniMap) return;
    const theme = document.documentElement.getAttribute('data-theme') || 'classic';
    const isLight = theme === 'classic'; 
    
    const tileUrl = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
    
    if (muniBaseLayer) {
        muniMap.removeLayer(muniBaseLayer);
    }
    
    muniBaseLayer = L.tileLayer(tileUrl, { 
        attribution: '© OpenStreetMap' 
    }).addTo(muniMap);
    
    muniBaseLayer.setZIndex(0); 
}

window.toggleThemeDropdown = function() {
    document.getElementById('themeDropdown').classList.toggle('open');
};

window.selectTheme = function(themeValue, icon, text) {
    document.getElementById('current-theme-icon').innerText = icon;
    document.getElementById('current-theme-text').innerText = text;
    document.getElementById('themeDropdown').classList.remove('open');
    window.changeTheme(themeValue);
};

document.addEventListener('click', function(e) {
    const dropdown = document.getElementById('themeDropdown');
    if (dropdown && !e.target.closest('.custom-theme-selector')) {
        dropdown.classList.remove('open');
    }
});

window.setWorldMode = function(mode) {
    currentWorldMode = 'heatmap';
    
    if(geoJsonLayer) muniMap.removeLayer(geoJsonLayer);
    if(tileLayerGroup) muniMap.removeLayer(tileLayerGroup);

    const user = window.supabaseAuth.getCurrentUser();
    if(localStorage.getItem(`heatmap_coords_${user.id}`)) {
        drawHeatmap();
    } else {
        drawHeatmap();
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

window.drawHeatmap = async function() {
    const loader = document.getElementById('muni-loading');
    if(loader) loader.classList.remove('hidden');

    if(heatmapLayerGroup) muniMap.removeLayer(heatmapLayerGroup);

    const canvasRenderer = L.canvas({ padding: 0.5 });
    heatmapLayerGroup = L.layerGroup().addTo(muniMap);
    heatmapLayers = []; 

    let acts = allActivitiesCache || await window.supabaseAuth.listActivities();
    acts = acts.filter(a => a.summary.type !== 'route' && a.summary.distanceKm > 0);
    
    sortedHeatmapActs = [...acts].sort((a,b) => new Date(a.summary.rideDate) - new Date(b.summary.rideDate));

    const user = window.supabaseAuth.getCurrentUser();
    const cacheKey = `heatmap_data_v2_${user.id}`; 
    let cached = JSON.parse(localStorage.getItem(cacheKey) || "{}");
    let cacheUpdated = false;

    for (let act of sortedHeatmapActs) {
        let pts = cached[act.id];
        
        if (!pts) {
            try {
                const b = await window.supabaseAuth.getActivityFile(act.id);
                const t = await b.text();
                const parsed = window.parseGPXData(t, act.fileName, true);
                
                if (parsed && parsed.uiData) {
                    pts = [];
                    const { latlngs } = parsed.uiData;
                    
                    for(let j = 0; j < latlngs.length; j += 5) {
                        pts.push([
                            parseFloat(latlngs[j][0].toFixed(5)), 
                            parseFloat(latlngs[j][1].toFixed(5))
                        ]);
                    }
                    cached[act.id] = pts;
                    cacheUpdated = true;
                }
            } catch (e) { console.error("Fout bij inladen rit voor heatmap:", e); }
        }

        if (pts && pts.length > 0) {
            const coords = pts.map(p => [p[0], p[1]]);
            const polyline = L.polyline(coords, { 
                renderer: canvasRenderer,
                color: '#ff4400', 
                weight: 3, 
                opacity: 0.15, 
                lineCap: 'round',
                lineJoin: 'round',
                className: 'heatmap-glow',
                interactive: false
            });

            polyline.addTo(heatmapLayerGroup);
            
            heatmapLayers.push({
                layer: polyline,
                timestamp: new Date(act.summary.rideDate).getTime()
            });
        }
    }

    if (cacheUpdated) {
        try {
            localStorage.setItem(cacheKey, JSON.stringify(cached));
        } catch(e) {
            localStorage.removeItem(`heatmap_coords_${user.id}`);
            localStorage.setItem(cacheKey, JSON.stringify(cached));
        }
    }

    if(loader) loader.classList.add('hidden');
    
    if (heatmapLayerGroup.getLayers().length > 0) {
        const bounds = L.featureGroup(heatmapLayerGroup.getLayers()).getBounds();
        muniMap.flyToBounds(bounds, { padding: [30, 30] });
    }
    
    const slider = document.getElementById('heatmap-time-slider');
    if(slider) slider.value = 100;
    const dateLabel = document.getElementById('heatmap-date-label');
    if(dateLabel) dateLabel.innerText = "Alle Tijd";
};

window.handleHeatmapSlider = function(val) {
    if (sortedHeatmapActs.length === 0 || heatmapLayers.length === 0) return;
    const index = Math.floor((val / 100) * (sortedHeatmapActs.length - 1));
    
    let cutoffTime;

    if (val == 100 || index >= sortedHeatmapActs.length - 1) {
        document.getElementById('heatmap-date-label').innerText = "Alle Tijd";
        cutoffTime = Infinity;
    } else {
        const actDate = new Date(sortedHeatmapActs[index].summary.rideDate);
        document.getElementById('heatmap-date-label').innerText = "Tot " + actDate.toLocaleDateString('nl-NL');
        cutoffTime = actDate.getTime();
    }

    heatmapLayers.forEach(item => {
        if (item.timestamp > cutoffTime) {
            if (heatmapLayerGroup.hasLayer(item.layer)) heatmapLayerGroup.removeLayer(item.layer);
        } else {
            if (!heatmapLayerGroup.hasLayer(item.layer)) heatmapLayerGroup.addLayer(item.layer);
        }
    });
};

function calculateSufferScores() {
    if (!allActivitiesCache) return;
    let maxRaw = 0;

    allActivitiesCache.forEach(act => {
        if (act.summary.type === 'route') return;
        const dist = parseFloat(act.summary.distanceKm) || 0;
        const elev = parseFloat(act.summary.elevationGain) || 0;
        const spd = parseFloat(act.summary.avgSpeed) || 0;
        const rawScore = (dist * 1.0) + (elev * 0.1) + (Math.pow(spd, 2) * 0.05);
        act.rawSuffer = rawScore;
        if (rawScore > maxRaw) maxRaw = rawScore;
    });

    allActivitiesCache.forEach(act => {
        if (act.summary.type === 'route') { act.summary.sufferScore = 0; return; }
        if (maxRaw === 0) { act.summary.sufferScore = 0; } 
        else {
            let scaled = (act.rawSuffer / maxRaw) * 100;
            act.summary.sufferScore = Math.max(1, scaled).toFixed(1); 
        }
    });
}

window.updatePremiumRideHeader = function(act) {
    if (!act || act.summary.type === 'route') {
        document.getElementById('premium-ride-header').classList.add('hidden');
        return;
    }

    document.getElementById('premium-ride-header').classList.remove('hidden');
    document.getElementById('premium-ride-name').innerText = act.fileName;

    const d = new Date(act.summary.rideDate);
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute:'2-digit' };
    document.getElementById('premium-ride-date').innerText = d.toLocaleDateString('nl-NL', options);

    const badgesContainer = document.getElementById('premium-badges');
    badgesContainer.innerHTML = '';

    if (!allActivitiesCache) return;
    const rides = allActivitiesCache.filter(a => a.summary.type !== 'route');
    let badgesHTML = '';

    const createBadge = (index, total, label) => {
        if (index === -1 || index >= 25) return '';
        const rank = index + 1;
        let colorClass = 'badge-standard';

        if (rank === 1) colorClass = 'badge-gold';
        else if (rank === 2) colorClass = 'badge-silver';
        else if (rank === 3) colorClass = 'badge-bronze';

        return `<div class="record-badge ${colorClass}">Top ${rank} ${label}</div>`;
    };

    const distSorted = [...rides].sort((a,b) => (parseFloat(b.summary.distanceKm)||0) - (parseFloat(a.summary.distanceKm)||0));
    const distIdx = distSorted.findIndex(a => a.id === act.id);
    badgesHTML += createBadge(distIdx, rides.length, 'Afstand');

    const elevSorted = [...rides].sort((a,b) => (parseFloat(b.summary.elevationGain)||0) - (parseFloat(a.summary.elevationGain)||0));
    const elevIdx = elevSorted.findIndex(a => a.id === act.id);
    if ((parseFloat(act.summary.elevationGain)||0) > 50) {
        badgesHTML += createBadge(elevIdx, rides.length, 'Hoogte');
    }

    const spdSorted = [...rides].sort((a,b) => (parseFloat(b.summary.avgSpeed)||0) - (parseFloat(a.summary.avgSpeed)||0));
    const spdIdx = spdSorted.findIndex(a => a.id === act.id);
    badgesHTML += createBadge(spdIdx, rides.length, 'Snelheid');

    if (act.summary.sufferScore) {
        const sufSorted = [...rides].sort((a,b) => (parseFloat(b.summary.sufferScore)||0) - (parseFloat(a.summary.sufferScore)||0));
        const sufIdx = sufSorted.findIndex(a => a.id === act.id);
        badgesHTML += createBadge(sufIdx, rides.length, 'Suffer Score');
    }

    badgesContainer.innerHTML = badgesHTML;
};

window.populateRideSummary = function(act) {
    if (!act || !act.summary) return;

    document.getElementById('sum-title').innerText = act.fileName;
    const d = new Date(act.summary.rideDate);
    document.getElementById('sum-date').innerText = d.toLocaleDateString('nl-NL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute:'2-digit' });

    document.getElementById('sum-dist').innerHTML = `${parseFloat(act.summary.distanceKm).toFixed(1)} <small>km</small>`;

    let timeStr = "0:00";
    if (act.summary.durationSec) {
        const h = Math.floor(act.summary.durationSec / 3600);
        const m = Math.floor((act.summary.durationSec % 3600) / 60);
        timeStr = `${h}:${m.toString().padStart(2, '0')}`;
    }

    document.getElementById('sum-time').innerText = timeStr;
    document.getElementById('sum-avg').innerHTML = `${parseFloat(act.summary.avgSpeed || 0).toFixed(1)} <small>km/u</small>`;
    document.getElementById('sum-max').innerHTML = `${parseFloat(act.summary.maxSpeed || 0).toFixed(1)} <small>km/u</small>`;
    document.getElementById('sum-elev').innerHTML = `${Math.round(act.summary.elevationGain || 0)} <small>m</small>`;

    const massKg = 85;
    const avgSpeedMs = parseFloat(act.summary.avgSpeed || 0) / 3.6;
    let powerW = 0;
    if (avgSpeedMs > 1) {
        powerW = (0.5 * 1.225 * 0.5 * 1.1 * Math.pow(avgSpeedMs, 3)) + (0.005 * massKg * 9.81 * avgSpeedMs);
    }
    act.summary.avgPower = Math.round(powerW);
    document.getElementById('sum-power').innerHTML = `${act.summary.avgPower} <small>W</small>`;

    const badgesContainer = document.getElementById('sum-badges');
    badgesContainer.innerHTML = '';
    if (allActivitiesCache) {
        const rides = allActivitiesCache.filter(a => a.summary.type !== 'route');
        const createBadge = (index, label) => {
            if (index === -1) return '';
            const rank = index + 1;
            let color = rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : 'standard';
            return `<div class="record-badge badge-${color}"><strong>${rank}e</strong> ${label}</div>`;
        };

        const distIdx = [...rides].sort((a,b) => (parseFloat(b.summary.distanceKm)||0) - (parseFloat(a.summary.distanceKm)||0)).findIndex(a => a.id === act.id);
        badgesContainer.innerHTML += createBadge(distIdx, 'Langste Rit');

        const elevIdx = [...rides].sort((a,b) => (parseFloat(b.summary.elevationGain)||0) - (parseFloat(a.summary.elevationGain)||0)).findIndex(a => a.id === act.id);
        if ((parseFloat(act.summary.elevationGain)||0) > 50) badgesContainer.innerHTML += createBadge(elevIdx, 'Hoogste Rit');

        const spdIdx = [...rides].sort((a,b) => (parseFloat(b.summary.avgSpeed)||0) - (parseFloat(a.summary.avgSpeed)||0)).findIndex(a => a.id === act.id);
        badgesContainer.innerHTML += createBadge(spdIdx, 'Snelste Rit');
    }

    const segContainer = document.getElementById('sum-segments');
    segContainer.innerHTML = '';
    if (act.summary.segments && act.summary.segments.length > 0) {
        const topSegs = act.summary.segments.slice(0, 3);
        segContainer.innerHTML = topSegs.map(s => `<div class="summary-segment-item"><strong>${s.distance} km Sprint</strong><span class="primary-text">${s.speed.toFixed(1)} km/u</span></div>`).join('');
    } else {
        segContainer.innerHTML = '<p class="sub-text">Geen segmenten berekend voor deze rit.</p>';
    }
};

window.switchCompareChart = function(type) {
    document.getElementById('btn-chart-ytd').classList.toggle('active', type === 'ytd');
    document.getElementById('btn-chart-month').classList.toggle('active', type === 'month');

    if (type === 'ytd') {
        document.getElementById('wrapper-ytd').classList.remove('hidden');
        document.getElementById('wrapper-month').classList.add('hidden');
    } else {
        document.getElementById('wrapper-ytd').classList.add('hidden');
        document.getElementById('wrapper-month').classList.remove('hidden');
    }
};

function renderMonthlyComparisonChart(activities) {
    const ctx = document.getElementById('monthlyComparisonChart').getContext('2d');
    if (activeCharts['monthlyCompChart']) activeCharts['monthlyCompChart'].destroy();

    const currentYear = new Date().getFullYear();
    const yearlyData = {};

    activities.forEach(act => {
        if (act.summary.type === 'route') return;
        const y = new Date(act.summary.rideDate).getFullYear();
        if (!yearlyData[y]) yearlyData[y] = new Array(12).fill(0);
    });

    if (!yearlyData[currentYear]) yearlyData[currentYear] = new Array(12).fill(0);

    activities.forEach(act => {
        if (act.summary.type === 'route') return;
        const d = new Date(act.summary.rideDate);
        yearlyData[d.getFullYear()][d.getMonth()] += parseFloat(act.summary.distanceKm) || 0;
    });

    const sortedYears = Object.keys(yearlyData).sort((a, b) => b - a); 
    const pastColors = ['#888888', '#00acc1', '#10B981', '#F59E0B', '#EF4444'];

    const datasets = sortedYears.map((year, index) => {
        const isCurrent = parseInt(year) === currentYear;
        const color = isCurrent ? '#FC5200' : (pastColors[index - 1] || '#555555');

        return {
            label: `Jaar ${year}`,
            data: yearlyData[year],
            borderColor: color,
            backgroundColor: isCurrent ? 'rgba(252, 82, 0, 0.1)' : 'transparent',
            borderWidth: isCurrent ? 3 : 2,
            borderDash: isCurrent ? [] : [5, 5], 
            fill: isCurrent, 
            tension: 0.4,
            pointRadius: isCurrent ? 4 : 0,
            pointBackgroundColor: color,
            order: isCurrent ? 0 : 1
        };
    });

    const isDark = document.body.classList.contains('dark-mode');
    const chartTextColor = isDark ? '#f0f0f0' : '#333333';
    const chartTextMuted = isDark ? '#aaaaaa' : '#666666';
    const chartGridColor = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';

    activeCharts['monthlyCompChart'] = new Chart(ctx, {
        type: 'line', 
        data: {
            labels: ['Jan', 'Feb', 'Mrt', 'Apr', 'Mei', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec'],
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'top', labels: { color: chartTextColor, usePointStyle: true, padding: 20 } },
                tooltip: { mode: 'index', intersect: false, backgroundColor: 'rgba(0, 0, 0, 0.8)', titleColor: '#fff', bodyColor: '#fff' }
            },
            scales: {
                x: { grid: { display: false }, ticks: { color: chartTextMuted } },
                y: { grid: { color: chartGridColor }, ticks: { color: chartTextMuted } }
            }
        }
    });
}

window.loadRankings = async function(distArg) {
    if (activeCharts['segChart']) {
        activeCharts['segChart'].destroy();
        delete activeCharts['segChart'];
    }

    const listEl = document.getElementById('ranking-list');
    listEl.innerHTML = `
        <div class="skeleton skeleton-list-item"></div>
        <div class="skeleton skeleton-list-item"></div>
    `;

    if(!allActivitiesCache) allActivitiesCache = await window.supabaseAuth.listActivities();

    const selector = document.getElementById('segmentSelector');
    const selectedDist = parseInt(distArg || (selector ? selector.value : "5"));
    
    const topFilterElement = document.getElementById('segmentTopFilter');
    const topFilter = topFilterElement ? topFilterElement.value : '10';
    
    const maxElevInput = document.getElementById('segmentMaxElev');
    const maxElev = maxElevInput && maxElevInput.value ? parseFloat(maxElevInput.value) : Infinity;

    let rankingData = [];

    allActivitiesCache.forEach(act => {
        if (act.summary.type === 'route') return;
        const rideElev = parseFloat(act.summary.elevationGain) || 0;
        if (rideElev > maxElev) return;

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

    if (topFilter !== 'all') {
        rankingData = rankingData.slice(0, parseInt(topFilter));
    }

    if (rankingData.length === 0) {
        listEl.innerHTML = `
            <div class="empty-state" style="padding:40px;">
                <h3 style="margin-bottom:10px;">Geen data gevonden</h3>
                <p>Er zijn geen ritten die voldoen aan je ingestelde filters.</p>
            </div>`;
        return;
    }

    const fragment = document.createDocumentFragment();
    rankingData.forEach((item, i) => {
        const rankLabel = i === 0 ? '1st' : i === 1 ? '2nd' : i === 2 ? '3rd' : `${i+1}th`;
        const color = i === 0 ? 'var(--medal-gold)' : i === 1 ? 'var(--medal-silver)' : i === 2 ? 'var(--medal-bronze)' : 'var(--text-muted)';
        
        const totSec = Math.floor(item.timeMs / 1000);
        const h = Math.floor(totSec / 3600);
        const m = Math.floor((totSec % 3600) / 60);
        const s = totSec % 60;
        const timeStr = h > 0 ? `${h}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}` : `${m}:${s.toString().padStart(2,'0')}`;

        const div = document.createElement('div');
        div.className = 'dash-list-item';
        div.style.cursor = 'pointer';
        div.innerHTML = `
            <div style="display:flex; align-items:center; gap:16px;">
                <span style="font-weight:800; color:${color}; width:40px; text-align:center; font-size:1.1rem;">${rankLabel}</span>
                <div>
                    <strong style="font-size:1rem; display:block; color:var(--text-main);">${escapeHtml(item.activity.fileName)}</strong>
                    <small class="sub-text">${item.date.toLocaleDateString()} • ${timeStr}</small>
                </div>
            </div>
            <div style="text-align:right;">
                <strong style="font-size:1.2rem; color:var(--primary);" class="stat-value">${item.speed.toFixed(1)} <small>km/u</small></strong>
            </div>
        `;
        div.addEventListener('click', () => {
            switchTab('analysis');
            window.openRide(item.activity);
        });
        fragment.appendChild(div);
    });

    listEl.innerHTML = '';
    listEl.appendChild(fragment);

    if (rankingData.length > 1) {
        document.getElementById('segment-progression-container').classList.remove('hidden');
        setTimeout(() => {
            updateTrendChart(rankingData);
        }, 50);
    } else {
        document.getElementById('segment-progression-container').classList.add('hidden');
    }
};

function updateTrendChart(data) {
    const canvas = document.getElementById('segmentProgressionChart');
    if (!canvas) return; 
    
    const ctx = canvas.getContext('2d');
    if(activeCharts['segChart']) activeCharts['segChart'].destroy();

    const chronological = [...data].sort((a,b) => a.date - b.date);
    
    let gradient = ctx.createLinearGradient(0, 0, 0, 400);
    gradient.addColorStop(0, 'rgba(16, 185, 129, 0.5)'); 
    gradient.addColorStop(1, 'rgba(16, 185, 129, 0.0)'); 

    activeCharts['segChart'] = new Chart(ctx, {
        type: 'line',
        data: {
            labels: chronological.map(d => d.date.toLocaleDateString()),
            datasets: [{
                label: 'Snelheid (km/u)',
                data: chronological.map(d => d.speed),
                borderColor: '#10B981',
                backgroundColor: gradient,
                tension: 0.4,
                fill: true
            }]
        },
        options: { 
            responsive: true, 
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false } 
            },
            scales: {
                y: { title: { display: true, text: 'km/u' } }
            }
        }
    });
}

window.showMapAnalysis = function() {
    document.getElementById('ride-summary-dashboard').classList.add('hidden');
    document.getElementById('ride-map-view').classList.remove('hidden');

    if (typeof map !== 'undefined' && map) {
        setTimeout(() => {
            map.invalidateSize(); 
            if (typeof polyline !== 'undefined' && polyline) {
                map.fitBounds(polyline.getBounds(), {
                    paddingTopLeft: [20, 20],
                    paddingBottomRight: [20, 20], 
                    animate: false 
                });
            }
        }, 50);
    }
};

window.backToSummary = function() {
    if (window.resetPlayback) window.resetPlayback(); 
    
    document.getElementById('ride-map-view').classList.add('hidden');
    document.getElementById('ride-summary-dashboard').classList.remove('hidden');
};

window.checkProfileSetup = async function() {
    const profile = await window.supabaseAuth.getProfile();
    if (!profile || !profile.display_name) {
        document.getElementById('profile-modal').classList.add('show');
    } else {
        window.currentDisplayName = profile.display_name;
        window.userWeights = JSON.parse(localStorage.getItem('user_weights') || '{"rider": 75, "bike": 9}');
    }
};

window.saveProfileName = async function() {
    const name = document.getElementById('profile-name-input').value.trim();
    const riderW = parseFloat(document.getElementById('profile-rider-weight').value) || 75;
    const bikeW = parseFloat(document.getElementById('profile-bike-weight').value) || 9;

    if (!name) { alert("Vul een naam in!"); return; }

    const btn = event.target;
    btn.innerText = "Opslaan...";
    btn.disabled = true;

    try {
        await window.supabaseAuth.updateProfile(name);
        
        window.userWeights = { rider: riderW, bike: bikeW };
        localStorage.setItem('user_weights', JSON.stringify(window.userWeights));

        document.getElementById('profile-modal').classList.remove('show');
        window.currentDisplayName = name;
        alert("Profiel succesvol opgeslagen!");
    } catch (e) {
        btn.innerText = "Opslaan & Verder";
        btn.disabled = false;
    }
};

window.searchCommunity = async function() {
    const term = document.getElementById('community-search').value.trim();
    const resultsContainer = document.getElementById('community-results');

    if (!term) {
        resultsContainer.innerHTML = '<p class="empty-state">Typ een naam om te zoeken.</p>';
        return;
    }

    resultsContainer.innerHTML = '<div class="skeleton skeleton-list-item"></div>';

    try {
        const users = await window.supabaseAuth.searchProfiles(term);

        if (users.length === 0) {
            resultsContainer.innerHTML = '<p class="empty-state">Niemand gevonden met die naam.</p>';
            return;
        }

        const fragment = document.createDocumentFragment();
        users.forEach(u => {
            const div = document.createElement('div');
            div.className = 'dash-list-item';
            div.style.alignItems = 'center';
            div.style.cursor = 'default';
            div.innerHTML = `
                <div style="flex:1;">
                    <strong style="display:block; font-size:1.1rem; color:var(--text-main);">${escapeHtml(u.display_name)}</strong>
                </div>
                <button class="btn-secondary profile-btn">Bekijk Profiel</button>
            `;
            div.querySelector('.profile-btn').addEventListener('click', () => openPublicProfile(u.id, u.display_name));
            fragment.appendChild(div);
        });
        
        resultsContainer.innerHTML = '';
        resultsContainer.appendChild(fragment);

    } catch (e) {
        console.error(e);
        resultsContainer.innerHTML = '<p class="error-msg text-center">Fout bij zoeken.</p>';
    }
};

window.openPublicProfile = async function(userId, displayName) {
    document.querySelectorAll('.view-section').forEach(v => v.classList.add('hidden'));
    document.getElementById('view-public-profile').classList.remove('hidden');

    document.getElementById('public-profile-name').innerText = `Profiel: ${displayName}`;
    document.getElementById('public-total-dist').innerHTML = '<span class="skeleton skeleton-val"></span>';
    document.getElementById('public-total-elev').innerHTML = '<span class="skeleton skeleton-val"></span>';
    document.getElementById('public-total-rides').innerHTML = '<span class="skeleton skeleton-val"></span>';
    document.getElementById('public-activities-list').innerHTML = '<div class="skeleton skeleton-list-item"></div><div class="skeleton skeleton-list-item"></div>';

    try {
        const { data, error } = await window.supabase.from('activities')
            .select('id, file_name, summary, ride_date')
            .eq('user_id', userId)
            .order('ride_date', { ascending: false });

        if (error) throw error;

        const realRides = data.filter(a => a.summary && a.summary.type !== 'route');

        let dist = 0; let elev = 0;
        realRides.forEach(r => {
            dist += parseFloat(r.summary.distanceKm || 0);
            elev += parseFloat(r.summary.elevationGain || 0);
        });

        document.getElementById('public-total-dist').innerHTML = `${Math.round(dist)} <small>km</small>`;
        document.getElementById('public-total-elev').innerHTML = `${Math.round(elev)} <small>m</small>`;
        document.getElementById('public-total-rides').innerHTML = realRides.length;

        const actList = document.getElementById('public-activities-list');
        if (realRides.length === 0) {
            actList.innerHTML = '<p class="empty-state">Nog geen ritten gefietst.</p>';
        } else {
            const fragment = document.createDocumentFragment();
            realRides.forEach(act => {
                const div = document.createElement('div');
                div.className = 'dash-list-item';
                div.style.cursor = 'default';
                div.innerHTML = `
                    <div style="flex:1; display:flex; justify-content:space-between; align-items:center;">
                        <div style="display:flex; flex-direction:column;">
                            <strong style="color:var(--text-main); font-weight:600;">${escapeHtml(act.file_name)}</strong>
                            <small class="sub-text">${new Date(act.ride_date).toLocaleDateString()}</small>
                        </div>
                        <span class="primary-text">${parseFloat(act.summary.distanceKm).toFixed(1)} km</span>
                    </div>
                `;
                fragment.appendChild(div);
            });
            actList.innerHTML = '';
            actList.appendChild(fragment);
        }
    } catch(e) {
        console.error(e);
        document.getElementById('public-activities-list').innerHTML = '<p class="error-msg">Kon ritten niet inladen.</p>';
    }
};

// ============================================================================
// TERRITORIUM (CONVEX HULL) LOGICA MET TURF.JS
// ============================================================================

let squadratMap = null;
let squadratLayerGroup = null;

function initSquadratMap() {
    if (squadratMap) { 
        squadratMap.invalidateSize(); 
        updateSquadratMapTheme(); 
        return; 
    }
    
    squadratMap = L.map('map-squadrats').setView([51.185, 3.565], 11);
    updateSquadratMapTheme();
}

function updateSquadratMapTheme() {
    if (!squadratMap) return;
    const tileUrl = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
    
    squadratMap.eachLayer(l => {
        if (l instanceof L.TileLayer) squadratMap.removeLayer(l);
    });
    
    L.tileLayer(tileUrl, { attribution: '© OpenStreetMap' }).addTo(squadratMap).setZIndex(0);
}

// --- Territorium-hulpfuncties: alleen echte lussen tellen, geen rechte sluitlijnen over tientallen km ---
function sqDist(a, b) { // a, b = [lng, lat]; resultaat in meter
    const kx = 111320 * Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180), ky = 110574;
    return Math.hypot((a[0] - b[0]) * kx, (a[1] - b[1]) * ky);
}
function sqCumLen(c) {
    const cum = [0];
    for (let i = 1; i < c.length; i++) cum.push(cum[i - 1] + sqDist(c[i - 1], c[i]));
    return cum;
}
// Splits een track bij GPS-sprongen (signaalverlies): anders trekt de rit één rechte lijn over de sprong.
// Losse foute punten (een "spike" die meteen terugspringt) worden weggelaten zodat de rit heel blijft.
function sqSplitAtJumps(coords, maxJumpM) {
    const segs = [];
    let cur = [coords[0]];
    for (let i = 1; i < coords.length; i++) {
        if (sqDist(coords[i - 1], coords[i]) > maxJumpM) { segs.push(cur); cur = []; }
        cur.push(coords[i]);
    }
    segs.push(cur);

    const out = [];
    for (let k = 0; k < segs.length; k++) {
        const sg = segs[k];
        const prev = out.length ? out[out.length - 1] : null;
        if (sg.length < 4 && prev && k + 1 < segs.length) {
            // outlier: als het stuk ervoor en erna weer aansluiten, plak ze aan elkaar
            const next = segs[k + 1];
            if (sqDist(prev[prev.length - 1], next[0]) <= maxJumpM) {
                out[out.length - 1] = prev.concat(next);
                k++;
                continue;
            }
        }
        if (sg.length >= 4 || !prev) out.push(sg);
    }
    return out;
}
// Geeft de punten van de lus in deze track terug, of null als er geen lus in zit.
// Begin en eind moeten dicht bij elkaar liggen (max ~10% van de lengte, tussen 0,5 en 5 km).
// Zo niet, dan zoeken we het grootste stuk van de rit dat wél terug bij zichzelf uitkomt.
function sqExtractLoop(c) {
    const cum = sqCumLen(c);
    const gapOk = (i, j) => {
        const L = cum[j] - cum[i];
        return L > 0 && sqDist(c[i], c[j]) <= Math.min(5000, Math.max(500, L * 0.1));
    };
    if (gapOk(0, c.length - 1)) return c;

    const step = Math.max(1, Math.ceil(c.length / 250));
    let best = null, bestLen = 0;
    for (let i = 0; i < c.length; i += step) {
        for (let j = c.length - 1; j > i; j -= step) {
            const L = cum[j] - cum[i];
            if (L <= bestLen) break;               // verder naar links kan alleen korter worden
            if (gapOk(i, j)) { best = [i, j]; bestLen = L; break; }
        }
    }
    return best ? c.slice(best[0], best[1] + 1) : null;
}
// Alle gesloten gebieden (turf-polygonen) van één rit
function sqPolygonsFromTrack(pts) {
    const coords = [];
    for (let i = 0; i < pts.length; i += 3) coords.push([pts[i][1], pts[i][0]]);
    coords.push([pts[pts.length - 1][1], pts[pts.length - 1][0]]);

    const result = [];
    for (const seg of sqSplitAtJumps(coords, 2000)) {
        if (seg.length < 10) continue;
        // ~5 m vereenvoudigen: sneller en minder gekronkel door GPS-ruis
        let line = turf.simplify(turf.lineString(seg), { tolerance: 0.00005, highQuality: false }).geometry.coordinates;
        if (line.length < 3) continue;
        const loop = sqExtractLoop(line);
        if (!loop || loop.length < 3) continue;
        // dubbele opeenvolgende punten (pauzes, start == einde) weghalen: turf weigert die
        const clean = loop.filter((p, i) => i === 0 || p[0] !== loop[i - 1][0] || p[1] !== loop[i - 1][1]);
        while (clean.length > 1 && clean[clean.length - 1][0] === clean[0][0] && clean[clean.length - 1][1] === clean[0][1]) clean.pop();
        if (clean.length < 3) continue;
        const ring = clean.concat([clean[0]]);

        try {
            // Kruist de track zichzelf (bv. een 8)? Dan splitsen we in aparte lussen en tellen elke lus mee
            turf.unkinkPolygon(turf.polygon([ring])).features.forEach(p => {
                const area = turf.area(p);                                  // m²
                if (area < 100000) return;                                  // < 0,1 km² = heen-en-weer langs dezelfde weg
                const perim = sqCumLen(p.geometry.coordinates[0]).pop();    // m
                if (4 * Math.PI * area / (perim * perim) < 0.03) return;    // extreem dunne sliert (heen en terug langs dezelfde weg)
                result.push(p);
            });
        } catch (e) {
            console.warn("Lus overgeslagen (ongeldige geometrie):", e.message);
        }
    }
    return result;
}

window.calculateAndDrawSquadrats = async function() {
    const loader = document.getElementById('squadrat-loading');
    if(loader) loader.classList.remove('hidden');

    if(squadratLayerGroup) squadratMap.removeLayer(squadratLayerGroup);
    
    squadratLayerGroup = L.layerGroup().addTo(squadratMap);

    let acts = allActivitiesCache || await window.supabaseAuth.listActivities();
    acts = acts.filter(a => a.summary.type !== 'route' && a.summary.distanceKm > 0);

    const user = window.supabaseAuth.getCurrentUser();
    const cacheKey = `heatmap_data_v2_${user.id}`; 
    let cached = JSON.parse(localStorage.getItem(cacheKey) || "{}");

    let totalAreaKm2 = 0;
    let polygonCount = 0;

    document.querySelector('#view-squadrats h2').innerText = "Mijn Territorium";
    document.querySelector('#view-squadrats .sub-text').innerText = "Elke rit heeft een eigen kleur. Waar ritten overlappen ligt de nieuwste bovenop.";
    document.querySelectorAll('#view-squadrats .stat-label')[0].innerText = "Veroverde Gebieden";

    // Territorium = alles BINNEN de lussen van je ritten (alleen als begin en eind dicht bij elkaar liggen)
    // Oudste rit eerst: later getekende lagen liggen bovenop, dus de nieuwste rit blijft altijd zichtbaar
    acts = [...acts].sort((a, b) => new Date(a.summary.rideDate) - new Date(b.summary.rideDate));

    const rides = [];    // { act, polys } per rit, in volgorde oud -> nieuw
    const pieces = [];   // alle polygonen, alleen voor de totale oppervlakte
    let n = 0;
    for (let act of acts) {
        const pts = cached[act.id];
        if (!pts || pts.length <= 10) continue;
        if (++n % 5 === 0) await new Promise(r => setTimeout(r)); // UI niet laten bevriezen

        try {
            const polys = sqPolygonsFromTrack(pts);
            if (polys.length) { rides.push({ act, polys }); pieces.push(...polys); }
        } catch (e) {
            console.warn("Kon gebied niet berekenen voor rit:", act.fileName, e);
        }
    }

    // Elke rit een eigen kleur (gouden hoek: opeenvolgende ritten krijgen sterk verschillende tinten)
    rides.forEach((r, i) => {
        const color = `hsl(${Math.round((i * 137.508) % 360)}, 80%, 48%)`;
        const label = `${new Date(r.act.summary.rideDate).toLocaleDateString()} • ${Number(r.act.summary.distanceKm).toFixed(1)} km`;
        L.geoJSON(turf.featureCollection(r.polys), {
            style: { color, weight: 2, fillColor: color, fillOpacity: 0.55, lineJoin: 'round' },
            onEachFeature: (f, l) => l.bindTooltip(label, { sticky: true })
        }).addTo(squadratLayerGroup);
    });

    // Totale oppervlakte: overlappende gebieden tellen maar één keer
    let territory = null;
    for (const p of pieces) {
        try { territory = territory ? turf.union(territory, p) : p; }
        catch (e) { console.warn("Samenvoegen mislukt voor een gebied", e); }
    }

    if (territory) {
        totalAreaKm2 = turf.area(territory) / 1000000;
        polygonCount = territory.geometry.type === 'MultiPolygon' ? territory.geometry.coordinates.length : 1;
    }

    document.getElementById('squadrat-count').innerText = polygonCount;
    document.getElementById('squadrat-area').innerText = totalAreaKm2.toFixed(1);

    if(loader) loader.classList.add('hidden');

    if (squadratLayerGroup.getLayers().length > 0) {
        const bounds = L.featureGroup(squadratLayerGroup.getLayers()).getBounds();
        squadratMap.flyToBounds(bounds, { padding: [40, 40] });
    }
};