// ui.js - Regelt tabs, navigatie, dashboard en ranglijsten

let allActivitiesCache = null; // Cache om database calls te beperken

document.addEventListener('DOMContentLoaded', () => {
    setupNavigation();
    setupSegmentSelector();
});

// 1. Setup Navigatie Knoppen
function setupNavigation() {
    const navBtns = document.querySelectorAll('.nav-btn[data-target]');
    
    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            switchTab(btn.dataset.target);
        });
    });
}

// 2. Setup Segment Dropdown (5, 10, 15 ... 100 km)
function setupSegmentSelector() {
    const select = document.getElementById('segmentSelector');
    if (select) {
        select.innerHTML = ''; // Leegmaken
        
        // Loop van 5 tot 100 met stappen van 5
        for (let k = 5; k <= 100; k += 5) {
            const option = document.createElement('option');
            option.value = k;
            option.text = `${k} km`;
            select.appendChild(option);
        }
        
        // Selecteer standaard 5km
        select.value = "5";
    }
}

// 3. Wissel tussen Tabs
function switchTab(tabName) {
    // Knoppen updaten
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    const activeBtn = document.querySelector(`.nav-btn[data-target="${tabName}"]`);
    if(activeBtn) activeBtn.classList.add('active');

    // Views wisselen
    document.querySelectorAll('.view-section').forEach(v => v.classList.add('hidden'));
    document.getElementById(`view-${tabName}`).classList.remove('hidden');

    // Specifieke acties per tab
    if(tabName === 'analysis') {
        // Fix voor Leaflet kaart die grijs blijft
        setTimeout(() => { if(typeof map !== 'undefined') map.invalidateSize(); }, 100);
    }
    
    if(tabName === 'dashboard') {
        updateDashboard();
    }
    
    if(tabName === 'rankings') {
        // Laad de ranglijst op basis van de huidige dropdown waarde
        const select = document.getElementById('segmentSelector');
        const val = select ? select.value : 5;
        loadRankings(val);
    }
}

// 4. Dashboard Logica
async function updateDashboard() {
    if(!window.supabaseAuth || !window.supabaseAuth.getCurrentUser()) return;
    
    // Haal data op (uit cache of DB)
    let activities = allActivitiesCache;
    if(!activities) {
        activities = await window.supabaseAuth.listActivities();
        allActivitiesCache = activities;
    }

    let totalDist = 0, totalElev = 0;
    const list = document.getElementById('dashboard-list');
    list.innerHTML = '';

    // Bereken totalen
    activities.forEach(act => {
        totalDist += parseFloat(act.summary.distanceKm || 0);
        totalElev += parseFloat(act.summary.elevationGain || 0);
    });

    document.getElementById('total-dist').innerText = totalDist.toFixed(0) + ' km';
    document.getElementById('total-elev').innerText = totalElev.toFixed(0) + ' m';
    document.getElementById('total-rides').innerText = activities.length;

    // Toon recente ritten (max 5)
    if(activities.length === 0) {
        list.innerHTML = '<p style="padding:15px; color:#888">Nog geen ritten. Upload er eentje!</p>';
    } else {
        activities.slice(0, 5).forEach(act => {
            const div = document.createElement('div');
            div.className = 'dash-list-item';
            
            const date = new Date(act.summary.rideDate).toLocaleDateString('nl-NL');
            const dist = act.summary.distanceKm || '?';
            const speed = act.summary.avgSpeed || '?';

            div.innerHTML = `
                <div>
                    <strong>${act.fileName}</strong><br>
                    <small style="color:#888">📅 ${date}</small>
                </div>
                <div style="text-align:right">
                    <strong>${dist} km</strong><br>
                    <small style="color:#888">${speed} km/u</small>
                </div>
            `;
            
            // Klik om naar analyse te gaan
            div.onclick = () => { 
                switchTab('analysis'); 
                window.openRide(act); 
            };
            list.appendChild(div);
        });
    }
}

// 5. Ranglijst Logica
window.loadRankings = async function(distanceKm) {
    // Zorg dat het een getal is
    distanceKm = parseInt(distanceKm);
    console.log(`🔍 Start Ranglijst voor: ${distanceKm} km`);

    const list = document.getElementById('ranking-list');
    list.innerHTML = '<p style="text-align:center; color:#666;">Gegevens ophalen...</p>';

    // Data ophalen
    let activities = allActivitiesCache;
    if(!activities) {
        if(!window.supabaseAuth) return;
        activities = await window.supabaseAuth.listActivities();
        allActivitiesCache = activities;
    }

    // Filteren en Sorteren
    // We kijken in de 'summary.segments' array van elke rit
    const rankedData = activities.map(act => {
        const segments = act.summary.segments || [];
        
        // Zoek of deze rit een record heeft voor de gevraagde afstand
        const match = segments.find(s => s.distance === distanceKm);
        
        if (match) {
            return { 
                ...match, 
                fileName: act.fileName, 
                date: act.summary.rideDate, 
                activity: act 
            };
        } else {
            return null; // Rit heeft deze afstand niet gehaald
        }
    })
    .filter(item => item !== null) // Verwijder nulls
    .sort((a, b) => b.speed - a.speed); // Sorteer: Snelste bovenaan

    // Renderen
    list.innerHTML = '';
    
    if(rankedData.length === 0) {
        list.innerHTML = `
            <div style="text-align:center; padding: 30px; background: white; border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.05);">
                <div style="font-size: 3rem; margin-bottom: 10px;">📉</div>
                <p><strong>Geen prestaties gevonden voor ${distanceKm} km.</strong></p>
                <p style="font-size: 0.9rem; color: #666; margin-top:10px;">
                    Mogelijke oorzaken:<br>
                    • Je ritten zijn korter dan ${distanceKm} km.<br>
                    • Dit zijn oude ritten (upload ze opnieuw om segmenten te berekenen).
                </p>
            </div>`;
        return;
    }

    rankedData.forEach((item, index) => {
        const div = document.createElement('div');
        let rankClass = '';
        let medal = '';
        
        // Podium styling
        if(index === 0) { rankClass = 'gold'; medal = '🥇'; }
        else if(index === 1) { rankClass = 'silver'; medal = '🥈'; }
        else if(index === 2) { rankClass = 'bronze'; medal = '🥉'; }
        else { medal = `#${index + 1}`; }

        // Tijd formatteren
        const totalSeconds = Math.floor(item.timeMs / 1000);
        const h = Math.floor(totalSeconds / 3600);
        const m = Math.floor((totalSeconds % 3600) / 60);
        const s = totalSeconds % 60;
        
        const timeStr = h > 0 
            ? `${h}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}` 
            : `${m}:${s.toString().padStart(2,'0')}`;

        div.className = `rank-card ${rankClass}`;
        div.innerHTML = `
            <div style="display:flex; align-items:center; gap:15px;">
                <div class="rank-pos">${medal}</div>
                <div>
                    <strong>${item.fileName}</strong><br>
                    <small style="color:#666;">${new Date(item.date).toLocaleDateString('nl-NL')}</small>
                </div>
            </div>
            <div style="text-align:right;">
                <div class="rank-speed">${item.speed.toFixed(1)} km/u</div>
                <small style="color:#666; font-family:monospace;">${timeStr}</small>
            </div>
        `;
        
        // Klikbaar maken
        div.style.cursor = 'pointer';
        div.onclick = () => { 
            switchTab('analysis'); 
            window.openRide(item.activity); 
        };
        
        list.appendChild(div);
    });
};

// Helper: Uploadknop triggeren vanuit Dashboard
function triggerUpload() {
    switchTab('analysis');
    const input = document.getElementById('gpxInput');
    if(input) input.click();
}

// Global exports (zodat auth.js en index.html ze kunnen vinden)
window.switchTab = switchTab;
window.updateDashboard = updateDashboard;
window.triggerUpload = triggerUpload;