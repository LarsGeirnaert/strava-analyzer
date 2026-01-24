// ui.js - Volledige motor voor Dashboard, Recap, Rankings, Heatmap & Wereld Jager Fix

let allActivitiesCache = null; 
let muniMap = null; 
let heatmapMap = null; 
let geoJsonLayer = null; 
let conqueredMunis = new Set(); 
let selectedRides = new Set(); 
let activeCharts = {}; 

const REGIONS = [
    { code: 'be', url: 'communes.json', type: 'topojson', nameFields: ['Gemeente', 'name', 'NAME_4', 'Name'] },
    { code: 'nl', url: 'https://cartomap.github.io/nl/wgs84/gemeente_2023.geojson', type: 'geojson', nameFields: ['statnaam'] },
    { code: 'fr', url: 'https://raw.githubusercontent.com/gregoiredavid/france-geojson/master/departements.geojson', type: 'geojson', nameFields: ['nom'] }
];

document.addEventListener('DOMContentLoaded', () => {
    setupNavigation();
    setupSegmentSelector();
    const now = new Date();
    document.getElementById('recap-month-select').value = now.getMonth();
    document.getElementById('recap-year-select').value = now.getFullYear();
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

// --- TRENDLIJN BEREKENING ---
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

// --- NAVIGATIE & KAART FIX ---
function switchTab(tabName) {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    const activeBtn = document.querySelector(`.nav-btn[data-target="${tabName}"]`);
    if(activeBtn) activeBtn.classList.add('active');

    document.querySelectorAll('.view-section').forEach(v => v.classList.add('hidden'));
    document.getElementById(`view-${tabName}`).classList.remove('hidden');

    setTimeout(() => {
        if(tabName === 'analysis' && typeof map !== 'undefined' && map) map.invalidateSize();
        if(tabName === 'municipalities' && muniMap) muniMap.invalidateSize();
        if(tabName === 'heatmap' && heatmapMap) heatmapMap.invalidateSize();
    }, 150);

    if(tabName === 'dashboard') updateDashboard();
    if(tabName === 'recap') updateRecapView();
    if(tabName === 'municipalities') initMuniMap();
    if(tabName === 'heatmap') initHeatmapMap();
    if(tabName === 'rankings') switchRankingTab('segments');
}

// --- DASHBOARD LOGICA ---
async function updateDashboard() {
    if(!window.supabaseAuth.getCurrentUser()) return;
    allActivitiesCache = await window.supabaseAuth.listActivities();
    let d=0, e=0; 
    allActivitiesCache.forEach(a => { d += parseFloat(a.summary.distanceKm||0); e += parseFloat(a.summary.elevationGain||0); });
    
    document.getElementById('total-dist').innerText = d.toFixed(0) + ' km';
    document.getElementById('total-elev').innerText = e.toFixed(0) + ' m';
    document.getElementById('total-rides').innerText = allActivitiesCache.length;
    renderActivityList(allActivitiesCache.slice(0, 8));
}

// --- RECAP LOGICA (JAAROVERZICHT) ---
async function updateRecapView() {
    if(!allActivitiesCache) allActivitiesCache = await window.supabaseAuth.listActivities();
    
    const selMonth = document.getElementById('recap-month-select').value;
    const selYear = parseInt(document.getElementById('recap-year-select').value);
    
    const filtered = allActivitiesCache.filter(act => {
        const d = new Date(act.summary.rideDate);
        const matchYear = d.getFullYear() === selYear;
        const matchMonth = selMonth === 'all' || d.getMonth() === parseInt(selMonth);
        return matchYear && matchMonth;
    });

    let d=0, e=0, s=0;
    filtered.forEach(act => { 
        d += parseFloat(act.summary.distanceKm || 0); 
        e += parseFloat(act.summary.elevationGain || 0); 
        s += parseFloat(act.summary.avgSpeed || 0); 
    });

    const avgSpeed = filtered.length > 0 ? (s / filtered.length).toFixed(1) : 0;
    const title = selMonth === 'all' ? `Jaaroverzicht ${selYear}` : `${document.getElementById('recap-month-select').options[document.getElementById('recap-month-select').selectedIndex].text} ${selYear}`;

    document.getElementById('recap-period-title').innerText = title;
    document.getElementById('recap-dist').innerText = d.toFixed(1) + ' km';
    document.getElementById('recap-elev').innerText = e.toFixed(0) + ' m';
    document.getElementById('recap-count').innerText = filtered.length;
    document.getElementById('recap-speed').innerText = avgSpeed + ' km/u';

    // Jaardoel progressie
    const yearDist = allActivitiesCache.filter(act => new Date(act.summary.rideDate).getFullYear() === selYear).reduce((acc, a) => acc + a.summary.distanceKm, 0);
    const goalPercent = Math.min(100, (yearDist / 5000) * 100).toFixed(1);
    document.getElementById('recap-goal-percent').innerText = goalPercent + '%';
    document.getElementById('recap-goal-fill').style.width = goalPercent + '%';

    // Top prestaties
    const sorted = [...filtered].sort((a,b) => b.summary.distanceKm - a.summary.distanceKm).slice(0, 3);
    document.getElementById('recap-best-list').innerHTML = sorted.map(act => `
        <div class="rank-card" onclick="switchTab('analysis'); window.openRide(${JSON.stringify(act).replace(/"/g, '&quot;')})">
            <div><strong>${act.fileName}</strong><br><small>${new Date(act.summary.rideDate).toLocaleDateString()}</small></div>
            <div style="text-align:right"><strong>${act.summary.distanceKm} km</strong></div>
        </div>
    `).join('') || '<p style="text-align:center;">Geen ritten in deze periode.</p>';
}

// --- WERELD JAGER (FIXED) ---
async function initMuniMap() {
    if (muniMap) { muniMap.invalidateSize(); return; }
    muniMap = L.map('map-municipalities').setView([50.85, 4.35], 8);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png').addTo(muniMap);
    loadFeatures();
}

async function loadFeatures() {
    let allFeatures = [];
    const loadingEl = document.getElementById('muni-loading');
    if(loadingEl) loadingEl.style.display = 'block';
    
    for(const region of REGIONS) {
        try {
            const res = await fetch(region.url);
            let data = await res.json();
            if (region.type === 'topojson') data = topojson.feature(data, data.objects[Object.keys(data.objects)[0]]);
            data.features.forEach(f => {
                let name = "Onbekend";
                for(const field of region.nameFields) { if(f.properties[field]) { name = f.properties[field]; break; } }
                f.properties.muniName = `${name} (${region.code.toUpperCase()})`; 
            });
            allFeatures.push(...data.features);
        } catch (err) { console.error("Laden regio mislukt:", region.code); }
    }

    if(geoJsonLayer && muniMap) muniMap.removeLayer(geoJsonLayer);
    
    geoJsonLayer = L.geoJSON({ type: "FeatureCollection", features: allFeatures }, {
        onEachFeature: (feature, layer) => { 
            layer.muniName = feature.properties.muniName; 
            layer.bindTooltip(layer.muniName, { sticky: true }); 
        }
    }).addTo(muniMap);

    // FIX: Wacht tot kaartlagen er zijn voor teller-update
    const names = await window.supabaseAuth.getConqueredMunicipalities();
    conqueredMunis = new Set(names);
    
    updateMuniUI(); 
    if(loadingEl) loadingEl.style.display = 'none';
}

function updateMuniUI() {
    if(!geoJsonLayer) return;
    const total = geoJsonLayer.getLayers().length;
    const count = conqueredMunis.size;
    const percent = total > 0 ? ((count / total) * 100).toFixed(1) : 0;

    const countEl = document.getElementById('muni-count');
    const totalEl = document.getElementById('muni-total');
    const percentEl = document.getElementById('muni-percent');
    const fillEl = document.getElementById('muni-progress-fill');

    if(countEl) countEl.innerText = count;
    if(totalEl) totalEl.innerText = total;
    if(percentEl) percentEl.innerText = percent + '%';
    if(fillEl) fillEl.style.width = percent + '%';

    geoJsonLayer.eachLayer(l => {
        if (conqueredMunis.has(l.muniName)) {
            l.setStyle({ fillColor: '#fc4c02', fillOpacity: 0.7, color: '#d94002', weight: 2 });
        } else {
            l.setStyle({ fillColor: 'transparent', color: 'transparent', weight: 0 });
        }
    });
}

// --- HEATMAP & CACHE ---
async function initHeatmapMap() {
    if (heatmapMap) { heatmapMap.invalidateSize(); return; }
    heatmapMap = L.map('map-heatmap', { zoomControl: true, attributionControl: false }).setView([50.85, 4.35], 7);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png').addTo(heatmapMap);

    heatmapMap.on('click', async (e) => {
        const user = window.supabaseAuth.getCurrentUser();
        const cacheKey = `heatmap_coords_${user.id}`;
        let cachedData = JSON.parse(localStorage.getItem(cacheKey) || "{}");
        const matches = [];

        for (const actId in cachedData) {
            const coords = cachedData[actId];
            const isNear = coords.some(c => e.latlng.distanceTo(L.latLng(c[0], c[1])) < 45);
            if (isNear) {
                const act = allActivitiesCache.find(a => a.id === actId);
                if (act) matches.push(act);
            }
        }

        if (matches.length > 0) {
            matches.sort((a,b) => new Date(b.summary.rideDate) - new Date(a.summary.rideDate));
            const html = `
                <div style="min-width:180px;">
                    <strong style="color:var(--primary);">🔥 ${matches.length} ritten hier</strong>
                    <div style="margin-top:8px; max-height:150px; overflow-y:auto; border-top:1px solid #eee; padding-top:5px;">
                        ${matches.map(m => `
                            <div style="margin-bottom:8px; cursor:pointer;" onclick='window.openRideFromHeatmap(${JSON.stringify({id: m.id, fileName: m.fileName, summary: m.summary}).replace(/"/g, "&quot;")})'>
                                <span style="color:#007bff; font-weight:bold; font-size:0.9rem; text-decoration:underline;">${m.fileName}</span><br>
                                <small style="color:#666;">${new Date(m.summary.rideDate).toLocaleDateString()}</small>
                            </div>
                        `).join('')}
                    </div>
                </div>`;
            L.popup().setLatLng(e.latlng).setContent(html).openOn(heatmapMap);
        }
    });
}

window.openRideFromHeatmap = function(act) { 
    heatmapMap.closePopup(); switchTab('analysis'); window.openRide(act); 
};

window.generateHeatmap = async function() {
    const bar = document.getElementById('heatmap-bar');
    document.getElementById('heatmap-progress').style.display = "block";
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
                const regex = /lat="([\d\.-]+)"\s+lon="([\d\.-]+)"/g;
                let m; const coords = [];
                while ((m = regex.exec(text)) !== null) coords.push([parseFloat(m[1]), parseFloat(m[2])]);
                latlngs = coords.filter((_, idx) => idx % 10 === 0);
                cachedData[act.id] = latlngs;
            } catch (e) {}
        }
        if (latlngs) L.polyline(latlngs, { color: '#fc4c02', opacity: 0.35, weight: 2.5, interactive: false }).addTo(heatmapMap);
    }
    localStorage.setItem(cacheKey, JSON.stringify(cachedData));
    setTimeout(() => document.getElementById('heatmap-progress').style.display = "none", 1000);
};

window.clearHeatmapCache = function() {
    const user = window.supabaseAuth.getCurrentUser();
    localStorage.removeItem(`heatmap_coords_${user.id}`);
    location.reload();
};

// --- RANGLIJSTEN & TRENDS LOGICA ---
window.switchRankingTab = async function(subTab) {
    document.querySelectorAll('.sub-nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll(`.sub-nav-btn[onclick*="${subTab}"]`).forEach(b => b.classList.add('active'));
    document.querySelectorAll('.rank-tab-content').forEach(d => d.classList.add('hidden'));
    document.getElementById(`rank-tab-${subTab}`).classList.remove('hidden');

    if(!allActivitiesCache) allActivitiesCache = await window.supabaseAuth.listActivities();

    if(subTab === 'segments') {
        loadRankings(document.getElementById('segmentSelector').value);
    } else if(subTab === 'distance') {
        renderTrendGraph(allActivitiesCache, 'distanceKm', 'distance-table-body', 'distanceTrendChart', 'distanceTopFilter', 'Afstand (km)');
    } else if(subTab === 'elevation') {
        renderTrendGraph(allActivitiesCache, 'elevationGain', 'elevation-table-body', 'elevationTrendChart', 'elevationTopFilter', 'Hoogte (m)');
    }
};

function renderTrendGraph(activities, key, tableId, chartId, filterId, label) {
    const filterVal = document.getElementById(filterId).value;
    
    // Sorteer voor tabel (hoogste eerst)
    let ranked = [...activities].sort((a, b) => (parseFloat(b.summary[key])||0) - (parseFloat(a.summary[key])||0));
    if(filterVal !== 'all') ranked = ranked.slice(0, parseInt(filterVal));
    
    // Sorteer chronologisch voor grafiek
    const chrono = [...ranked].sort((a,b) => new Date(a.summary.rideDate) - new Date(b.summary.rideDate));
    const values = chrono.map(a => parseFloat(a.summary[key]) || 0);
    const trend = calculateTrendLine(values);
    
    const ctx = document.getElementById(chartId).getContext('2d');
    if(activeCharts[chartId]) activeCharts[chartId].destroy();
    
    activeCharts[chartId] = new Chart(ctx, {
        type: 'line',
        data: {
            labels: chrono.map(a => new Date(a.summary.rideDate).toLocaleDateString()),
            datasets: [
                { label: label, data: values, borderColor: '#fc4c02', backgroundColor: 'rgba(252, 76, 2, 0.1)', fill: true, tension: 0.2, pointRadius: 4 },
                { label: 'Trendlijn', data: trend, borderColor: '#333', borderDash: [5,5], pointRadius: 0, fill: false }
            ]
        },
        options: { responsive: true, maintainAspectRatio: false }
    });

    document.getElementById(tableId).innerHTML = ranked.map((act, i) => `
        <tr style="cursor:pointer;" onclick="switchTab('analysis'); window.openRide(${JSON.stringify(act).replace(/"/g, '&quot;')})">
            <td>#${i+1}</td>
            <td>${act.fileName}</td>
            <td>${new Date(act.summary.rideDate).toLocaleDateString()}</td>
            <td><strong>${parseFloat(act.summary[key]).toFixed(1)}</strong></td>
        </tr>`).join('');
}

window.loadRankings = async function(distanceKm) {
    if(!allActivitiesCache) allActivitiesCache = await window.supabaseAuth.listActivities();
    
    distanceKm = parseInt(distanceKm);
    const maxElev = parseFloat(document.getElementById('segmentMaxElev').value) || 99999;
    
    let data = allActivitiesCache.map(act => {
        const seg = (act.summary.segments || []).find(s => s.distance === distanceKm);
        if(seg) return { ...seg, fileName: act.fileName, date: act.summary.rideDate, activity: act, elev: act.summary.elevationGain };
        return null;
    }).filter(i => i && i.elev <= maxElev);
    
    data.sort((a, b) => b.speed - a.speed);
    
    const list = document.getElementById('ranking-list');
    if(!list) return;

    if(data.length === 0) {
        list.innerHTML = '<p style="text-align:center; padding:20px;">Geen data gevonden voor dit segment.</p>';
        document.getElementById('segment-progression-container').style.display = 'none';
        return;
    }

    // Progressie grafiek voor records
    document.getElementById('segment-progression-container').style.display = 'block';
    const progression = [...data].sort((a, b) => new Date(a.date) - new Date(b.date));
    const speeds = progression.map(d => parseFloat(d.speed.toFixed(2)));
    const trend = calculateTrendLine(speeds);

    const ctx = document.getElementById('segmentProgressionChart').getContext('2d');
    if(activeCharts['segChart']) activeCharts['segChart'].destroy();
    activeCharts['segChart'] = new Chart(ctx, {
        type: 'line',
        data: {
            labels: progression.map(d => new Date(d.date).toLocaleDateString()),
            datasets: [
                { label: 'Snelheid (km/u)', data: speeds, borderColor: '#28a745', fill: true, tension: 0.1, pointRadius: 5 },
                { label: 'Trendlijn', data: trend, borderColor: '#fc4c02', borderDash: [10,5], pointRadius: 0, fill: false, borderWidth: 2 }
            ]
        },
        options: { responsive: true, maintainAspectRatio: false }
    });

    list.innerHTML = data.map((item, index) => `
        <div class="rank-card" onclick="switchTab('analysis'); window.openRide(${JSON.stringify(item.activity).replace(/"/g, '&quot;')})">
            <div><strong>#${index+1} ${item.fileName}</strong><br><small>${new Date(item.date).toLocaleDateString()} (⛰️ ${item.elev}m)</small></div>
            <div style="text-align:right"><div class="rank-speed">${item.speed.toFixed(1)} <small>km/u</small></div></div>
        </div>`).join('');
};

function renderActivityList(acts) {
    const list = document.getElementById('dashboard-list');
    if(!list) return;
    list.innerHTML = acts.map(act => `
        <div class="dash-list-item">
            <input type="checkbox" onchange="toggleSelection('${act.id}')" ${selectedRides.has(act.id)?'checked':''}>
            <div style="flex:1; display:flex; justify-content:space-between; margin-left:10px;" onclick="switchTab('analysis'); window.openRide(${JSON.stringify(act).replace(/"/g, '&quot;')})">
                <strong>${act.fileName}</strong><span>${act.summary.distanceKm} km</span>
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
window.toggleTheme = () => { document.body.classList.toggle('dark-mode'); localStorage.setItem('theme', document.body.classList.contains('dark-mode') ? 'dark' : 'light'); };