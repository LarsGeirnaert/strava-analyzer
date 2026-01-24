// ui.js - Dashboard, Rankings, Trends, Heatmap (Interactive) & Wereld Jager

let allActivitiesCache = null; 
let muniMap = null; 
let heatmapMap = null; 
let geoJsonLayer = null; 
let conqueredMunis = new Set(); 
let selectedRides = new Set(); 
let compareSelection = new Set(); 
let activeCharts = {}; 

const REGIONS = [
    { code: 'be', url: 'communes.json', type: 'topojson', nameFields: ['Gemeente', 'name', 'NAME_4', 'Name'] },
    { code: 'nl', url: 'https://cartomap.github.io/nl/wgs84/gemeente_2023.geojson', type: 'geojson', nameFields: ['statnaam'] },
    { code: 'fr', url: 'https://raw.githubusercontent.com/gregoiredavid/france-geojson/master/departements.geojson', type: 'geojson', nameFields: ['nom'] }
];

document.addEventListener('DOMContentLoaded', () => {
    setupNavigation();
    setupSegmentSelector();
    setupFilterListeners();
});

function setupNavigation() {
    document.querySelectorAll('.nav-btn[data-target]').forEach(btn => 
        btn.addEventListener('click', () => switchTab(btn.dataset.target))
    );
}

function setupFilterListeners() {
    document.getElementById('filter-text')?.addEventListener('input', () => {
        if(allActivitiesCache) renderCompareSelectionList(allActivitiesCache);
    });
}

function setupSegmentSelector() {
    const select = document.getElementById('segmentSelector');
    if (select) {
        select.innerHTML = ''; 
        for (let k = 5; k <= 100; k += 5) {
            const opt = document.createElement('option');
            opt.value = k; opt.text = `${k} km Segment`; select.appendChild(opt);
        }
        select.value = "5";
    }
}

function calculateTrendLine(data) {
    const n = data.length;
    if (n < 2) return data;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (let i = 0; i < n; i++) {
        sumX += i; sumY += data[i]; sumXY += i * data[i]; sumX2 += i * i;
    }
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    return data.map((_, i) => slope * i + intercept);
}

function switchTab(tabName) {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    const activeBtn = document.querySelector(`.nav-btn[data-target="${tabName}"]`);
    if(activeBtn) activeBtn.classList.add('active');

    document.querySelectorAll('.view-section').forEach(v => v.classList.add('hidden'));
    document.getElementById(`view-${tabName}`).classList.remove('hidden');

    setTimeout(() => {
        if(tabName === 'analysis' && typeof map !== 'undefined' && map && typeof map.invalidateSize === 'function') map.invalidateSize();
        if(tabName === 'municipalities' && muniMap) muniMap.invalidateSize();
        if(tabName === 'heatmap' && heatmapMap) heatmapMap.invalidateSize();
    }, 150);

    if(tabName === 'dashboard') updateDashboard();
    if(tabName === 'municipalities') initMuniMap();
    if(tabName === 'heatmap') initHeatmapMap();
    if(tabName === 'rankings') switchRankingTab('segments');
}

// --- RANGLIJSTEN & RECORDS ---
window.switchRankingTab = async function(subTab) {
    document.querySelectorAll('.sub-nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll(`.sub-nav-btn[onclick*="${subTab}"]`).forEach(b => b.classList.add('active'));
    document.querySelectorAll('.rank-tab-content').forEach(d => d.classList.add('hidden'));
    document.getElementById(`rank-tab-${subTab}`).classList.remove('hidden');

    let activities = allActivitiesCache || await window.supabaseAuth.listActivities();
    allActivitiesCache = activities;

    if(subTab === 'segments') loadRankings(document.getElementById('segmentSelector').value);
    else if(subTab === 'distance') renderTrendGraph(activities, 'distanceKm', 'distance-table-body', 'distanceTrendChart', 'distanceTopFilter', 'Afstand (km)');
    else if(subTab === 'elevation') renderTrendGraph(activities, 'elevationGain', 'elevation-table-body', 'elevationTrendChart', 'elevationTopFilter', 'Hoogte (m)');
    else if(subTab === 'compare') renderCompareSelectionList(activities);
};

function renderTrendGraph(activities, key, tableId, chartId, filterId, label) {
    const topX = document.getElementById(filterId).value;
    let ranked = [...activities].sort((a, b) => (parseFloat(b.summary[key])||0) - (parseFloat(a.summary[key])||0));
    if(topX !== 'all') ranked = ranked.slice(0, parseInt(topX));
    const chrono = [...ranked].sort((a,b) => new Date(a.summary.rideDate) - new Date(b.summary.rideDate));
    const values = chrono.map(a => parseFloat(a.summary[key]));
    const trend = calculateTrendLine(values);
    const ctx = document.getElementById(chartId).getContext('2d');
    if(activeCharts[chartId]) activeCharts[chartId].destroy();
    activeCharts[chartId] = new Chart(ctx, {
        type: 'line',
        data: {
            labels: chrono.map(a => new Date(a.summary.rideDate).toLocaleDateString()),
            datasets: [
                { label: label, data: values, borderColor: '#fc4c02', backgroundColor: 'rgba(252, 76, 2, 0.1)', fill: true, tension: 0.2, pointRadius: 4 },
                { label: 'Trend', data: trend, borderColor: '#333', borderDash: [5,5], pointRadius: 0, fill: false }
            ]
        },
        options: { responsive: true, maintainAspectRatio: false }
    });
    document.getElementById(tableId).innerHTML = ranked.map((act, i) => `<tr onclick='window.openRide(${JSON.stringify(act).replace(/"/g, "&quot;")})'><td>#${i+1}</td><td>${act.fileName}</td><td>${new Date(act.summary.rideDate).toLocaleDateString()}</td><td><strong>${parseFloat(act.summary[key]).toFixed(1)}</strong></td></tr>`).join('');
}

window.loadRankings = async function(distanceKm) {
    distanceKm = parseInt(distanceKm);
    const maxElev = parseFloat(document.getElementById('segmentMaxElev').value) || 99999;
    const topX = document.getElementById('segmentTopFilter').value;
    let activities = allActivitiesCache || await window.supabaseAuth.listActivities();
    let data = activities.map(act => {
        const seg = (act.summary.segments || []).find(s => s.distance === distanceKm);
        if(seg) return { ...seg, fileName: act.fileName, date: act.summary.rideDate, activity: act, elev: act.summary.elevationGain };
        return null;
    }).filter(i => i && i.elev <= maxElev);
    data.sort((a, b) => b.speed - a.speed);
    if(topX !== 'all') data = data.slice(0, parseInt(topX));
    const list = document.getElementById('ranking-list');
    if(data.length === 0) { list.innerHTML = '<p>Geen data.</p>'; document.getElementById('segment-progression-container').style.display = 'none'; return; }
    const progression = [...data].sort((a, b) => new Date(a.date) - new Date(b.date));
    const speeds = progression.map(d => parseFloat(d.speed.toFixed(2)));
    const trend = calculateTrendLine(speeds);
    document.getElementById('segment-progression-container').style.display = 'block';
    const ctx = document.getElementById('segmentProgressionChart').getContext('2d');
    if(activeCharts['segChart']) activeCharts['segChart'].destroy();
    activeCharts['segChart'] = new Chart(ctx, {
        type: 'line',
        data: {
            labels: progression.map(d => new Date(d.date).toLocaleDateString()),
            datasets: [
                { label: 'Snelheid', data: speeds, borderColor: '#28a745', fill: true, tension: 0.1, pointRadius: 5 },
                { label: 'Trendlijn', data: trend, borderColor: '#fc4c02', borderDash: [10,5], pointRadius: 0, fill: false, borderWidth: 3 }
            ]
        },
        options: { responsive: true, maintainAspectRatio: false }
    });
    list.innerHTML = data.map((item, index) => `<div class="rank-card" onclick='window.openRide(${JSON.stringify(item.activity).replace(/"/g, "&quot;")})'><div><strong>#${index+1} ${item.fileName}</strong><br><small>${new Date(item.date).toLocaleDateString()} (⛰️ ${item.elev}m)</small></div><div style="text-align:right"><div class="rank-speed">${item.speed.toFixed(1)} km/u</div></div></div>`).join('');
};

// --- HEATMAP (INTERACTIEF) ---
async function initHeatmapMap() {
    if (heatmapMap) { heatmapMap.invalidateSize(); return; }
    heatmapMap = L.map('map-heatmap', { zoomControl: true, attributionControl: false }).setView([50.85, 4.35], 7);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', { subdomains: 'abcd', maxZoom: 20 }).addTo(heatmapMap);

    // Koppel klik-event voor rit-detectie
    heatmapMap.on('click', async (e) => {
        const user = window.supabaseAuth.getCurrentUser();
        const cacheKey = `heatmap_coords_${user.id}`;
        const cachedData = JSON.parse(localStorage.getItem(cacheKey) || "{}");
        
        const clickedLatLng = e.latlng;
        const matches = [];

        // Zoek ritten die in de buurt van de klik liggen
        for (const actId in cachedData) {
            const coords = cachedData[actId];
            const isNear = coords.some(c => {
                const dist = clickedLatLng.distanceTo(L.latLng(c[0], c[1]));
                return dist < 35; // 35 meter straal
            });

            if (isNear) {
                const act = allActivitiesCache.find(a => a.id === actId);
                if (act) matches.push(act);
            }
        }

        if (matches.length > 0) {
            const html = `
                <div style="min-width:150px;">
                    <strong>🔥 ${matches.length} ritten hier:</strong><br>
                    <ul style="padding-left:15px; margin-top:5px; max-height:100px; overflow-y:auto;">
                        ${matches.map(m => `<li>${m.fileName}<br><small>${new Date(m.summary.rideDate).toLocaleDateString()}</small></li>`).join('')}
                    </ul>
                </div>
            `;
            L.popup().setLatLng(clickedLatLng).setContent(html).openOn(heatmapMap);
        }
    });
}

window.generateHeatmap = async function() {
    const bar = document.getElementById('heatmap-bar');
    const btn = document.getElementById('load-heatmap-btn');
    document.getElementById('heatmap-progress').style.display = "block";
    btn.disabled = true;

    let acts = allActivitiesCache || await window.supabaseAuth.listActivities();
    heatmapMap.eachLayer(l => { if (l instanceof L.Polyline) heatmapMap.removeLayer(l); });

    const user = window.supabaseAuth.getCurrentUser();
    const cacheKey = `heatmap_coords_${user.id}`;
    let cachedData = JSON.parse(localStorage.getItem(cacheKey) || "{}");

    for (let i = 0; i < acts.length; i++) {
        const act = acts[i];
        bar.style.width = Math.round(((i + 1) / acts.length) * 100) + "%";

        let latlngs = cachedData[act.id];
        if (!latlngs) {
            try {
                const blob = await window.supabaseAuth.getActivityFile(act.id);
                const text = await blob.text();
                const fullCoords = [];
                const regex = /lat="([\d\.-]+)"\s+lon="([\d\.-]+)"/g;
                let m;
                while ((m = regex.exec(text)) !== null) fullCoords.push([parseFloat(m[1]), parseFloat(m[2])]);
                
                latlngs = fullCoords.filter((_, idx) => idx % 10 === 0);
                cachedData[act.id] = latlngs;
            } catch (e) {}
        }

        if (latlngs && latlngs.length > 0) {
            L.polyline(latlngs, { color: '#fc4c02', opacity: 0.35, weight: 2.5, interactive: false }).addTo(heatmapMap);
        }
        
        if (i % 20 === 0) { try { localStorage.setItem(cacheKey, JSON.stringify(cachedData)); } catch (e) {} }
        if (i % 5 === 0) await new Promise(r => setTimeout(r, 1));
    }
    
    try { localStorage.setItem(cacheKey, JSON.stringify(cachedData)); } catch (e) {}
    btn.disabled = false; btn.innerText = "🚀 Vernieuwen";
    setTimeout(() => document.getElementById('heatmap-progress').style.display = "none", 1000);
};

window.clearHeatmapCache = function() {
    const user = window.supabaseAuth.getCurrentUser();
    localStorage.removeItem(`heatmap_coords_${user.id}`);
    location.reload();
};

// --- WERELD JAGER ---
async function initMuniMap() {
    if (muniMap) { muniMap.invalidateSize(); return; }
    muniMap = L.map('map-municipalities').setView([50.0, 4.5], 6);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png').addTo(muniMap);
    loadFeatures();
}

async function loadFeatures() {
    let allFeatures = [];
    for(const region of REGIONS) {
        try {
            const res = await fetch(region.url);
            let data = await res.json();
            if (region.type === 'topojson' && typeof topojson !== 'undefined') data = topojson.feature(data, data.objects[Object.keys(data.objects)[0]]);
            data.features.forEach(f => {
                let name = "Onbekend";
                for(const field of region.nameFields) { if(f.properties[field]) { name = f.properties[field]; break; } }
                f.properties.muniName = `${name} (${region.code.toUpperCase()})`; 
            });
            allFeatures.push(...data.features);
        } catch (err) {}
    }
    if(geoJsonLayer) muniMap.removeLayer(geoJsonLayer);
    geoJsonLayer = L.geoJSON({ type: "FeatureCollection", features: allFeatures }, {
        onEachFeature: (feature, layer) => { layer.muniName = feature.properties.muniName; layer.bindTooltip(layer.muniName, { sticky: true }); }
    }).addTo(muniMap);
    const names = await window.supabaseAuth.getConqueredMunicipalities();
    conqueredMunis = new Set(names);
    updateMuniUI();
}

function updateMuniUI() {
    if(!geoJsonLayer) return;
    document.getElementById('muni-count').innerText = conqueredMunis.size;
    const t = geoJsonLayer.getLayers().length || 1;
    document.getElementById('muni-total').innerText = t;
    document.getElementById('muni-percent').innerText = ((conqueredMunis.size/t)*100).toFixed(1) + '%';
    document.getElementById('muni-progress-fill').style.width = (conqueredMunis.size/t)*100 + '%';
    geoJsonLayer.eachLayer(l => {
        if (conqueredMunis.has(l.muniName)) l.setStyle({ fillColor: '#fc4c02', fillOpacity: 0.7, color: '#d94002', weight: 2 });
        else l.setStyle({ fillColor: 'transparent', color: 'transparent', weight: 0 });
    });
}

// --- DASHBOARD & UTILS ---
async function updateDashboard() {
    if(!window.supabaseAuth.getCurrentUser()) return;
    allActivitiesCache = await window.supabaseAuth.listActivities();
    let d=0, e=0; allActivitiesCache.forEach(a=>{ d+=parseFloat(a.summary.distanceKm||0); e+=parseFloat(a.summary.elevationGain||0); });
    document.getElementById('total-dist').innerText = d.toFixed(0) + ' km';
    document.getElementById('total-elev').innerText = e.toFixed(0) + ' m';
    document.getElementById('total-rides').innerText = allActivitiesCache.length;
    renderActivityList(allActivitiesCache.slice(0, 8));
}

function renderActivityList(acts) {
    document.getElementById('dashboard-list').innerHTML = acts.map(act => `
        <div class="dash-list-item">
            <div class="checkbox-zone" onclick="toggleSelection('${act.id}')"><input type="checkbox" class="list-checkbox" ${selectedRides.has(act.id)?'checked':''}></div>
            <div style="flex:1; display:flex; justify-content:space-between; align-items:center;" onclick='window.openRide(${JSON.stringify(act).replace(/"/g, "&quot;")})'>
                <div><strong>${act.fileName}</strong><br><small>${new Date(act.summary.rideDate).toLocaleDateString()}</small></div>
                <div style="text-align:right"><strong>${act.summary.distanceKm} km</strong></div>
            </div>
        </div>`).join('');
}

window.toggleSelection = (id) => { 
    if(selectedRides.has(id)) selectedRides.delete(id); else selectedRides.add(id);
    document.getElementById('delete-btn').classList.toggle('hidden', selectedRides.size === 0);
};

window.deleteSelectedRides = async function() {
    if(confirm("Verwijderen?")) { await window.supabaseAuth.deleteActivities(Array.from(selectedRides)); selectedRides.clear(); updateDashboard(); }
};

window.triggerUpload = () => document.getElementById('gpxInput').click();
window.toggleTheme = () => {
    document.body.classList.toggle('dark-mode');
    localStorage.setItem('theme', document.body.classList.contains('dark-mode') ? 'dark' : 'light');
};
if(localStorage.getItem('theme')==='dark') document.body.classList.add('dark-mode');