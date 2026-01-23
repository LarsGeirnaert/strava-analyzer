// ui.js - Dashboard, Tabs, Ranglijsten en Weergave

let allActivitiesCache = null; 
let muniMap = null; 
let geoJsonLayer = null;
let conqueredMunis = new Set();

document.addEventListener('DOMContentLoaded', () => {
    setupNavigation();
    setupSegmentSelector();
});

// 1. SETUP NAVIGATIE
function setupNavigation() {
    const navBtns = document.querySelectorAll('.nav-btn[data-target]');
    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            switchTab(btn.dataset.target);
        });
    });
}

function setupSegmentSelector() {
    const select = document.getElementById('segmentSelector');
    if (select) {
        select.innerHTML = ''; 
        for (let k = 5; k <= 100; k += 5) {
            const option = document.createElement('option');
            option.value = k;
            option.text = `${k} km`;
            select.appendChild(option);
        }
        select.value = "5";
    }
}

// 2. TAB SWITCHER
function switchTab(tabName) {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    const activeBtn = document.querySelector(`.nav-btn[data-target="${tabName}"]`);
    if(activeBtn) activeBtn.classList.add('active');

    document.querySelectorAll('.view-section').forEach(v => v.classList.add('hidden'));
    document.getElementById(`view-${tabName}`).classList.remove('hidden');

    if(tabName === 'analysis') {
        setTimeout(() => { if(typeof map !== 'undefined') map.invalidateSize(); }, 100);
    }
    
    if(tabName === 'dashboard') {
        updateDashboard();
    }
    
    if(tabName === 'rankings') {
        const select = document.getElementById('segmentSelector');
        const val = select ? select.value : 5;
        loadRankings(val);
    }
    
    if(tabName === 'municipalities') {
        setTimeout(() => {
            initMuniMap(); 
            calculateConqueredMunicipalities();
        }, 200);
    }
}

// 3. DASHBOARD LOGICA
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

    // Standaard: Toon top 5
    renderActivityList(activities.slice(0, 5), "📜 Recente Activiteiten");
}

// Wordt aangeroepen door klik op "Aantal Ritten" kaart
window.showAllActivities = function() {
    if(allActivitiesCache) {
        renderActivityList(allActivitiesCache, "📜 Alle Activiteiten (" + allActivitiesCache.length + ")");
    }
};

// Helper om de lijst te tekenen
function renderActivityList(activities, title) {
    const list = document.getElementById('dashboard-list');
    
    // Update titel
    let titleElem = document.querySelector('.recent-section h3');
    if(titleElem) titleElem.innerText = title;

    list.innerHTML = ''; // Leegmaken

    if(activities.length === 0) {
        list.innerHTML = '<p style="padding:15px; color:#888">Nog geen ritten. Upload er eentje!</p>';
        return;
    }

    activities.forEach(act => {
        const div = document.createElement('div');
        div.className = 'dash-list-item';
        
        const date = new Date(act.summary.rideDate).toLocaleDateString('nl-NL');
        const dist = act.summary.distanceKm || '?';
        const speed = act.summary.avgSpeed || '?';
        const name = act.fileName || "Naamloos"; // Gebruikt de gefixte fileName

        div.innerHTML = `
            <div>
                <strong>${name}</strong><br>
                <small style="color:#888">📅 ${date}</small>
            </div>
            <div style="text-align:right">
                <strong>${dist} km</strong><br>
                <small style="color:#888">${speed} km/u</small>
            </div>
        `;
        
        div.onclick = () => { 
            switchTab('analysis'); 
            window.openRide(act); 
        };
        list.appendChild(div);
    });
}

// 4. RANGLIJST LOGICA
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

    // Filteren
    const rankedData = activities.map(act => {
        const segments = act.summary.segments || [];
        const match = segments.find(s => s.distance === distanceKm);
        return match ? { ...match, fileName: act.fileName, date: act.summary.rideDate, activity: act } : null;
    })
    .filter(item => item !== null)
    .sort((a, b) => b.speed - a.speed);

    list.innerHTML = '';
    
    if(rankedData.length === 0) {
        list.innerHTML = `<p style="padding:20px; text-align:center;">Geen prestaties gevonden voor ${distanceKm} km.</p>`;
        return;
    }

    rankedData.forEach((item, index) => {
        const div = document.createElement('div');
        let rankClass = index === 0 ? 'gold' : index === 1 ? 'silver' : index === 2 ? 'bronze' : '';
        let medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index + 1}`;
        
        const t = Math.floor(item.timeMs / 1000);
        const timeStr = `${Math.floor(t/3600)}:${Math.floor((t%3600)/60).toString().padStart(2,'0')}:${(t%60).toString().padStart(2,'0')}`;

        div.className = `rank-card ${rankClass}`;
        div.innerHTML = `
            <div style="display:flex; align-items:center; gap:15px;">
                <div class="rank-pos">${medal}</div>
                <div>
                    <strong>${item.fileName}</strong><br>
                    <small style="color:#666">${new Date(item.date).toLocaleDateString('nl-NL')}</small>
                </div>
            </div>
            <div style="text-align:right;">
                <div class="rank-speed">${item.speed.toFixed(1)} km/u</div>
                <small style="color:#666; font-family:monospace;">${timeStr}</small>
            </div>
        `;
        div.style.cursor = 'pointer';
        div.onclick = () => { switchTab('analysis'); window.openRide(item.activity); };
        list.appendChild(div);
    });
};

// 5. GEMEENTE JAGER (VEILIGE MODUS)
async function initMuniMap() {
    if (muniMap) { muniMap.invalidateSize(); return; }
    muniMap = L.map('map-municipalities').setView([50.8503, 4.3517], 8);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { attribution: '© OpenStreetMap' }).addTo(muniMap);
}

async function calculateConqueredMunicipalities() {
    // We hebben de "Lazy Loading" update gedaan.
    // Dit betekent dat we niet meer zomaar alle bestanden hebben om te analyseren.
    // Om crashes te voorkomen, tonen we nu een melding.
    const loading = document.getElementById('muni-loading');
    if(loading) {
        loading.innerHTML = "⚠️ Gemeente analyse vereist server-aanpassing (wegens grote hoeveelheid data).";
        loading.style.display = 'block';
    }
}

// Exports
window.switchTab = switchTab;
window.updateDashboard = updateDashboard;
window.triggerUpload = triggerUpload;