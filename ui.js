// ui.js - Dashboard, Recap, Rankings, ROUTE PLANNER (Apart) & Heatmap Interactie

let allActivitiesCache = null; 
let muniMap = null; 
let heatmapMap = null; 
let routeMap = null; 
let geoJsonLayer = null; 
let conqueredMunis = new Set(); 
let selectedRides = new Set(); 
let activeCharts = {}; 

// Route Planner variabelen (GECORRIGEERD)
let waypoints = []; 
let routePolyline = null; 
let routeSegments = []; 

const REGIONS = [
    { code: 'be', url: 'communes.json', type: 'topojson', nameFields: ['Gemeente', 'name', 'NAME_4', 'Name'] },
    { code: 'nl', url: 'https://cartomap.github.io/nl/wgs84/gemeente_2023.geojson', type: 'geojson', nameFields: ['statnaam'] }
];

document.addEventListener('DOMContentLoaded', () => {
    setupNavigation();
    setupSegmentSelector();
    const now = new Date();
    const ms = document.getElementById('recap-month-select');
    const ys = document.getElementById('recap-year-select');
    if(ms) ms.value = now.getMonth();
    if(ys) ys.value = now.getFullYear();
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
            opt.value = k; opt.text = `${k} km`; select.appendChild(opt);
        }
        select.value = "5";
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

    setTimeout(() => {
        if(tabName === 'analysis' && typeof map !== 'undefined' && map) map.invalidateSize();
        if(tabName === 'routes') { initRouteMap(); updateSavedRoutesList(); } 
        if(tabName === 'municipalities' && muniMap) muniMap.invalidateSize();
        if(tabName === 'heatmap' && heatmapMap) heatmapMap.invalidateSize();
    }, 150);

    if(tabName === 'dashboard') updateDashboard();
    if(tabName === 'recap') updateRecapView();
    if(tabName === 'municipalities') initMuniMap();
    if(tabName === 'heatmap') initHeatmapMap();
    if(tabName === 'rankings') switchRankingTab('segments');
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

function drawFullRoute() {
    if (routePolyline) routeMap.removeLayer(routePolyline);
    const fullPath = routeSegments.flat();
    routePolyline = L.polyline(fullPath, {color: '#fc4c02', weight: 5}).addTo(routeMap);
    updateRouteStats(fullPath);
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
                elevationGain: 0,
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

async function updateSavedRoutesList() {
    const list = document.getElementById('saved-routes-list');
    if(!list) return;
    if(!allActivitiesCache) allActivitiesCache = await window.supabaseAuth.listActivities();
    const routes = allActivitiesCache.filter(a => a.summary.type === 'route');
    if(routes.length === 0) { list.innerHTML = '<small style="color:var(--text-muted); padding:10px;">Nog geen routes.</small>'; return; }
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

async function updateDashboard() {
    if(!window.supabaseAuth.getCurrentUser()) return;
    allActivitiesCache = await window.supabaseAuth.listActivities();
    const realRides = allActivitiesCache.filter(a => a.summary.type !== 'route');
    let d=0, e=0; 
    realRides.forEach(a => { d += parseFloat(a.summary.distanceKm||0); e += parseFloat(a.summary.elevationGain||0); });
    const u = (id, v) => { if(document.getElementById(id)) document.getElementById(id).innerText = v; };
    u('total-dist', d.toFixed(0) + ' km'); u('total-elev', e.toFixed(0) + ' m'); u('total-rides', realRides.length);
    renderActivityList(realRides.slice(0, 8));
}

async function updateRecapView() {
    if(!allActivitiesCache) allActivitiesCache = await window.supabaseAuth.listActivities();
    const selM = document.getElementById('recap-month-select').value;
    const selY = parseInt(document.getElementById('recap-year-select').value);
    const filtered = allActivitiesCache.filter(act => {
        if (act.summary.type === 'route') return false; 
        const d = new Date(act.summary.rideDate);
        return d.getFullYear() === selY && (selM === 'all' || d.getMonth() === parseInt(selM));
    });
    let d=0, e=0, s=0;
    filtered.forEach(act => { d += parseFloat(act.summary.distanceKm); e += act.summary.elevationGain; s += parseFloat(act.summary.avgSpeed); });
    const avgS = filtered.length > 0 ? (s / filtered.length).toFixed(1) : 0;
    document.getElementById('recap-dist').innerText = d.toFixed(1) + ' km';
    document.getElementById('recap-elev').innerText = e.toFixed(0) + ' m';
    document.getElementById('recap-count').innerText = filtered.length;
    document.getElementById('recap-speed').innerText = avgS + ' km/u';
    const yearDist = allActivitiesCache.filter(act => act.summary.type !== 'route' && new Date(act.summary.rideDate).getFullYear() === selY).reduce((acc, a) => acc + parseFloat(a.summary.distanceKm), 0);
    const goalPercent = Math.min(100, (yearDist / 5000) * 100).toFixed(1);
    document.getElementById('recap-goal-percent').innerText = goalPercent + '%';
    document.getElementById('recap-goal-fill').style.width = goalPercent + '%';
    const sorted = [...filtered].sort((a,b) => b.summary.distanceKm - a.summary.distanceKm).slice(0, 3);
    document.getElementById('recap-best-list').innerHTML = sorted.map(act => `
        <div class="rank-card" onclick="switchTab('analysis'); window.openRide(${JSON.stringify(act).replace(/"/g, '&quot;')})">
            <div><strong>${act.fileName}</strong><br><small>${new Date(act.summary.rideDate).toLocaleDateString()}</small></div>
            <div style="text-align:right"><strong>${act.summary.distanceKm} km</strong></div>
        </div>`).join('') || '<p style="text-align:center;">Geen ritten gevonden.</p>';
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
    document.getElementById('muni-count').innerText = conqueredMunis.size;
    document.getElementById('muni-total').innerText = total;
    const p = total > 0 ? (conqueredMunis.size / total * 100).toFixed(1) : 0;
    document.getElementById('muni-percent').innerText = p + '%';
    document.getElementById('muni-progress-fill').style.width = p + '%';
    geoJsonLayer.eachLayer(l => {
        if (conqueredMunis.has(l.muniName)) l.setStyle({ fillColor: '#fc4c02', fillOpacity: 0.7, color: '#d94002', weight: 2 });
        else l.setStyle({ fillColor: 'transparent', color: 'transparent', weight: 0 });
    });
}

async function initHeatmapMap() {
    if (heatmapMap) { heatmapMap.invalidateSize(); return; }
    heatmapMap = L.map('map-heatmap', { zoomControl: true, attributionControl: false }).setView([50.85, 4.35], 7);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png').addTo(heatmapMap);
    heatmapMap.on('click', async (e) => {
        const user = window.supabaseAuth.getCurrentUser();
        const cacheKey = `heatmap_coords_${user.id}`;
        let cached = JSON.parse(localStorage.getItem(cacheKey) || "{}");
        const matches = [];
        for (const id in cached) {
            if (cached[id].some(c => e.latlng.distanceTo(L.latLng(c[0], c[1])) < 45)) {
                const act = allActivitiesCache.find(a => a.id === id);
                if (act) matches.push(act);
            }
        }
        if (matches.length > 0) {
            const html = `<div style="min-width:180px;"><strong>🔥 ${matches.length} ritten hier</strong><div style="margin-top:8px; max-height:150px; overflow-y:auto;">${matches.map(m => `<div style="margin-bottom:8px; cursor:pointer; color:#007bff;" onclick='window.openRideFromHeatmap(${JSON.stringify(m).replace(/"/g, "&quot;")})'>${m.fileName}</div>`).join('')}</div></div>`;
            L.popup().setLatLng(e.latlng).setContent(html).openOn(heatmapMap);
        }
    });
}

window.openRideFromHeatmap = function(act) { heatmapMap.closePopup(); switchTab('analysis'); window.openRide(act); };

window.generateHeatmap = async function() {
    const bar = document.getElementById('heatmap-bar');
    document.getElementById('heatmap-progress').style.display = "block";
    let acts = allActivitiesCache || await window.supabaseAuth.listActivities();
    acts = acts.filter(a => a.summary.type !== 'route'); 
    heatmapMap.eachLayer(l => { if (l instanceof L.Polyline) heatmapMap.removeLayer(l); });
    const user = window.supabaseAuth.getCurrentUser();
    const cacheKey = `heatmap_coords_${user.id}`;
    let cached = JSON.parse(localStorage.getItem(cacheKey) || "{}");
    for (let i = 0; i < acts.length; i++) {
        bar.style.width = Math.round(((i + 1) / acts.length) * 100) + "%";
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
        if (pts) L.polyline(pts, { color: '#fc4c02', opacity: 0.35, weight: 2.5 }).addTo(heatmapMap);
    }
    localStorage.setItem(cacheKey, JSON.stringify(cached));
    setTimeout(() => document.getElementById('heatmap-progress').style.display = "none", 1000);
};

window.clearHeatmapCache = function() {
    const u = window.supabaseAuth.getCurrentUser();
    localStorage.removeItem(`heatmap_coords_${u.id}`);
    location.reload();
};

window.switchRankingTab = async function(tab) {
    document.querySelectorAll('.sub-nav-btn').forEach(b => b.classList.toggle('active', b.onclick.toString().includes(tab)));
    document.querySelectorAll('.rank-tab-content').forEach(c => c.classList.toggle('hidden', !c.id.includes(tab)));
    if(!allActivitiesCache) allActivitiesCache = await window.supabaseAuth.listActivities();
    if(tab === 'segments') loadRankings(document.getElementById('segmentSelector').value);
    else if(tab === 'distance') renderTrendGraph(allActivitiesCache, 'distanceKm', 'distance-table-body', 'distanceTrendChart', 'distanceTopFilter', 'Afstand (km)');
    else if(tab === 'elevation') renderTrendGraph(allActivitiesCache, 'elevationGain', 'elevation-table-body', 'elevationTrendChart', 'elevationTopFilter', 'Hoogte (m)');
};

function renderTrendGraph(activities, key, tableId, chartId, filterId, label) {
    const fv = document.getElementById(filterId)?.value || 'all';
    let r = [...activities.filter(a => a.summary.type !== 'route')].sort((a, b) => (parseFloat(b.summary[key])||0) - (parseFloat(a.summary[key])||0));
    if(fv !== 'all') r = r.slice(0, parseInt(fv));
    const ch = [...r].sort((a,b) => new Date(a.summary.rideDate) - new Date(b.summary.rideDate));
    const v = ch.map(a => parseFloat(a.summary[key]) || 0);
    const tr = calculateTrendLine(v);
    const ctx = document.getElementById(chartId).getContext('2d');
    if(activeCharts[chartId]) activeCharts[chartId].destroy();
    activeCharts[chartId] = new Chart(ctx, {
        type: 'line',
        data: {
            labels: ch.map(a => new Date(a.summary.rideDate).toLocaleDateString()),
            datasets: [{ label: label, data: v, borderColor: '#fc4c02', fill: true, tension: 0.2 }, { label: 'Trend', data: tr, borderColor: '#333', borderDash: [5,5], fill: false }]
        },
        options: { responsive: true, maintainAspectRatio: false }
    });
    const tb = document.getElementById(tableId);
    if(tb) tb.innerHTML = `<div class="table-container"><table class="data-table"><thead><tr><th>#</th><th>Naam</th><th>Datum</th><th>${label}</th></tr></thead><tbody>${r.map((act, i) => `<tr onclick="switchTab('analysis'); window.openRide(${JSON.stringify(act).replace(/"/g, '&quot;')})"><td>#${i+1}</td><td>${act.fileName}</td><td>${new Date(act.summary.rideDate).toLocaleDateString()}</td><td><strong>${parseFloat(act.summary[key]).toFixed(1)}</strong></td></tr>`).join('')}</tbody></table></div>`;
}

window.loadRankings = async function(dist) {
    const me = parseFloat(document.getElementById('segmentMaxElev').value) || 99999;
    const d = allActivitiesCache.filter(a => a.summary.type !== 'route').map(act => {
        const s = (act.summary.segments || []).find(s => s.distance === parseInt(dist));
        return s ? { ...s, activity: act, elev: act.summary.elevationGain } : null;
    }).filter(i => i && i.elev <= me).sort((a,b) => b.speed - a.speed);
    
    if(d.length > 0) {
        document.getElementById('segment-progression-container').style.display = 'block';
        const speeds = [...d].sort((a,b) => new Date(a.activity.summary.rideDate) - new Date(b.activity.summary.rideDate)).map(i => i.speed);
        const tr = calculateTrendLine(speeds);
        const ctx = document.getElementById('segmentProgressionChart').getContext('2d');
        if(activeCharts['segChart']) activeCharts['segChart'].destroy();
        activeCharts['segChart'] = new Chart(ctx, {
            type: 'line',
            data: {
                labels: d.map(i => new Date(i.activity.summary.rideDate).toLocaleDateString()),
                datasets: [{label: 'Snelheid (km/u)', data: speeds, borderColor: '#28a745', fill: true}, {label: 'Trend', data: tr, borderColor: '#fc4c02', borderDash:[5,5]}]
            },
            options: { responsive: true, maintainAspectRatio: false }
        });
    }
    document.getElementById('ranking-list').innerHTML = d.map((item, i) => `<div class="rank-card" onclick="switchTab('analysis'); window.openRide(${JSON.stringify(item.activity).replace(/"/g, '&quot;')})"><div><strong>#${i+1} ${item.activity.fileName}</strong><br><small>⛰️ ${item.elev}m</small></div><div style="text-align:right"><strong>${item.speed.toFixed(1)} km/u</strong></div></div>`).join('');
};

function renderActivityList(acts) {
    const list = document.getElementById('dashboard-list');
    if(!list) return;
    list.innerHTML = acts.map(act => `<div class="dash-list-item"><input type="checkbox" onchange="toggleSelection('${act.id}')" ${selectedRides.has(act.id)?'checked':''}><div style="flex:1; display:flex; justify-content:space-between; margin-left:10px;" onclick="switchTab('analysis'); window.openRide(${JSON.stringify(act).replace(/"/g, '&quot;')})"><strong>${act.fileName}</strong><span>${act.summary.distanceKm} km</span></div></div>`).join('');
}

window.toggleSelection = (id) => { if(selectedRides.has(id)) selectedRides.delete(id); else selectedRides.add(id); document.getElementById('delete-btn').classList.toggle('hidden', selectedRides.size === 0); };
window.deleteSelectedRides = async function() { if(confirm("Verwijderen?")) { await window.supabaseAuth.deleteActivities(Array.from(selectedRides)); selectedRides.clear(); updateDashboard(); } };
window.triggerUpload = () => document.getElementById('gpxInput').click();
window.toggleTheme = () => { document.body.classList.toggle('dark-mode'); localStorage.setItem('theme', document.body.classList.contains('dark-mode') ? 'dark' : 'light'); };