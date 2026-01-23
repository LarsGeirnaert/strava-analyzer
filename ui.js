// ui.js - Dashboard, Tabs, Ranglijsten & Gemeente Jager (TopoJSON Support)

let allActivitiesCache = null; 
let muniMap = null; 
let geoJsonLayer = null; 
let conqueredMunis = new Set(); 
let selectedRides = new Set(); 

// We gebruiken het bestand dat we net gedownload hebben
const GEOJSON_URLS = ['communes.json'];

document.addEventListener('DOMContentLoaded', () => {
    setupNavigation();
    setupSegmentSelector();
});

// --- STANDAARD SETUP ---
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
    if(activeBtn) activeBtn.classList.add('active');

    document.querySelectorAll('.view-section').forEach(v => v.classList.add('hidden'));
    document.getElementById(`view-${tabName}`).classList.remove('hidden');

    if(tabName === 'analysis') setTimeout(() => { if(typeof map !== 'undefined') map.invalidateSize(); }, 100);
    if(tabName === 'dashboard') { selectedRides.clear(); updateDeleteButton(); updateDashboard(); }
    if(tabName === 'rankings') loadRankings(document.getElementById('segmentSelector')?.value || 5);
    
    // GEMEENTE TAB
    if(tabName === 'municipalities') {
        setTimeout(() => {
            initMuniMap(); 
        }, 200);
    }
}

// --- DASHBOARD ---
async function updateDashboard() {
    if(!window.supabaseAuth || !window.supabaseAuth.getCurrentUser()) return;
    let activities = allActivitiesCache;
    if(!activities) {
        activities = await window.supabaseAuth.listActivities();
        allActivitiesCache = activities;
    }
    let totalDist = 0, totalElev = 0;
    activities.forEach(act => {
        totalDist += parseFloat(act.summary.distanceKm || 0);
        totalElev += parseFloat(act.summary.elevationGain || 0);
    });
    document.getElementById('total-dist').innerText = totalDist.toFixed(0) + ' km';
    document.getElementById('total-elev').innerText = totalElev.toFixed(0) + ' m';
    document.getElementById('total-rides').innerText = activities.length;
    renderActivityList(activities.slice(0, 5), "📜 Recente Activiteiten");
}

window.showAllActivities = function() {
    if(allActivitiesCache) renderActivityList(allActivitiesCache, `📜 Alle Activiteiten (${allActivitiesCache.length})`);
};

function renderActivityList(activities, title) {
    const list = document.getElementById('dashboard-list');
    document.querySelector('.recent-section h3').innerText = title;
    list.innerHTML = ''; 
    if(activities.length === 0) { list.innerHTML = '<p style="padding:15px; color:#888">Nog geen ritten.</p>'; return; }

    activities.forEach(act => {
        const div = document.createElement('div');
        div.className = 'dash-list-item';
        div.style.paddingLeft = "0"; div.style.display = "flex"; div.style.alignItems = "stretch";

        const name = act.fileName || "Naamloos";
        div.innerHTML = `
            <div class="checkbox-zone"><input type="checkbox" class="list-checkbox" value="${act.id}"></div>
            <div class="item-content" style="flex:1; display:flex; justify-content:space-between; align-items:center; padding: 15px 15px 15px 0;">
                <div><strong>${name}</strong><br><small style="color:#888">${new Date(act.summary.rideDate).toLocaleDateString('nl-NL')}</small></div>
                <div style="text-align:right"><strong>${act.summary.distanceKm} km</strong><br><small style="color:#888">${act.summary.avgSpeed} km/u</small></div>
            </div>`;
        
        const checkbox = div.querySelector('.list-checkbox');
        div.querySelector('.checkbox-zone').addEventListener('click', (e) => {
            e.stopPropagation(); toggleSelection(act.id); checkbox.checked = selectedRides.has(act.id);
        });
        div.querySelector('.item-content').onclick = () => { switchTab('analysis'); window.openRide(act); };
        if(selectedRides.has(act.id)) checkbox.checked = true;
        list.appendChild(div);
    });
}

function toggleSelection(id) {
    if(selectedRides.has(id)) selectedRides.delete(id); else selectedRides.add(id);
    updateDeleteButton();
}

function updateDeleteButton() {
    const btn = document.getElementById('delete-btn');
    const count = document.getElementById('delete-count');
    if(btn && count) {
        if(selectedRides.size > 0) { btn.classList.remove('hidden'); count.innerText = selectedRides.size; }
        else btn.classList.add('hidden');
    }
}

window.deleteSelectedRides = async function() {
    if(selectedRides.size === 0 || !confirm("Zeker weten?")) return;
    try {
        await window.supabaseAuth.deleteActivities(Array.from(selectedRides));
        allActivitiesCache = null; selectedRides.clear();
        updateDeleteButton(); updateDashboard();
    } catch(e) { alert("Fout: " + e.message); }
};

window.loadRankings = async function(distanceKm) {
    distanceKm = parseInt(distanceKm);
    const list = document.getElementById('ranking-list');
    list.innerHTML = '<p style="padding:20px; text-align:center;">Laden...</p>';

    let activities = allActivitiesCache;
    if(!activities) {
        if(!window.supabaseAuth) return;
        activities = await window.supabaseAuth.listActivities();
        allActivitiesCache = activities;
    }

    const rankedData = activities.map(act => {
        const segments = act.summary.segments || [];
        const match = segments.find(s => s.distance === distanceKm);
        if(match) return { ...match, fileName: act.fileName, date: act.summary.rideDate, activity: act };
        return null;
    })
    .filter(item => item !== null)
    .sort((a, b) => b.speed - a.speed);

    list.innerHTML = '';
    
    if(rankedData.length === 0) { 
        list.innerHTML = `<div style="padding:20px; text-align:center; color:#666;">
            <p>Geen prestaties gevonden voor ${distanceKm} km.</p>
            <small>Upload nieuwe ritten om segmenten te berekenen.</small>
        </div>`; 
        return; 
    }

    rankedData.forEach((item, index) => {
        const div = document.createElement('div');
        let c = index===0?'gold':index===1?'silver':index===2?'bronze':'';
        let medal = index===0?'🥇':index===1?'🥈':index===2?'🥉':`#${index+1}`;
        div.className = `rank-card ${c}`;
        const t = Math.floor(item.timeMs/1000);
        const timeStr = new Date(item.timeMs).toISOString().substr(11, 8); 

        div.innerHTML = `
            <div style="display:flex;gap:15px;align-items:center;">
                <div class="rank-pos">${medal}</div>
                <div><strong>${item.fileName || 'Naamloos'}</strong><br><small style="color:#666">${new Date(item.date).toLocaleDateString()}</small></div>
            </div>
            <div style="text-align:right">
                <div class="rank-speed">${item.speed.toFixed(1)} km/u</div>
                <small style="font-family:monospace;color:#666">${timeStr}</small>
            </div>`;
        div.style.cursor = 'pointer';
        div.onclick = () => { switchTab('analysis'); window.openRide(item.activity); };
        list.appendChild(div);
    });
};

// --- GEMEENTE JAGER (MET TOPOJSON SUPPORT) ---

async function initMuniMap() {
    if (muniMap) { muniMap.invalidateSize(); return; }
    
    muniMap = L.map('map-municipalities').setView([50.5039, 4.4699], 8); 
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { attribution: '© OSM' }).addTo(muniMap);

    const header = document.querySelector('#view-municipalities .view-header');
    if(!document.getElementById('scan-btn')) {
        const btn = document.createElement('button');
        btn.id = 'scan-btn'; btn.innerText = "⏳ Kaart laden..."; btn.disabled = true; 
        btn.style = "margin-top:10px; padding:8px 15px; background:#ccc; color:white; border:none; border-radius:5px; cursor:not-allowed;";
        btn.onclick = scanOldRides;
        header.appendChild(btn);
    }

    try {
        console.log("Laden van: communes.json");
        const response = await fetch('communes.json');
        if (!response.ok) throw new Error(`Bestand niet gevonden (${response.status})`);
        
        let data = await response.json();

        // FIX: TOPOJSON CONVERSIE
        if (data.type === 'Topology') {
            console.log("TopoJSON gedetecteerd, converteren naar GeoJSON...");
            if(typeof topojson === 'undefined') throw new Error("TopoJSON library ontbreekt in index.html");
            // Zoek de juiste object key (vaak 'Gemeenten' of 'communes')
            const key = Object.keys(data.objects)[0]; 
            data = topojson.feature(data, data.objects[key]);
        }

        loadGeoJsonToMap(data);

    } catch (e) {
        console.error("Kaart fout:", e);
        const loading = document.getElementById('muni-loading');
        loading.innerHTML = `⚠️ Fout: ${e.message}.<br>Heb je stap 1 en 2 (downloaden en script toevoegen) gedaan?`;
        loading.style.display = 'block';
    }
}

function loadGeoJsonToMap(data) {
    if(geoJsonLayer) return;
    
    geoJsonLayer = L.geoJSON(data, {
        style: { fillColor: '#cccccc', weight: 1, opacity: 1, color: 'white', fillOpacity: 0.5 },
        onEachFeature: (feature, layer) => {
            const p = feature.properties;
            // Flexibele naam herkenning
            const name = p.Gemeente || p.Name || p.name || p.NAME_4 || "Onbekend";
            layer.muniName = name; 
            layer.bindTooltip(name, { sticky: true });
        }
    }).addTo(muniMap);
    
    document.getElementById('muni-total').innerText = data.features.length;

    const btn = document.getElementById('scan-btn');
    if(btn) { btn.innerText = "🔄 Scan Oude Ritten"; btn.disabled = false; btn.style.background = "#fc4c02"; btn.style.cursor = "pointer"; }

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
            layer.setStyle({ fillColor: '#fc4c02', fillOpacity: 0.7, color: '#d94002', weight: 2 });
        } else {
            layer.setStyle({ fillColor: '#cccccc', fillOpacity: 0.5, color: 'white', weight: 1 });
        }
    });
}

async function scanOldRides() {
    if(!geoJsonLayer) return;
    if(!confirm("Start scan?")) return;
    
    const btn = document.getElementById('scan-btn');
    const loading = document.getElementById('muni-loading');
    btn.disabled = true; loading.style.display = 'block'; loading.innerText = "Bezig...";

    try {
        let activities = allActivitiesCache || await window.supabaseAuth.listActivities();
        const muniLayers = geoJsonLayer.getLayers();
        let count = 0;

        for (const act of activities) {
            count++;
            loading.innerText = `Scan: ${count}/${activities.length}`;
            const blob = await window.supabaseAuth.getActivityFile(act.id);
            const text = await blob.text();
            
            // Auto-detect TopoJSON in logic (mocht iemand handmatig uploaden)
            const foundNames = window.findMunisInGpx(text, muniLayers);
            
            if(foundNames.length > 0) {
                await window.supabaseAuth.saveConqueredMunicipalities(foundNames);
                foundNames.forEach(n => conqueredMunis.add(n));
            }
        }
        updateMuniUI();
        loading.innerText = "Klaar!";
        setTimeout(() => { loading.style.display = 'none'; btn.style.display = 'none'; }, 2000);
    } catch (e) {
        console.error(e);
        loading.innerText = "Fout: " + e.message;
        btn.disabled = false;
    }
}

window.findMunisInGpx = function(xmlString, layers) {
    if(typeof turf === 'undefined') return [];
    const found = new Set();
    const xmlDoc = new DOMParser().parseFromString(xmlString, "text/xml");
    const trkpts = xmlDoc.getElementsByTagName('trkpt');
    
    for(let i=0; i < trkpts.length; i+=50) {
        let lat = parseFloat(trkpts[i].getAttribute('lat'));
        let lon = parseFloat(trkpts[i].getAttribute('lon'));
        if(isNaN(lat)) continue;

        const turfPt = turf.point([lon, lat]);
        for (const layer of layers) {
            if (found.has(layer.muniName)) continue; 
            if (turf.booleanPointInPolygon(turfPt, layer.feature)) {
                found.add(layer.muniName);
                break; 
            }
        }
    }
    return Array.from(found);
};

window.triggerUpload = function() { switchTab('analysis'); document.getElementById('gpxInput')?.click(); };
window.switchTab = switchTab;
window.updateDashboard = updateDashboard;