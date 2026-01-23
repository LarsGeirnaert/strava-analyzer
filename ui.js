// ui.js - Dashboard, Rankings, Wereld Jager, Compare Charts & Dark Mode

let allActivitiesCache = null; 
let muniMap = null; 
let geoJsonLayer = null; 
let conqueredMunis = new Set(); 
let selectedRides = new Set(); 
let compareSelection = new Set(); 
let cmpCharts = {}; // Opslag voor chart instanties

// CONFIGURATIE REGIO'S
const REGIONS = [
    { code: 'be', url: 'communes.json', type: 'topojson', nameFields: ['Gemeente', 'name', 'NAME_4', 'Name'] },
    { code: 'nl', url: 'https://cartomap.github.io/nl/wgs84/gemeente_2023.geojson', type: 'geojson', nameFields: ['statnaam'] },
    { code: 'fr', url: 'https://raw.githubusercontent.com/gregoiredavid/france-geojson/master/departements.geojson', type: 'geojson', nameFields: ['nom'] }
];

document.addEventListener('DOMContentLoaded', () => {
    setupNavigation();
    setupSegmentSelector();
});

// --- NAVIGATIE ---
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

function switchTab(tabName) {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    const activeBtn = document.querySelector(`.nav-btn[data-target="${tabName}"]`);
    if(activeBtn && !activeBtn.id) activeBtn.classList.add('active');

    document.querySelectorAll('.view-section').forEach(v => v.classList.add('hidden'));
    document.getElementById(`view-${tabName}`).classList.remove('hidden');

    if(tabName === 'analysis') setTimeout(() => { if(typeof map !== 'undefined') map.invalidateSize(); }, 100);
    if(tabName === 'dashboard') { selectedRides.clear(); updateDeleteButton(); updateDashboard(); }
    
    // GEMEENTE TAB
    if(tabName === 'municipalities') setTimeout(() => initMuniMap(), 200);

    // RANGLIJSTEN UPDATE
    if(tabName === 'rankings') {
        if(!document.querySelector('.sub-nav-btn.active')) switchRankingTab('segments');
        else {
            const activeSub = document.querySelector('.sub-nav-btn.active');
            if(activeSub) activeSub.click();
        }
    }
}

// --- SUB TABS RANGLIJSTEN ---
window.switchRankingTab = async function(subTab) {
    document.querySelectorAll('.sub-nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.sub-nav-btn[onclick*="' + subTab + '"]').forEach(b => b.classList.add('active'));
    document.querySelectorAll('.rank-tab-content').forEach(d => d.classList.add('hidden'));
    document.getElementById(`rank-tab-${subTab}`).classList.remove('hidden');

    let activities = allActivitiesCache || await window.supabaseAuth.listActivities();
    allActivitiesCache = activities;

    if(subTab === 'segments') {
        loadRankings(document.getElementById('segmentSelector')?.value || 5);
    } else if(subTab === 'distance') {
        renderGeneralRanking(activities, 'distanceKm', 'distance-table-body');
    } else if(subTab === 'elevation') {
        renderGeneralRanking(activities, 'elevationGain', 'elevation-table-body');
    } else if(subTab === 'compare') {
        renderCompareSelectionList(activities);
    }
};

function renderGeneralRanking(activities, sortKey, tableId) {
    const tbody = document.getElementById(tableId);
    tbody.innerHTML = '<tr><td colspan="5">Laden...</td></tr>';
    const sorted = [...activities].sort((a, b) => (parseFloat(b.summary[sortKey]) || 0) - (parseFloat(a.summary[sortKey]) || 0));
    tbody.innerHTML = '';
    if(sorted.length === 0) { tbody.innerHTML = '<tr><td colspan="5">Geen ritten gevonden.</td></tr>'; return; }

    sorted.forEach((act, index) => {
        const tr = document.createElement('tr');
        tr.onclick = () => { switchTab('analysis'); window.openRide(act); };
        let displayVal = sortKey === 'distanceKm' ? `${parseFloat(act.summary.distanceKm).toFixed(1)} km` : `${act.summary.elevationGain} m`;
        let secondaryVal = sortKey === 'distanceKm' ? `${act.summary.avgSpeed} km/u` : `${parseFloat(act.summary.distanceKm).toFixed(1)} km`;
        tr.innerHTML = `<td><strong>${index + 1}</strong></td><td><strong>${act.fileName}</strong></td><td style="color:var(--text-muted)">${new Date(act.summary.rideDate).toLocaleDateString()}</td><td style="color:var(--primary); font-weight:bold;">${displayVal}</td><td>${secondaryVal}</td>`;
        tbody.appendChild(tr);
    });
}

function renderCompareSelectionList(activities) {
    const list = document.getElementById('compare-selection-list');
    list.innerHTML = '';
    const sorted = [...activities].sort((a, b) => new Date(b.summary.rideDate) - new Date(a.summary.rideDate));
    sorted.forEach(act => {
        const div = document.createElement('div');
        div.className = 'compare-item';
        div.innerHTML = `<input type="checkbox" id="cmp-${act.id}" value="${act.id}" ${compareSelection.has(act.id) ? 'checked' : ''}><label for="cmp-${act.id}" style="cursor:pointer; flex:1;"><strong>${act.fileName}</strong><br><small style="color:var(--text-muted)">${new Date(act.summary.rideDate).toLocaleDateString()} - ${act.summary.distanceKm} km</small></label>`;
        div.querySelector('input').addEventListener('change', (e) => { if(e.target.checked) compareSelection.add(act.id); else compareSelection.delete(act.id); updateCompareTable(); });
        list.appendChild(div);
    });
    updateCompareTable();
}

// --- COMPARE TABLES & CHARTS ---
async function updateCompareTable() {
    const table = document.getElementById('comparison-table');
    const chartsContainer = document.getElementById('compare-charts-container');

    if(compareSelection.size < 2) { 
        table.innerHTML = '<tbody><tr><td style="padding:20px; color:var(--text-muted);">Vink links minimaal 2 ritten aan.</td></tr></tbody>'; 
        chartsContainer.classList.add('hidden');
        return; 
    }

    // Toon charts
    chartsContainer.classList.remove('hidden');

    let activities = allActivitiesCache || await window.supabaseAuth.listActivities();
    const selectedActs = activities.filter(a => compareSelection.has(a.id))
                                   .sort((a, b) => new Date(a.summary.rideDate) - new Date(b.summary.rideDate)); // Oud naar Nieuw (logisch voor grafiek)

    // Tabel Header
    let html = '<thead><tr><th>Statistiek</th>';
    selectedActs.forEach(act => { html += `<th>${act.fileName}<br><small style="font-weight:normal;">${new Date(act.summary.rideDate).toLocaleDateString()}</small></th>`; });
    html += '</tr></thead><tbody>';
    
    const rows = [{ label: 'Afstand', key: 'distanceKm', unit: ' km' }, { label: 'Hoogte', key: 'elevationGain', unit: ' m' }, { label: 'Gem. Snelheid', key: 'avgSpeed', unit: ' km/u' }, { label: 'Tijd', key: 'durationSec', unit: '' }];
    
    rows.forEach(row => {
        html += `<tr><td>${row.label}</td>`;
        let maxVal = -1; selectedActs.forEach(act => { const val = parseFloat(act.summary[row.key]) || 0; if(val > maxVal) maxVal = val; });
        selectedActs.forEach(act => {
            let val = parseFloat(act.summary[row.key]) || 0;
            let display = val + row.unit;
            let style = '';
            if(row.key === 'durationSec') { const h = Math.floor(val / 3600); const m = Math.floor((val % 3600) / 60); display = `${h}u ${m}m`; }
            if(row.key === 'distanceKm' || row.key === 'avgSpeed') display = val.toFixed(1) + row.unit;
            if(val === maxVal && val > 0 && row.key !== 'durationSec') style = 'background: rgba(255, 215, 0, 0.15); border-color: gold;';
            html += `<td style="${style}">${display}</td>`;
        });
        html += '</tr>';
    });
    html += '</tbody>';
    table.innerHTML = html;

    // Update Grafieken
    updateCompareCharts(selectedActs);
}

function updateCompareCharts(rides) {
    const labels = rides.map(r => `${new Date(r.summary.rideDate).toLocaleDateString().slice(0,5)} ${r.fileName.substring(0,10)}..`);
    const distData = rides.map(r => parseFloat(r.summary.distanceKm));
    const elevData = rides.map(r => parseFloat(r.summary.elevationGain));
    const speedData = rides.map(r => parseFloat(r.summary.avgSpeed));

    const createChart = (id, label, data, color) => {
        const ctx = document.getElementById(id).getContext('2d');
        if (cmpCharts[id]) cmpCharts[id].destroy();
        cmpCharts[id] = new Chart(ctx, {
            type: 'bar',
            data: { labels: labels, datasets: [{ label: label, data: data, backgroundColor: color, borderColor: color.replace('0.7','1'), borderWidth: 1, borderRadius: 4 }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true }, x: { grid: { display: false } } } }
        });
    };

    createChart('cmpChartDist', 'Afstand (km)', distData, 'rgba(54, 162, 235, 0.7)');
    createChart('cmpChartElev', 'Hoogte (m)', elevData, 'rgba(255, 99, 132, 0.7)');
    createChart('cmpChartSpeed', 'Snelheid (km/u)', speedData, 'rgba(255, 206, 86, 0.7)');
}

// --- MAP LOGICA (Multi-Region) ---
async function initMuniMap() {
    if (muniMap) { muniMap.invalidateSize(); return; }
    muniMap = L.map('map-municipalities').setView([50.0, 4.5], 6); 
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { attribution: '© OSM' }).addTo(muniMap);

    const header = document.querySelector('#view-municipalities .view-header');
    if(!document.getElementById('scan-btn')) {
        const btn = document.createElement('button');
        btn.id = 'scan-btn'; btn.innerText = "⏳ Kaarten laden..."; btn.disabled = true; btn.onclick = scanOldRides;
        btn.style = "margin-top:10px; padding:8px 15px; background:#ccc; color:white; border:none; border-radius:5px; cursor:not-allowed;";
        header.appendChild(btn);
    }

    const loading = document.getElementById('muni-loading');
    loading.style.display = 'block';

    try {
        let allFeatures = [];
        const promises = REGIONS.map(async (region) => {
            try {
                const res = await fetch(region.url);
                if(!res.ok) throw new Error(`HTTP ${res.status}`);
                let data = await res.json();
                if (region.type === 'topojson' && data.type === 'Topology' && typeof topojson !== 'undefined') {
                    data = topojson.feature(data, data.objects[Object.keys(data.objects)[0]]);
                }
                data.features.forEach(f => {
                    let name = "Onbekend";
                    for(const field of region.nameFields) { if(f.properties[field]) { name = f.properties[field]; break; } }
                    f.properties.muniName = `${name} (${region.code.toUpperCase()})`; 
                });
                return data.features;
            } catch (err) { console.warn(err); return []; }
        });

        const results = await Promise.all(promises);
        results.forEach(features => allFeatures.push(...features));
        if (allFeatures.length === 0) throw new Error("Geen kaarten geladen.");
        loadFeaturesToMap(allFeatures);
        loading.style.display = 'none';
    } catch (e) {
        loading.innerHTML = `⚠️ Fout: ${e.message}. Is 'communes.json' lokaal aanwezig?`;
    }
}

function loadFeaturesToMap(features) {
    if(geoJsonLayer) muniMap.removeLayer(geoJsonLayer);
    
    geoJsonLayer = L.geoJSON({ type: "FeatureCollection", features: features }, {
        // STYLE FUNCTIE
        onEachFeature: (feature, layer) => { 
            layer.muniName = feature.properties.muniName; 
            layer.bindTooltip(layer.muniName, { sticky: true }); 
        }
    }).addTo(muniMap);

    document.getElementById('muni-total').innerText = features.length;
    const btn = document.getElementById('scan-btn');
    if(btn) { btn.innerText = "🔄 Scan Alle Ritten"; btn.disabled = false; btn.style.background = "#fc4c02"; btn.style.cursor="pointer"; }
    loadConqueredFromDB();
}

async function loadConqueredFromDB() {
    if(!geoJsonLayer) return;
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
            layer.setStyle({ fillColor: '#fc4c02', fillOpacity: 0.7, color: '#d94002', weight: 2, className: '' });
            layer.bringToFront();
        } else {
            layer.setStyle({ fillColor: 'transparent', color: 'transparent', weight: 0, className: 'region-unvisited' });
        }
    });
}

async function scanOldRides() {
    if(!geoJsonLayer) return;
    if(!confirm("Start scan?")) return;
    const btn = document.getElementById('scan-btn'); const loading = document.getElementById('muni-loading');
    btn.disabled = true; loading.style.display = 'block'; loading.innerText = "Bezig...";
    try {
        let activities = allActivitiesCache || await window.supabaseAuth.listActivities();
        const muniLayers = geoJsonLayer.getLayers();
        let totalFound = 0;
        for (const act of activities) {
            loading.innerText = `Scan: ${act.fileName}`;
            const blob = await window.supabaseAuth.getActivityFile(act.id);
            const text = await blob.text();
            const found = window.findMunisInGpx(text, muniLayers);
            if(found.length > 0) { totalFound += found.length; await window.supabaseAuth.saveConqueredMunicipalities(found); found.forEach(n => conqueredMunis.add(n)); }
        }
        updateMuniUI(); loading.innerText = `Klaar! ${totalFound} gevonden.`;
        setTimeout(() => { loading.style.display = 'none'; btn.disabled=false; }, 3000);
    } catch (e) { console.error(e); loading.innerText = "Fout: " + e.message; btn.disabled = false; }
}

// --- STANDAARD FUNCTIES ---
async function updateDashboard() {
    if(!window.supabaseAuth || !window.supabaseAuth.getCurrentUser()) return;
    let activities = allActivitiesCache || await window.supabaseAuth.listActivities();
    allActivitiesCache = activities;
    let totalDist = 0, totalElev = 0;
    activities.forEach(act => { totalDist += parseFloat(act.summary.distanceKm || 0); totalElev += parseFloat(act.summary.elevationGain || 0); });
    document.getElementById('total-dist').innerText = totalDist.toFixed(0) + ' km';
    document.getElementById('total-elev').innerText = totalElev.toFixed(0) + ' m';
    document.getElementById('total-rides').innerText = activities.length;
    renderActivityList(activities.slice(0, 5), "📜 Recente Activiteiten");
}

window.showAllActivities = function() { if(allActivitiesCache) renderActivityList(allActivitiesCache, `📜 Alle Activiteiten (${allActivitiesCache.length})`); };

function renderActivityList(activities, title) {
    const list = document.getElementById('dashboard-list');
    document.querySelector('.recent-section h3').innerText = title;
    list.innerHTML = ''; 
    if(activities.length === 0) { list.innerHTML = '<p style="padding:15px; color:var(--text-muted)">Nog geen ritten.</p>'; return; }
    activities.forEach(act => {
        const div = document.createElement('div');
        div.className = 'dash-list-item';
        div.style.paddingLeft = "0"; div.style.display = "flex"; div.style.alignItems = "stretch";
        const name = act.fileName || "Naamloos";
        div.innerHTML = `<div class="checkbox-zone"><input type="checkbox" class="list-checkbox" value="${act.id}"></div><div class="item-content" style="flex:1; display:flex; justify-content:space-between; align-items:center; padding: 15px 15px 15px 0;"><div><strong>${name}</strong><br><small>${new Date(act.summary.rideDate).toLocaleDateString('nl-NL')}</small></div><div style="text-align:right"><strong>${act.summary.distanceKm} km</strong><br><small>${act.summary.avgSpeed} km/u</small></div></div>`;
        const checkbox = div.querySelector('.list-checkbox');
        div.querySelector('.checkbox-zone').addEventListener('click', (e) => { e.stopPropagation(); toggleSelection(act.id); checkbox.checked = selectedRides.has(act.id); });
        div.querySelector('.item-content').onclick = () => { switchTab('analysis'); window.openRide(act); };
        if(selectedRides.has(act.id)) checkbox.checked = true;
        list.appendChild(div);
    });
}

function toggleSelection(id) { if(selectedRides.has(id)) selectedRides.delete(id); else selectedRides.add(id); updateDeleteButton(); }
function updateDeleteButton() { const btn = document.getElementById('delete-btn'); const count = document.getElementById('delete-count'); if(btn && count) { if(selectedRides.size > 0) { btn.classList.remove('hidden'); count.innerText = selectedRides.size; } else btn.classList.add('hidden'); } }
window.deleteSelectedRides = async function() { if(selectedRides.size === 0 || !confirm("Zeker weten?")) return; try { await window.supabaseAuth.deleteActivities(Array.from(selectedRides)); allActivitiesCache = null; selectedRides.clear(); updateDeleteButton(); updateDashboard(); } catch(e) { alert("Fout: " + e.message); } };

window.loadRankings = async function(distanceKm) {
    distanceKm = parseInt(distanceKm);
    const list = document.getElementById('ranking-list');
    list.innerHTML = '<p style="padding:20px; text-align:center;">Laden...</p>';
    let activities = allActivitiesCache || await window.supabaseAuth.listActivities();
    allActivitiesCache = activities;
    const rankedData = activities.map(act => {
        const segments = act.summary.segments || [];
        const match = segments.find(s => s.distance === distanceKm);
        if(match) return { ...match, fileName: act.fileName, date: act.summary.rideDate, activity: act };
        return null;
    }).filter(i => i).sort((a, b) => b.speed - a.speed);
    list.innerHTML = '';
    if(rankedData.length === 0) { list.innerHTML = `<div style="padding:20px; text-align:center; color:var(--text-muted);"><p>Geen prestaties voor ${distanceKm} km.</p></div>`; return; }
    rankedData.forEach((item, index) => {
        const div = document.createElement('div');
        let c = index===0?'gold':index===1?'silver':index===2?'bronze':'';
        const timeStr = new Date(item.timeMs).toISOString().substr(11, 8);
        div.className = `rank-card ${c}`;
        div.innerHTML = `<div style="display:flex;gap:15px;align-items:center;"><div class="rank-pos">#${index+1}</div><div><strong>${item.fileName}</strong><br><small>${new Date(item.date).toLocaleDateString()}</small></div></div><div style="text-align:right"><div class="rank-speed">${item.speed.toFixed(1)} km/u</div><small style="font-family:monospace;">${timeStr}</small></div>`;
        div.onclick = () => { switchTab('analysis'); window.openRide(item.activity); };
        list.appendChild(div);
    });
};

window.findMunisInGpx = function(xmlString, layers) {
    if(typeof turf === 'undefined') return [];
    const found = new Set();
    const xmlDoc = new DOMParser().parseFromString(xmlString, "text/xml");
    const trkpts = xmlDoc.getElementsByTagName('trkpt');
    for(let i=0; i < trkpts.length; i+=50) {
        let lat = parseFloat(trkpts[i].getAttribute('lat'));
        let lon = parseFloat(trkpts[i].getAttribute('lon'));
        if(isNaN(lat)) continue;
        const pt = turf.point([lon, lat]);
        for (const layer of layers) {
            if (found.has(layer.muniName)) continue;
            if (turf.booleanPointInPolygon(pt, layer.feature)) { found.add(layer.muniName); break; }
        }
    }
    return Array.from(found);
};

window.triggerUpload = function() { switchTab('analysis'); document.getElementById('gpxInput')?.click(); };
window.switchTab = switchTab;
window.updateDashboard = updateDashboard;

window.toggleTheme = function() {
    document.body.classList.toggle('dark-mode');
    localStorage.setItem('theme', document.body.classList.contains('dark-mode') ? 'dark' : 'light');
    document.getElementById('theme-btn').innerText = document.body.classList.contains('dark-mode') ? '☀️' : '🌙';
};
(function(){ if(localStorage.getItem('theme')==='dark') { document.body.classList.add('dark-mode'); document.getElementById('theme-btn').innerText='☀️'; } })();