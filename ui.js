// ui.js - VOLLEDIGE VERSIE (Met bugfixes)

let allActivitiesCache = null; 
let muniMap = null; 
let selectedRides = new Set(); // HIER slaan we de aangevinkte ID's op

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
            option.value = k; option.text = `${k} km`;
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
        // Reset selectie bij openen dashboard
        selectedRides.clear();
        updateDeleteButton();
        updateDashboard();
    }
    if(tabName === 'rankings') {
        const select = document.getElementById('segmentSelector');
        loadRankings(select ? select.value : 5);
    }
    if(tabName === 'municipalities') {
        setTimeout(() => { initMuniMap(); calculateConqueredMunicipalities(); }, 200);
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

    renderActivityList(activities.slice(0, 5), "📜 Recente Activiteiten");
}

window.showAllActivities = function() {
    if(allActivitiesCache) {
        renderActivityList(allActivitiesCache, "📜 Alle Activiteiten (" + allActivitiesCache.length + ")");
    }
};

// 4. LIJST RENDERING (MET VEILIGE KLIK ZONE)
function renderActivityList(activities, title) {
    const list = document.getElementById('dashboard-list');
    
    let titleElem = document.querySelector('.recent-section h3');
    if(titleElem) titleElem.innerText = title;

    list.innerHTML = ''; 

    if(activities.length === 0) {
        list.innerHTML = '<p style="padding:15px; color:#888">Nog geen ritten. Upload er eentje!</p>';
        return;
    }

    activities.forEach(act => {
        const div = document.createElement('div');
        div.className = 'dash-list-item';
        div.style.paddingLeft = "0"; 
        div.style.display = "flex";
        div.style.alignItems = "stretch";

        const date = new Date(act.summary.rideDate).toLocaleDateString('nl-NL');
        const dist = act.summary.distanceKm || '?';
        const name = act.fileName || "Naamloos"; 

        div.innerHTML = `
            <div class="checkbox-zone">
                <input type="checkbox" class="list-checkbox" value="${act.id}">
            </div>
            
            <div class="item-content" style="flex:1; display:flex; justify-content:space-between; align-items:center; padding: 15px 15px 15px 0;">
                <div>
                    <strong>${name}</strong><br>
                    <small style="color:#888">📅 ${date}</small>
                </div>
                <div style="text-align:right">
                    <strong>${dist} km</strong><br>
                    <small style="color:#888">${act.summary.avgSpeed} km/u</small>
                </div>
            </div>
        `;
        
        const checkbox = div.querySelector('.list-checkbox');
        const checkZone = div.querySelector('.checkbox-zone');
        const contentZone = div.querySelector('.item-content');

        // Klik op checkbox zone
        checkZone.addEventListener('click', (e) => {
            e.stopPropagation(); 
            toggleSelection(act.id);
            checkbox.checked = selectedRides.has(act.id);
        });
        
        if(selectedRides.has(act.id)) {
            checkbox.checked = true;
        }

        // Klik op tekst opent rit
        contentZone.onclick = () => { 
            switchTab('analysis'); 
            window.openRide(act); 
        };
        
        list.appendChild(div);
    });
}

// 5. SELECTIE LOGICA
function toggleSelection(id) {
    if(selectedRides.has(id)) {
        selectedRides.delete(id);
    } else {
        selectedRides.add(id);
    }
    updateDeleteButton();
}

function updateDeleteButton() {
    const btn = document.getElementById('delete-btn');
    const countSpan = document.getElementById('delete-count');
    
    // FIX: Check of de knop wel bestaat om error te voorkomen
    if(!btn || !countSpan) return;

    if(selectedRides.size > 0) {
        btn.classList.remove('hidden');
        countSpan.innerText = selectedRides.size;
    } else {
        btn.classList.add('hidden');
    }
}

// 6. VERWIJDER LOGICA
window.deleteSelectedRides = async function() {
    if(selectedRides.size === 0) return;

    if(!confirm(`Weet je zeker dat je ${selectedRides.size} ritten wilt verwijderen? Dit kan niet ongedaan gemaakt worden.`)) {
        return;
    }

    const btn = document.getElementById('delete-btn');
    btn.innerText = "Bezig...";
    
    try {
        const idsArray = Array.from(selectedRides);
        await window.supabaseAuth.deleteActivities(idsArray);
        
        allActivitiesCache = null;
        selectedRides.clear();
        
        btn.innerText = "🗑️ Verwijderd!";
        setTimeout(() => {
            updateDeleteButton();
            btn.innerText = "🗑️ Verwijder Selectie";
        }, 1000);

        updateDashboard();

    } catch (e) {
        console.error(e);
        alert("Fout bij verwijderen: " + e.message);
        btn.innerText = "Fout";
    }
};

// 7. RANGLIJSTEN & GEMEENTE
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
        return match ? { ...match, fileName: act.fileName, date: act.summary.rideDate, activity: act } : null;
    }).filter(i => i).sort((a, b) => b.speed - a.speed);

    list.innerHTML = '';
    if(rankedData.length === 0) { list.innerHTML = `<p style="padding:20px; text-align:center;">Geen prestaties gevonden voor ${distanceKm} km.</p>`; return; }

    rankedData.forEach((item, index) => {
        const div = document.createElement('div');
        let c = index===0?'gold':index===1?'silver':index===2?'bronze':'';
        div.className = `rank-card ${c}`;
        const t = Math.floor(item.timeMs/1000);
        div.innerHTML = `<div style="display:flex;gap:15px;"><div class="rank-pos">#${index+1}</div><div><strong>${item.fileName}</strong><br><small>${new Date(item.date).toLocaleDateString()}</small></div></div><div style="text-align:right"><div class="rank-speed">${item.speed.toFixed(1)} km/u</div></div>`;
        div.onclick = () => { switchTab('analysis'); window.openRide(item.activity); };
        list.appendChild(div);
    });
};

async function initMuniMap() {
    if (muniMap) { muniMap.invalidateSize(); return; }
    muniMap = L.map('map-municipalities').setView([50.8503, 4.3517], 8);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { attribution: '© OpenStreetMap' }).addTo(muniMap);
}

async function calculateConqueredMunicipalities() {
    const loading = document.getElementById('muni-loading');
    if(loading) { loading.innerHTML = "⚠️ Gemeente analyse tijdelijk uitgeschakeld."; loading.style.display = 'block'; }
}

// 8. HELPERS & EXPORTS (DE FIX: triggerUpload toegevoegd)
function triggerUpload() {
    switchTab('analysis');
    const input = document.getElementById('gpxInput');
    if(input) input.click();
}

window.switchTab = switchTab;
window.updateDashboard = updateDashboard;
window.triggerUpload = triggerUpload;