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
        if(tabName === 'municipalities') {
            initMuniMap(); 
            // Forceer refresh van de gekozen modus
            setWorldMode(currentWorldMode);
        }
    }, 150);

    if(tabName === 'dashboard') updateDashboard();
    if(tabName === 'recap') updateRecapView();
    if(tabName === 'rankings') loadRankings();
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

// --- VERVANG DEZE FUNCTIES IN UI.JS ---

// --- VERVANG DEZE FUNCTIE IN UI.JS ---

async function updateDashboard() {
    if(!window.supabaseAuth.getCurrentUser()) return;
    
    // 1. Data ophalen
    allActivitiesCache = await window.supabaseAuth.listActivities();
    
    // Filter routes eruit voor de stats
    const realRides = allActivitiesCache.filter(a => a.summary.type !== 'route');

    // 2. Basis Statistieken
    let d=0, e=0; 
    realRides.forEach(a => { 
        d += parseFloat(a.summary.distanceKm||0); 
        e += parseFloat(a.summary.elevationGain||0); 
    });
    
    // Animeer de getallen
    animateValue("total-dist", 0, d, 1000, " km");
    animateValue("total-elev", 0, e, 1000, " m");
    document.getElementById('total-rides').innerText = realRides.length;

    // --- NIEUW: EXPLORER TILES BEREKENING ---
    // We gebruiken de heatmap cache omdat we daar de coördinaten al hebben.
    // Dit voorkomt dat we alle bestanden opnieuw moeten downloaden.
    const user = window.supabaseAuth.getCurrentUser();
    const cacheKey = `heatmap_coords_${user.id}`;
    const heatmapCache = JSON.parse(localStorage.getItem(cacheKey) || "{}");
    
    const uniqueTiles = new Set();
    
    // Loop door alle opgeslagen ritten in de cache
    Object.values(heatmapCache).forEach(points => {
        points.forEach(p => {
            // Afronden op 2 decimalen maakt vakjes van ongeveer 1km x 1km
            const lat = p[0].toFixed(2);
            const lon = p[1].toFixed(2);
            uniqueTiles.add(`${lat},${lon}`);
        });
    });

    // Update de teller in de HTML (als het element bestaat)
    if(document.getElementById('total-tiles')) {
        animateValue("total-tiles", 0, uniqueTiles.size, 1000, "");
    }
    // ----------------------------------------

    // 3. Welkomstboodschap & Quote
    const hour = new Date().getHours();
    let greeting = "Goedenacht";
    if (hour >= 6 && hour < 12) greeting = "Goedemorgen";
    else if (hour >= 12 && hour < 18) greeting = "Goedemiddag";
    else if (hour >= 18) greeting = "Goedenavond";
    
    const userEmail = window.supabaseAuth.getCurrentUser().email.split('@')[0];
    const name = userEmail.charAt(0).toUpperCase() + userEmail.slice(1);
    
    document.getElementById('welcome-msg').innerText = `${greeting}, ${name}! 👋`;
    
    const quotes = [
        "Pijn is fijn, je moet alleen even de knop omzetten.",
        "Het gaat niet om de snelheid, maar om de glimlach.",
        "Wind tegen bouwt karakter.",
        "Elke kilometer telt.",
        "Blijf trappen, de top is dichtbij!",
        "Ketting rechts en gaan!"
    ];
    document.getElementById('quote-msg').innerText = `"${quotes[Math.floor(Math.random() * quotes.length)]}"`;

    // 4. Streak Berekening
    const streak = calculateWeeklyStreak(realRides);
    document.getElementById('streak-count').innerText = streak;

    // 5. Badges & Lijst
    renderBadges(d, e, realRides);
    renderActivityList(realRides.slice(0, 5));
}

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

// Genereert badges op basis van prestaties
function renderBadges(totalDist, totalElev, activities) {
    const container = document.getElementById('badges-container');
    const badges = [];

    // Afstand Badges
    if (totalDist >= 100) badges.push({icon: '🥉', name: '100 km Club', desc: 'Je eerste mijlpaal!'});
    if (totalDist >= 500) badges.push({icon: '🥈', name: '500 km Club', desc: 'Halverwege de 1000!'});
    if (totalDist >= 1000) badges.push({icon: '🥇', name: '1000 km Club', desc: 'Serieuze fietser!'});
    if (totalDist >= 5000) badges.push({icon: '🚀', name: 'Wereldreiziger', desc: '5000 km aangetikt!'});

    // Hoogte Badges
    if (totalElev >= 1000) badges.push({icon: '⛰️', name: 'Klimmer', desc: '1000m geklommen'});
    if (totalElev >= 8848) badges.push({icon: '🏔️', name: 'Everesting', desc: 'Hoogte van Mt. Everest'});

    // Rit Specifiek
    const maxSpeed = Math.max(...activities.map(a => parseFloat(a.summary.avgSpeed) || 0));
    if (maxSpeed > 30) badges.push({icon: '⚡', name: 'Speed Demon', desc: 'Gemiddeld > 30 km/u gereden'});
    
    const maxDist = Math.max(...activities.map(a => parseFloat(a.summary.distanceKm) || 0));
    if (maxDist > 100) badges.push({icon: '💯', name: 'Gran Fondo', desc: 'Een rit van 100+ km'});

    // Tijdrijder (Vroege vogels)
    const earlyBird = activities.some(a => new Date(a.summary.rideDate).getHours() < 7);
    if (earlyBird) badges.push({icon: '🌅', name: 'Vroege Vogel', desc: 'Rit gestart voor 07:00'});

    // Render
    if (badges.length === 0) {
        container.innerHTML = '<span style="color:var(--text-muted);">Fiets meer om badges te verdienen!</span>';
    } else {
        container.innerHTML = badges.map(b => `
            <div class="badge-item" title="${b.desc}">
                <div class="badge-icon">${b.icon}</div>
                <div class="badge-name">${b.name}</div>
            </div>
        `).join('');
    }
}

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

// --- VERVANG DEZE FUNCTIES IN UI.JS ---

async function updateRecapView() {
    if(!allActivitiesCache) allActivitiesCache = await window.supabaseAuth.listActivities();
    
    const selMonth = document.getElementById('recap-month-select').value;
    const selYear = parseInt(document.getElementById('recap-year-select').value);
    
    // FILTER
    const filtered = allActivitiesCache.filter(act => {
        if (act.summary.type === 'route') return false; 
        const d = new Date(act.summary.rideDate);
        return d.getFullYear() === selYear && (selMonth === 'all' || d.getMonth() === parseInt(selMonth));
    });

    // BASIS TOTALEN
    let d=0, e=0, s=0;
    // EXTRA: Records bijhouden
    let maxDist = 0, maxElev = 0, maxSpeed = 0;

    filtered.forEach(act => { 
        const dist = parseFloat(act.summary.distanceKm);
        const elev = parseFloat(act.summary.elevationGain);
        const spd = parseFloat(act.summary.avgSpeed);

        d += dist; 
        e += elev; 
        s += spd; 

        if(dist > maxDist) maxDist = dist;
        if(elev > maxElev) maxElev = elev;
        if(spd > maxSpeed) maxSpeed = spd;
    });

    const avgS = filtered.length > 0 ? (s / filtered.length).toFixed(1) : 0;
    
    // UPDATE DOM
    let title = selMonth === 'all' ? `Jaaroverzicht ${selYear}` : `${document.getElementById('recap-month-select').options[document.getElementById('recap-month-select').selectedIndex].text} ${selYear}`;
    document.getElementById('recap-period-title').innerText = title;
    
    document.getElementById('recap-dist').innerText = d.toFixed(0) + ' km';
    document.getElementById('recap-elev').innerText = e.toFixed(0);
    document.getElementById('recap-count').innerText = filtered.length;
    
    // Nieuwe Records Vullen
    document.getElementById('recap-longest').innerText = maxDist.toFixed(1) + ' km';
    document.getElementById('recap-highest').innerText = maxElev.toFixed(0) + ' m';
    document.getElementById('recap-fastest').innerText = maxSpeed.toFixed(1) + ' km/u';

    // DOELEN
    const goalKey = selMonth === 'all' ? `goal_${selYear}` : `goal_${selYear}_${selMonth}`;
    const defaultGoal = selMonth === 'all' ? 5000 : 400;
    const targetKm = parseFloat(localStorage.getItem(goalKey) || defaultGoal);
    
    document.getElementById('recap-goal-val').innerText = targetKm;
    document.getElementById('recap-goal-label').innerText = selMonth === 'all' ? "Jaardoel" : "Maanddoel";
    
    const goalPercent = Math.min(100, (d / targetKm) * 100).toFixed(1);
    document.getElementById('recap-goal-percent').innerText = goalPercent + '%';
    document.getElementById('recap-goal-fill').style.width = goalPercent + '%';

    // GRAFIEKEN
    renderRecapChart(filtered, selMonth, selYear);
    renderDistributionChart(filtered); // NIEUW: Taartdiagram

    // LIJST (Top 5 nu)
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

function renderRecapChart(activities, monthMode, year) {
    const ctx = document.getElementById('recapComparisonChart').getContext('2d');
    if (activeCharts['recap']) activeCharts['recap'].destroy();

    let labels = [], dataPoints = [], labelText = "", chartType = 'bar';

    if (monthMode === 'all') {
        labelText = `Afstand per maand (${year})`;
        labels = ['Jan', 'Feb', 'Mrt', 'Apr', 'Mei', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec'];
        dataPoints = new Array(12).fill(0);
        activities.forEach(act => {
            const m = new Date(act.summary.rideDate).getMonth();
            dataPoints[m] += parseFloat(act.summary.distanceKm);
        });
    } else {
        labelText = `Afstand per dag`;
        chartType = 'line';
        activities.sort((a,b) => new Date(a.summary.rideDate) - new Date(b.summary.rideDate));
        const daysInMonth = new Date(year, parseInt(monthMode) + 1, 0).getDate();
        labels = Array.from({length: daysInMonth}, (_, i) => i + 1);
        dataPoints = new Array(daysInMonth).fill(0);
        activities.forEach(act => {
            const d = new Date(act.summary.rideDate).getDate();
            dataPoints[d-1] += parseFloat(act.summary.distanceKm);
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
                fill: monthMode !== 'all'
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


window.loadRankings = async function(distArg) {
    if(!allActivitiesCache) allActivitiesCache = await window.supabaseAuth.listActivities();

    // 1. HAAL HUIDIGE WAARDEN OP
    const selector = document.getElementById('segmentSelector');
    const selectedDist = distArg || (selector ? selector.value : "5");
    
    const maxElev = parseFloat(document.getElementById('segmentMaxElev').value) || 99999;
    const trendFilter = document.getElementById('segmentTrendFilter').value; // Alleen nog Trend filter
    const targetDist = parseInt(selectedDist);

    // 2. DATA VERZAMELEN
    let baseData = allActivitiesCache
        .filter(act => act.summary.type !== 'route')
        .map(act => {
            const seg = (act.summary.segments || []).find(s => s.distance === targetDist);
            if (seg) {
                return {
                    activity: act,
                    speed: seg.speed,
                    timeMs: seg.timeMs,
                    elev: act.summary.elevationGain,
                    date: new Date(act.summary.rideDate)
                };
            }
            return null;
        })
        .filter(item => item && item.elev <= maxElev);

    // --- DEEL A: DE GRAFIEK (Chronologisch & Laatste X) ---
    let graphData = [...baseData].sort((a,b) => a.date - b.date); // Oud -> Nieuw

    if (trendFilter !== 'all') {
        const limit = parseInt(trendFilter);
        graphData = graphData.slice(-limit); // Pak laatste X
    }

    if(graphData.length > 0) {
        document.getElementById('segment-progression-container').style.display = 'block';
        
        const speeds = graphData.map(i => i.speed);
        const labels = graphData.map(i => i.date.toLocaleDateString());
        const trend = calculateTrendLine(speeds);

        const ctx = document.getElementById('segmentProgressionChart').getContext('2d');
        if(activeCharts['segChart']) activeCharts['segChart'].destroy();
        
        activeCharts['segChart'] = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Snelheid (km/u)', 
                        data: speeds, 
                        borderColor: '#28a745', 
                        backgroundColor: 'rgba(40, 167, 69, 0.1)',
                        fill: true, tension: 0.3, pointRadius: 5, pointHoverRadius: 7
                    }, 
                    {
                        label: 'Trend', 
                        data: trend, 
                        borderColor: '#fc4c02', 
                        borderDash: [5,5], 
                        pointRadius: 0, fill: false
                    }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { tooltip: { callbacks: { afterLabel: (c) => graphData[c.dataIndex].activity.fileName } } },
                scales: { y: { title: { display: true, text: 'Km/u' } } }
            }
        });
    } else {
        document.getElementById('segment-progression-container').style.display = 'none';
    }

    // --- DEEL B: DE LIJST (Snelste Eerst - ALLES tonen) ---
    // We tonen gewoon de hele lijst, gesorteerd op snelheid.
    let listData = [...baseData].sort((a,b) => b.speed - a.speed);

    const listEl = document.getElementById('ranking-list');
    if (listData.length === 0) {
        listEl.innerHTML = '<p style="text-align:center; color:var(--text-muted); padding:20px;">Geen segmenten gevonden.</p>';
    } else {
        listEl.innerHTML = listData.map((item, i) => {
            const medal = i===0 ? '🥇' : i===1 ? '🥈' : i===2 ? '🥉' : `#${i+1}`;
            const borderStyle = i===0 ? 'border-left: 4px solid gold;' : i===1 ? 'border-left: 4px solid silver;' : i===2 ? 'border-left: 4px solid #cd7f32;' : 'border-left: 4px solid transparent;';
            
            return `
            <div class="rank-card" style="${borderStyle}" onclick="switchTab('analysis'); window.openRide(${JSON.stringify(item.activity).replace(/"/g, '&quot;')})">
                <div style="display:flex; align-items:center; gap:10px;">
                    <span style="font-size:1.2rem; font-weight:bold; width:40px;">${medal}</span>
                    <div style="overflow:hidden;">
                        <strong style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; display:block;">${item.activity.fileName}</strong>
                        <small>${item.date.toLocaleDateString()} • ⛰️ ${item.elev}m</small>
                    </div>
                </div>
                <div style="text-align:right; min-width:80px;">
                    <strong style="font-size:1.1rem; color:var(--primary);">${item.speed.toFixed(1)} km/u</strong>
                </div>
            </div>`;
        }).join('');
    }
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