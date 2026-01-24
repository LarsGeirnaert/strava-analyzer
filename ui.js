// ui.js - Dashboard, Rankings, Wereld Jager, Heatmap, Trends & Compare

let allActivitiesCache = null; 
let muniMap = null; 
let heatmapMap = null; 
let geoJsonLayer = null; 
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
    const inputs = document.querySelectorAll('#filter-text, #filter-year');
    inputs.forEach(input => input.addEventListener('input', () => {
        if(allActivitiesCache) renderCompareSelectionList(allActivitiesCache);
    }));
}

window.resetFilters = function() {
    document.getElementById('filter-text').value = '';
    document.getElementById('filter-year').value = '';
    if(allActivitiesCache) renderCompareSelectionList(allActivitiesCache);
};

function setupSegmentSelector() {
    const select = document.getElementById('segmentSelector');
    if (select) {
        select.innerHTML = ''; 
        for (let k = 5; k <= 100; k += 5) {
            const opt = document.createElement('option');
            opt.value = k; opt.text = `${k} km Records`; select.appendChild(opt);
        }
        select.value = "5";
    }
}

function switchTab(tabName) {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    const activeBtn = document.querySelector(`.nav-btn[data-target="${tabName}"]`);
    if(activeBtn && !activeBtn.id) activeBtn.classList.add('active');

    document.querySelectorAll('.view-section').forEach(v => v.classList.add('hidden'));
    document.getElementById(`view-${tabName}`).classList.remove('hidden');

    if(tabName === 'analysis') setTimeout(() => { if(typeof map !== 'undefined') map.invalidateSize(); }, 100);
    if(tabName === 'dashboard') { selectedRides.clear(); updateDeleteButton(); updateDashboard(); }
    if(tabName === 'municipalities') setTimeout(() => initMuniMap(), 200);
    if(tabName === 'heatmap') setTimeout(() => initHeatmapMap(), 200);

    if(tabName === 'rankings') {
        const activeSubBtn = document.querySelector('.sub-nav-btn.active');
        const sub = activeSubBtn ? activeSubBtn.getAttribute('onclick').match(/'([^']+)'/)[1] : 'segments';
        switchRankingTab(sub);
    }
}

// --- RANGLIJSTEN & TRENDS ---
window.switchRankingTab = async function(subTab) {
    document.querySelectorAll('.sub-nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll(`.sub-nav-btn[onclick*="${subTab}"]`).forEach(b => b.classList.add('active'));
    document.querySelectorAll('.rank-tab-content').forEach(d => d.classList.add('hidden'));
    document.getElementById(`rank-tab-${subTab}`).classList.remove('hidden');

    let activities = allActivitiesCache || await window.supabaseAuth.listActivities();
    allActivitiesCache = activities;

    if(subTab === 'segments') {
        loadRankings(document.getElementById('segmentSelector')?.value || 5);
    } else if(subTab === 'distance') {
        renderGeneralTrend(activities, 'distanceKm', 'distance-table-body', 'distanceTrendChart', 'Afstand (km)');
    } else if(subTab === 'elevation') {
        renderGeneralTrend(activities, 'elevationGain', 'elevation-table-body', 'elevationTrendChart', 'Hoogtemeters (m)');
    } else if(subTab === 'compare') {
        renderCompareSelectionList(activities);
    }
};

function renderGeneralTrend(activities, key, tableId, chartId, label) {
    const tbody = document.getElementById(tableId);
    const chronological = [...activities].sort((a, b) => new Date(a.summary.rideDate) - new Date(b.summary.rideDate));
    const ranked = [...activities].sort((a, b) => (parseFloat(b.summary[key]) || 0) - (parseFloat(a.summary[key]) || 0));

    const ctx = document.getElementById(chartId).getContext('2d');
    if(activeCharts[chartId]) activeCharts[chartId].destroy();
    
    activeCharts[chartId] = new Chart(ctx, {
        type: 'line',
        data: {
            labels: chronological.map(a => new Date(a.summary.rideDate).toLocaleDateString()),
            datasets: [{
                label: label,
                data: chronological.map(a => parseFloat(a.summary[key])),
                borderColor: '#fc4c02',
                backgroundColor: 'rgba(252, 76, 2, 0.1)',
                fill: true, tension: 0.3, pointRadius: 4
            }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
    });

    tbody.innerHTML = ranked.map((act, i) => `
        <tr onclick="switchTab('analysis'); window.openRide(${JSON.stringify(act).replace(/"/g, '&quot;')})">
            <td><strong>${i+1}</strong></td>
            <td>${act.fileName}</td>
            <td>${new Date(act.summary.rideDate).toLocaleDateString()}</td>
            <td style="color:var(--primary); font-weight:bold;">${parseFloat(act.summary[key]).toFixed(1)}${key==='distanceKm'?' km':' m'}</td>
        </tr>
    `).join('');
}

window.loadRankings = async function(distanceKm) {
    distanceKm = parseInt(distanceKm);
    const list = document.getElementById('ranking-list');
    const chartContainer = document.getElementById('segment-progression-container');
    
    let activities = allActivitiesCache || await window.supabaseAuth.listActivities();
    const rankedData = activities.map(act => {
        const seg = (act.summary.segments || []).find(s => s.distance === distanceKm);
        if(seg) return { ...seg, fileName: act.fileName, date: act.summary.rideDate, activity: act };
        return null;
    }).filter(i => i);

    const progression = [...rankedData].sort((a, b) => new Date(a.date) - new Date(b.date));
    rankedData.sort((a, b) => b.speed - a.speed);
    
    if(rankedData.length === 0) { 
        list.innerHTML = '<p style="text-align:center; padding:20px;">Geen data voor deze afstand.</p>';
        chartContainer.style.display = 'none'; return; 
    }

    chartContainer.style.display = 'block';
    const ctx = document.getElementById('segmentProgressionChart').getContext('2d');
    if(activeCharts['segChart']) activeCharts['segChart'].destroy();
    activeCharts['segChart'] = new Chart(ctx, {
        type: 'line',
        data: {
            labels: progression.map(d => new Date(d.date).toLocaleDateString()),
            datasets: [{
                label: 'Snelheid (km/u)',
                data: progression.map(d => d.speed.toFixed(2)),
                borderColor: '#28a745',
                backgroundColor: 'rgba(40, 167, 69, 0.1)',
                fill: true, tension: 0.3, pointRadius: 5
            }]
        },
        options: { responsive: true, maintainAspectRatio: false }
    });

    list.innerHTML = rankedData.map((item, index) => `
        <div class="rank-card ${index===0?'gold':index===1?'silver':index===2?'bronze':''}" onclick="switchTab('analysis'); window.openRide(${JSON.stringify(item.activity).replace(/"/g, '&quot;')})">
            <div style="display:flex;gap:15px;align-items:center;"><div class="rank-pos">#${index+1}</div><div><strong>${item.fileName}</strong><br><small>${new Date(item.date).toLocaleDateString()}</small></div></div>
            <div style="text-align:right"><div class="rank-speed">${item.speed.toFixed(1)} km/u</div></div>
        </div>
    `).join('');
};

// --- COMPARE LOGICA ---
function renderCompareSelectionList(activities) {
    const list = document.getElementById('compare-selection-list');
    const fText = document.getElementById('filter-text').value.toLowerCase();
    const fYear = document.getElementById('filter-year').value;

    const filtered = activities.filter(act => {
        const year = new Date(act.summary.rideDate).getFullYear().toString();
        if (!act.fileName.toLowerCase().includes(fText)) return false;
        if (fYear !== "" && year !== fYear) return false;
        return true;
    }).sort((a, b) => new Date(b.summary.rideDate) - new Date(a.summary.rideDate));

    list.innerHTML = filtered.map(act => `
        <div class="compare-item">
            <input type="checkbox" id="cmp-${act.id}" ${compareSelection.has(act.id)?'checked':''} onchange="toggleCompare('${act.id}')">
            <label for="cmp-${act.id}" style="flex:1; cursor:pointer;">
                <strong>${act.fileName}</strong><br><small>${new Date(act.summary.rideDate).toLocaleDateString()} - ${act.summary.distanceKm}km</small>
            </label>
        </div>
    `).join('');
}

window.toggleCompare = function(id) {
    if(compareSelection.has(id)) compareSelection.delete(id);
    else compareSelection.add(id);
    updateCompareTable();
};

async function updateCompareTable() {
    const table = document.getElementById('comparison-table');
    const chartsContainer = document.getElementById('compare-charts-container');
    const loader = document.getElementById('compare-loading');

    if(compareSelection.size < 2) { 
        table.innerHTML = '<tbody><tr><td style="padding:20px; color:var(--text-muted);">Vink minimaal 2 ritten aan.</td></tr></tbody>'; 
        chartsContainer.classList.add('hidden'); return; 
    }

    chartsContainer.classList.remove('hidden');
    loader.style.display = 'block';

    const activities = allActivitiesCache.filter(a => compareSelection.has(a.id)).sort((a,b) => new Date(a.summary.rideDate) - new Date(b.summary.rideDate));

    let html = '<thead><tr><th>Statistiek</th>' + activities.map(a => `<th>${a.fileName}</th>`).join('') + '</tr></thead><tbody>';
    const rows = [{l:'Afstand', k:'distanceKm', u:' km'}, {l:'Hoogte', k:'elevationGain', u:' m'}, {l:'Snelheid', k:'avgSpeed', u:' km/u'}];
    
    rows.forEach(r => {
        html += `<tr><td>${r.l}</td>` + activities.map(a => `<td>${parseFloat(a.summary[r.k]).toFixed(1)}${r.u}</td>`).join('') + '</tr>';
    });
    table.innerHTML = html + '</tbody>';

    const profileData = [];
    const colors = ['#fc4c02', '#28a745', '#007bff', '#ffc107', '#6610f2'];

    for(let i=0; i<activities.length; i++) {
        const blob = await window.supabaseAuth.getActivityFile(activities[i].id);
        const text = await blob.text();
        const data = window.parseGPXData(text, activities[i].fileName);
        const normalized = normalizeRideData(data, 100);
        profileData.push({ label: activities[i].fileName, elev: normalized.elev, speed: normalized.speed, color: colors[i % colors.length] });
    }
    
    updateCompareCharts(profileData);
    loader.style.display = 'none';
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

function updateCompareCharts(datasets) {
    const startIdx = 2; const endIdx = 99; 
    const labels = Array.from({length: 101}, (_, i) => `${i}%`).slice(startIdx, endIdx); 
    const createChart = (id, metricKey, yLabel) => {
        const ctx = document.getElementById(id).getContext('2d');
        if (cmpCharts[id]) cmpCharts[id].destroy();
        cmpCharts[id] = new Chart(ctx, {
            type: 'line', 
            data: { labels: labels, datasets: datasets.map(d => ({ label: d.label, data: d[metricKey].slice(startIdx, endIdx), borderColor: d.color, backgroundColor: 'transparent', borderWidth: 2, pointRadius: 0, tension: 0.4 })) },
            options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, scales: { y: { title: { display: true, text: yLabel } } } }
        });
    };
    createChart('cmpChartElev', 'elev', 'meters');
    createChart('cmpChartSpeed', 'speed', 'km/u');
}

// --- HEATMAP (WIT + GRENZEN) ---
async function initHeatmapMap() {
    if (heatmapMap) { heatmapMap.invalidateSize(); return; }
    heatmapMap = L.map('map-heatmap', { zoomControl: true, attributionControl: false }).setView([50.85, 4.35], 7); 
    fetch('https://raw.githubusercontent.com/datasets/geo-boundaries-world-110m/master/countries.geojson')
        .then(res => res.json()).then(data => L.geoJson(data, { style: { color: "#bbbbbb", weight: 1.5, fillOpacity: 0, interactive: false } }).addTo(heatmapMap));
}

window.generateHeatmap = async function() {
    const btn = document.getElementById('load-heatmap-btn');
    const bar = document.getElementById('heatmap-bar');
    document.getElementById('heatmap-progress').style.display = "block";
    btn.disabled = true;

    let activities = allActivitiesCache || await window.supabaseAuth.listActivities();
    heatmapMap.eachLayer(layer => { if (layer instanceof L.Polyline) heatmapMap.removeLayer(layer); });

    for (let i=0; i<activities.length; i++) {
        const act = activities[i];
        bar.style.width = Math.round(((i+1) / activities.length) * 100) + "%";
        try {
            const blob = await window.supabaseAuth.getActivityFile(act.id);
            const text = await blob.text();
            const latlngs = [];
            const regex = /lat="([\d\.-]+)"\s+lon="([\d\.-]+)"/g;
            let m; while ((m = regex.exec(text)) !== null) latlngs.push([parseFloat(m[1]), parseFloat(m[2])]);
            if (latlngs.length > 0) L.polyline(latlngs, { color: '#fc4c02', opacity: 0.15, weight: 1.5, interactive: false }).addTo(heatmapMap);
        } catch (e) {}
        if(i % 5 === 0) await new Promise(r => setTimeout(r, 5));
    }
    btn.disabled = false; btn.innerText = "🚀 Klaar";
};

// --- MUNICIPALITIES ---
async function initMuniMap() {
    if (muniMap) { muniMap.invalidateSize(); return; }
    muniMap = L.map('map-municipalities').setView([50.0, 4.5], 6); 
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { attribution: '© OSM' }).addTo(muniMap);
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
    loadFeaturesToMap(allFeatures);
    document.getElementById('muni-loading').style.display = 'none';
}

function loadFeaturesToMap(features) {
    if(geoJsonLayer) muniMap.removeLayer(geoJsonLayer);
    geoJsonLayer = L.geoJSON({ type: "FeatureCollection", features: features }, {
        onEachFeature: (feature, layer) => { layer.muniName = feature.properties.muniName; layer.bindTooltip(layer.muniName, { sticky: true }); }
    }).addTo(muniMap);
    document.getElementById('muni-total').innerText = features.length;
    loadConqueredFromDB();
}

async function loadConqueredFromDB() {
    const names = await window.supabaseAuth.getConqueredMunicipalities();
    conqueredMunis = new Set(names);
    updateMuniUI();
}

function updateMuniUI() {
    if(!geoJsonLayer) return;
    const total = parseInt(document.getElementById('muni-total').innerText) || 1;
    const count = conqueredMunis.size;
    document.getElementById('muni-count').innerText = count;
    document.getElementById('muni-percent').innerText = ((count/total)*100).toFixed(1) + '%';
    document.getElementById('muni-progress-fill').style.width = ((count/total)*100) + '%';
    geoJsonLayer.eachLayer(layer => {
        if (conqueredMunis.has(layer.muniName)) {
            layer.setStyle({ fillColor: '#fc4c02', fillOpacity: 0.7, color: '#d94002', weight: 2 });
            layer.bringToFront();
        } else {
            layer.setStyle({ fillColor: 'transparent', color: 'transparent', weight: 0, className: 'region-unvisited' });
        }
    });
}

async function scanOldRides() {
    if(!geoJsonLayer || !confirm("Start scan van alle ritten?")) return;
    const activities = allActivitiesCache || await window.supabaseAuth.listActivities();
    const muniLayers = geoJsonLayer.getLayers();
    for (const act of activities) {
        const blob = await window.supabaseAuth.getActivityFile(act.id);
        const text = await blob.text();
        const found = [];
        const regex = /lat="([\d\.-]+)"\s+lon="([\d\.-]+)"/g;
        let m;
        while ((m = regex.exec(text)) !== null) {
            const pt = turf.point([parseFloat(m[2]), parseFloat(m[1])]);
            for (const layer of muniLayers) {
                if (conqueredMunis.has(layer.muniName)) continue;
                if (turf.booleanPointInPolygon(pt, layer.feature)) {
                    found.push(layer.muniName);
                    conqueredMunis.add(layer.muniName);
                }
            }
        }
        if(found.length > 0) await window.supabaseAuth.saveConqueredMunicipalities(found);
    }
    updateMuniUI();
}

// --- STANDAARD ---
async function updateDashboard() {
    if(!window.supabaseAuth.getCurrentUser()) return;
    let activities = await window.supabaseAuth.listActivities();
    allActivitiesCache = activities;
    let d=0, e=0; activities.forEach(a=>{ d+=parseFloat(a.summary.distanceKm||0); e+=parseFloat(a.summary.elevationGain||0); });
    document.getElementById('total-dist').innerText = d.toFixed(0) + ' km';
    document.getElementById('total-elev').innerText = e.toFixed(0) + ' m';
    document.getElementById('total-rides').innerText = activities.length;
    renderActivityList(activities.slice(0, 8), "📜 Recente Activiteiten");
}

function renderActivityList(activities, title) {
    const list = document.getElementById('dashboard-list');
    document.querySelector('.recent-section h3').innerText = title;
    list.innerHTML = activities.map(act => `
        <div class="dash-list-item">
            <div class="checkbox-zone" onclick="toggleSelection('${act.id}')"><input type="checkbox" class="list-checkbox" ${selectedRides.has(act.id)?'checked':''}></div>
            <div style="flex:1; display:flex; justify-content:space-between; align-items:center;" onclick="switchTab('analysis'); window.openRide(${JSON.stringify(act).replace(/"/g, '&quot;')})">
                <div><strong>${act.fileName}</strong><br><small>${new Date(act.summary.rideDate).toLocaleDateString()}</small></div>
                <div style="text-align:right"><strong>${act.summary.distanceKm} km</strong><br><small>${act.summary.avgSpeed} km/u</small></div>
            </div>
        </div>
    `).join('');
}

window.showAllActivities = () => renderActivityList(allActivitiesCache, "📜 Alle Activiteiten");
window.toggleSelection = (id) => { if(selectedRides.has(id)) selectedRides.delete(id); else selectedRides.add(id); updateDeleteButton(); renderActivityList(allActivitiesCache.slice(0,8), "📜 Recente Activiteiten"); };
function updateDeleteButton() { 
    const btn = document.getElementById('delete-btn'); 
    btn.classList.toggle('hidden', selectedRides.size === 0);
    document.getElementById('delete-count').innerText = selectedRides.size;
}
window.deleteSelectedRides = async function() {
    if(!confirm("Verwijderen?")) return;
    await window.supabaseAuth.deleteActivities(Array.from(selectedRides));
    selectedRides.clear(); updateDashboard();
};

window.triggerUpload = () => document.getElementById('gpxInput').click();
window.toggleTheme = () => {
    document.body.classList.toggle('dark-mode');
    localStorage.setItem('theme', document.body.classList.contains('dark-mode') ? 'dark' : 'light');
};
if(localStorage.getItem('theme')==='dark') document.body.classList.add('dark-mode');