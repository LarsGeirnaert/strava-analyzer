// ui.js - Dashboard, Rankings, Trends (Linear Regression), Heatmap & Wereld Jager

let allActivitiesCache = null; 
let muniMap = null; 
let heatmapMap = null; 
let geoJsonLayer = null; 
let heatmapBordersLayer = null; 
let conqueredMunis = new Set(); 
let selectedRides = new Set(); 
let compareSelection = new Set(); 
let cmpCharts = {};
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

// --- TRENDLIJN WISKUNDE ---
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

    // FIX KAART GLITCH
    setTimeout(() => {
        if(tabName === 'analysis' && window.map) window.map.invalidateSize();
        if(tabName === 'municipalities' && muniMap) muniMap.invalidateSize();
        if(tabName === 'heatmap' && heatmapMap) heatmapMap.invalidateSize();
    }, 150);

    if(tabName === 'dashboard') updateDashboard();
    if(tabName === 'municipalities') initMuniMap();
    if(tabName === 'heatmap') initHeatmapMap();
    if(tabName === 'rankings') {
        const sub = document.querySelector('.sub-nav-btn.active')?.getAttribute('onclick').match(/'([^']+)'/)[1] || 'segments';
        switchRankingTab(sub);
    }
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
    if(data.length === 0) { list.innerHTML = '<p>Geen data gevonden met deze filters.</p>'; document.getElementById('segment-progression-container').style.display = 'none'; return; }
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

// --- HEATMAP ---
async function initHeatmapMap() {
    if (heatmapMap) { heatmapMap.invalidateSize(); return; }
    
    // Initialiseer de kaart
    heatmapMap = L.map('map-heatmap', { 
        zoomControl: true, 
        attributionControl: false 
    }).setView([50.85, 4.35], 7);
    
    // Voeg de lichte 'Positron' tilelayer toe die exact lijkt op je voorbeeld (geen wegen)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
        attribution: '©OpenStreetMap, ©CartoDB',
        subdomains: 'abcd',
        maxZoom: 20
    }).addTo(heatmapMap);

    // Voeg de landsgrenzen toe via GeoJSON (zodat het overzicht behouden blijft)
    fetch('https://raw.githubusercontent.com/datasets/geo-boundaries-world-110m/master/countries.geojson')
        .then(res => res.json()).then(data => {
            heatmapBordersLayer = L.geoJson(data, { 
                style: { 
                    color: "#d1d1d1", // Lichtgrijze grenzen
                    weight: 1.5, 
                    fillOpacity: 0, 
                    interactive: false 
                } 
            }).addTo(heatmapMap);
        });
}

window.generateHeatmap = async function() {
    const bar = document.getElementById('heatmap-bar');
    document.getElementById('heatmap-progress').style.display = "block";
    let acts = allActivitiesCache || await window.supabaseAuth.listActivities();
    heatmapMap.eachLayer(l => { if (l instanceof L.Polyline) heatmapMap.removeLayer(l); });
    for (let i=0; i<acts.length; i++) {
        bar.style.width = Math.round(((i+1)/acts.length)*100) + "%";
        try {
            const blob = await window.supabaseAuth.getActivityFile(acts[i].id);
            const text = await blob.text();
            const latlngs = [];
            const regex = /lat="([\d\.-]+)"\s+lon="([\d\.-]+)"/g;
            let m; while ((m = regex.exec(text)) !== null) latlngs.push([parseFloat(m[1]), parseFloat(m[2])]);
            if (latlngs.length > 0) L.polyline(latlngs, { color: '#fc4c02', opacity: 0.15, weight: 1.5, interactive: false }).addTo(heatmapMap);
        } catch (e) {}
        if(i % 5 === 0) await new Promise(r => setTimeout(r, 5));
    }
    setTimeout(() => document.getElementById('heatmap-progress').style.display = "none", 1000);
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
    document.getElementById('muni-loading').style.display = 'block';
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
    document.getElementById('muni-total').innerText = allFeatures.length;
    document.getElementById('scan-btn').style.display = 'inline-block';
    const names = await window.supabaseAuth.getConqueredMunicipalities();
    conqueredMunis = new Set(names);
    updateMuniUI();
    document.getElementById('muni-loading').style.display = 'none';
}

function updateMuniUI() {
    if(!geoJsonLayer) return;
    const t = parseInt(document.getElementById('muni-total').innerText) || 1;
    document.getElementById('muni-count').innerText = conqueredMunis.size;
    document.getElementById('muni-percent').innerText = ((conqueredMunis.size/t)*100).toFixed(1) + '%';
    document.getElementById('muni-progress-fill').style.width = (conqueredMunis.size/t)*100 + '%';
    geoJsonLayer.eachLayer(l => {
        if (conqueredMunis.has(l.muniName)) l.setStyle({ fillColor: '#fc4c02', fillOpacity: 0.7, color: '#d94002', weight: 2 });
        else l.setStyle({ fillColor: 'transparent', color: 'transparent', weight: 0 });
    });
}

async function scanOldRides() {
    if(!confirm("Start scan van alle ritten?")) return;
    const activities = allActivitiesCache || await window.supabaseAuth.listActivities();
    const muniLayers = geoJsonLayer.getLayers();
    for (const act of activities) {
        const blob = await window.supabaseAuth.getActivityFile(act.id);
        const text = await blob.text();
        const found = [];
        const regex = /lat="([\d\.-]+)"\s+lon="([\d\.-]+)"/g;
        let m; while ((m = regex.exec(text)) !== null) {
            const pt = turf.point([parseFloat(m[2]), parseFloat(m[1])]);
            for (const layer of muniLayers) {
                if (conqueredMunis.has(layer.muniName)) continue;
                if (turf.booleanPointInPolygon(pt, layer.feature)) { found.push(layer.muniName); conqueredMunis.add(layer.muniName); }
            }
        }
        if(found.length > 0) await window.supabaseAuth.saveConqueredMunicipalities(found);
    }
    updateMuniUI();
}

// --- COMPARE LOGICA ---
function renderCompareSelectionList(activities) {
    const list = document.getElementById('compare-selection-list');
    const fText = document.getElementById('filter-text').value.toLowerCase();
    const filtered = activities.filter(act => act.fileName.toLowerCase().includes(fText))
        .sort((a, b) => new Date(b.summary.rideDate) - new Date(a.summary.rideDate));

    list.innerHTML = filtered.map(act => `
        <div class="compare-item">
            <input type="checkbox" id="cmp-${act.id}" ${compareSelection.has(act.id)?'checked':''} onchange="toggleCompare('${act.id}')">
            <label for="cmp-${act.id}" style="flex:1; cursor:pointer;">
                <strong>${act.fileName}</strong><br><small>${new Date(act.summary.rideDate).toLocaleDateString()} - ${act.summary.distanceKm}km</small>
            </label>
        </div>
    `).join('');
}

window.toggleCompare = (id) => { 
    if(compareSelection.has(id)) compareSelection.delete(id); else compareSelection.add(id);
    updateCompareTable(); 
};

async function updateCompareTable() {
    const table = document.getElementById('comparison-table');
    const container = document.getElementById('compare-charts-container');
    const loader = document.getElementById('compare-loading');
    if(compareSelection.size < 2) { 
        table.innerHTML = '<tbody><tr><td style="padding:20px; color:var(--text-muted);">Vink minimaal 2 ritten aan.</td></tr></tbody>'; 
        container.classList.add('hidden'); return; 
    }
    container.classList.remove('hidden'); loader.style.display = 'block';

    const acts = allActivitiesCache.filter(a => compareSelection.has(a.id)).sort((a,b) => new Date(a.summary.rideDate) - new Date(b.summary.rideDate));
    table.innerHTML = '<thead><tr><th>Statistiek</th>' + acts.map(a => `<th>${a.fileName}</th>`).join('') + '</tr></thead>' +
        '<tbody><tr><td>Afstand</td>' + acts.map(a => `<td>${parseFloat(a.summary.distanceKm).toFixed(1)} km</td>`).join('') + '</tr>' +
        '<tr><td>Hoogte</td>' + acts.map(a => `<td>${a.summary.elevationGain} m</td>`).join('') + '</tr>' +
        '<tr><td>Snelheid</td>' + acts.map(a => `<td>${a.summary.avgSpeed} km/u</td>`).join('') + '</tr></tbody>';

    const profiles = [];
    const colors = ['#fc4c02', '#28a745', '#007bff', '#ffc107', '#6610f2'];
    for(let i=0; i<acts.length; i++) {
        const b = await window.supabaseAuth.getActivityFile(acts[i].id);
        const t = await b.text();
        const d = window.parseGPXData(t, acts[i].fileName);
        profiles.push({ label: acts[i].fileName, data: d, color: colors[i % colors.length] });
    }
    updateCompareCharts(profiles); loader.style.display = 'none';
}

function updateCompareCharts(profiles) {
    const startIdx = 2; const endIdx = 99;
    const labels = Array.from({length: 101}, (_, i) => `${i}%`).slice(startIdx, endIdx);
    
    const render = (id, metricKey, yLabel) => {
        const ctx = document.getElementById(id).getContext('2d');
        if (cmpCharts[id]) cmpCharts[id].destroy();
        
        const datasets = profiles.map(p => {
            const normalized = normalizeRideData(p.data, 100);
            return {
                label: p.label,
                data: normalized[metricKey].slice(startIdx, endIdx),
                borderColor: p.color,
                backgroundColor: 'transparent',
                borderWidth: 2,
                pointRadius: 0,
                tension: 0.4
            };
        });

        cmpCharts[id] = new Chart(ctx, {
            type: 'line',
            data: { labels: labels, datasets: datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                onHover: (event, chartElements) => {
                    if (chartElements.length > 0) {
                        const pointIndex = chartElements[0].index + startIdx;
                        // Toon punt op kaart voor de eerste geselecteerde rit als voorbeeld
                        const firstRideLatLngs = profiles[0].data.uiData.latlngs;
                        const realIndex = Math.floor((pointIndex / 100) * (firstRideLatLngs.length - 1));
                        if (window.showPointOnMap) window.showPointOnMap(realIndex);
                    } else {
                        if (window.hidePointOnMap) window.hidePointOnMap();
                    }
                },
                interaction: { mode: 'index', intersect: false },
                scales: { y: { title: { display: true, text: yLabel } } }
            }
        });
    };
    render('cmpChartElev', 'elev', 'meters');
    render('cmpChartSpeed', 'speed', 'km/u');
}

function normalizeRideData(rideData, steps) {
    const rawDist = rideData.uiData.distances; 
    const rawElev = rideData.uiData.elevations; 
    const rawSpeeds = rideData.uiData.speeds; 
    const elevProfile = []; const speedProfile = [];
    const totalDist = parseFloat(rideData.summary.distanceKm);
    for(let i=0; i<=steps; i++) {
        const targetDist = (i / steps) * totalDist;
        let idx = rawDist.findIndex(d => d >= targetDist);
        if(idx === -1) idx = rawDist.length - 1;
        elevProfile.push(rawElev[idx]);
        let s = rawSpeeds[idx] || 0;
        if(i > 0) s = (s + speedProfile[i-1]) / 2;
        speedProfile.push(s);
    }
    return { elev: elevProfile, speed: speedProfile };
}

// --- DASHBOARD LOGICA ---
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

window.showAllActivities = () => {
    if (allActivitiesCache) renderActivityList(allActivitiesCache);
};

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