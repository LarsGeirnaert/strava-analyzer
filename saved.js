/* ========== OPGESLAGEN RITTEN FUNCTIES ========== */

async function renderSavedList() {
    if (!savedListContainer) return;
    
    const sortField = document.getElementById('sortField')?.value || "rideDate";
    const sortOrder = document.getElementById('sortOrder')?.value || "desc";

    let items = [];
    try {
        // GEBRUIK SUPABASE AUTH LIST FUNCTIE!
        if (window.supabaseAuth && window.supabaseAuth.isLoggedIn()) {
            console.log('📋 Ophalen ritten van Supabase...');
            items = await window.supabaseAuth.listActivities();
        } else {
            console.log('📋 Ophalen ritten van lokale opslag...');
            items = await listActivitiesFromDB();
        }
    } catch (err) {
        console.error("lijst ophalen mislukt:", err);
        savedListContainer.innerHTML = `
            <div class="no-saved">
                <div style="font-size: 3rem; margin-bottom: 20px; opacity: 0.5;">❌</div>
                <h4>Fout bij ophalen ritten</h4>
                <p>Er ging iets mis bij het laden van je opgeslagen ritten</p>
                <p><small>${err.message}</small></p>
            </div>
        `;
        return;
    }
    
    if (!items.length) { 
        // Toon andere berichten voor Supabase vs lokale opslag
        if (window.supabaseAuth && window.supabaseAuth.isLoggedIn()) {
            savedListContainer.innerHTML = `
                <div class="no-saved">
                    <div style="font-size: 3rem; margin-bottom: 20px; opacity: 0.5;">☁️</div>
                    <h4>Geen ritten in de cloud</h4>
                    <p>Upload en sla ritten op om ze in je cloud account te bewaren</p>
                    <p><small>Je bent ingelogd als: ${window.supabaseAuth.getCurrentUser()?.email}</small></p>
                </div>
            `;
        } else {
            savedListContainer.innerHTML = `
                <div class="no-saved">
                    <div style="font-size: 3rem; margin-bottom: 20px; opacity: 0.5;">📂</div>
                    <h4>Geen ritten opgeslagen</h4>
                    <p>Upload en sla ritten op om ze hier terug te vinden</p>
                    <p><small>Lokale browser opslag</small></p>
                </div>
            `;
        }
        return; 
    }

    // Toon opslag locatie info
    const storageInfo = window.supabaseAuth && window.supabaseAuth.isLoggedIn() 
        ? `<div style="text-align: center; margin-bottom: 20px; padding: 10px; background: rgba(37, 99, 235, 0.1); border-radius: 8px; border-left: 4px solid var(--primary-color);">
             <strong>☁️ Cloud Opslag</strong> - ${items.length} rit${items.length !== 1 ? 'ten' : ''} in je account
           </div>`
        : `<div style="text-align: center; margin-bottom: 20px; padding: 10px; background: rgba(100, 116, 139, 0.1); border-radius: 8px; border-left: 4px solid var(--text-secondary);">
             <strong>💾 Lokale Opslag</strong> - ${items.length} rit${items.length !== 1 ? 'ten' : ''} in deze browser
           </div>`;

    // Sorteer items
    items.sort((a, b) => {
        let va, vb;
        if (sortField === "rideDate") {
            va = a.summary?.rideDate ? new Date(a.summary.rideDate).getTime() : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
            vb = b.summary?.rideDate ? new Date(b.summary.rideDate).getTime() : (b.createdAt ? new Date(b.createdAt).getTime() : 0);
        } else if (sortField === "createdAt") {
            va = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            vb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        } else if (sortField === "distance") {
            va = a.summary?.distanceKm ? Number(a.summary.distanceKm) : -1;
            vb = b.summary?.distanceKm ? Number(b.summary.distanceKm) : -1;
        } else if (sortField === "elevation") {
            va = a.summary?.elevationGain ? Number(a.summary.elevationGain) : -1;
            vb = b.summary?.elevationGain ? Number(b.summary.elevationGain) : -1;
        } else {
            va = 0; vb = 0;
        }
        if (va === vb) return 0;
        const dir = (sortOrder === "asc") ? 1 : -1;
        return (va < vb) ? -1 * dir : 1 * dir;
    });

    let html = `
        ${storageInfo}
        <div class="sort-controls">
            <span>Sorteren op:</span>
            <select id="sortField">
                <option value="rideDate" ${sortField === 'rideDate' ? 'selected' : ''}>Rit Datum</option>
                <option value="createdAt" ${sortField === 'createdAt' ? 'selected' : ''}>Toegevoegd op</option>
                <option value="distance" ${sortField === 'distance' ? 'selected' : ''}>Afstand</option>
                <option value="elevation" ${sortField === 'elevation' ? 'selected' : ''}>Hoogtemeters</option>
            </select>
            <select id="sortOrder">
                <option value="desc" ${sortOrder === 'desc' ? 'selected' : ''}>Aflopend</option>
                <option value="asc" ${sortOrder === 'asc' ? 'selected' : ''}>Oplopend</option>
            </select>
        </div>
        <div class="saved-activities">
            <ul>
    `;

    items.forEach(item => {
        const distanceTxt = item.summary?.distanceKm ? `${parseFloat(item.summary.distanceKm).toFixed(1)} km` : "? km";
        const elevTxt = (item.summary && item.summary.elevationGain !== undefined) ? `${item.summary.elevationGain} m` : "—";
        const speedTxt = item.summary?.avgSpeed ? `${item.summary.avgSpeed.toFixed(1)} km/u` : "—";
        const rideDateTxt = item.summary?.rideDate ? new Date(item.summary.rideDate).toLocaleDateString('nl-NL') : "onbekend";
        const createdDateTxt = item.createdAt ? new Date(item.createdAt).toLocaleDateString('nl-NL') : "onbekend";
        
        // Toon opslag indicator
        const storageIndicator = window.supabaseAuth && window.supabaseAuth.isLoggedIn() 
            ? '<span style="font-size: 0.7rem; background: var(--primary-color); color: white; padding: 2px 6px; border-radius: 8px; margin-left: 8px;">☁️</span>'
            : '<span style="font-size: 0.7rem; background: var(--text-secondary); color: white; padding: 2px 6px; border-radius: 8px; margin-left: 8px;">💾</span>';
        
        html += `
            <li>
                <div class="activity-info">
                    <strong>${item.fileName} ${storageIndicator}</strong>
                    <div class="activity-meta">
                        <span>📏 ${distanceTxt}</span>
                        <span>⛰️ ${elevTxt}</span>
                        <span>🚀 ${speedTxt}</span>
                    </div>
                </div>
                <div class="activity-date">
                    ${sortField === 'createdAt' ? createdDateTxt : rideDateTxt}
                </div>
                <div class="activity-actions">
                    <button class="load-btn" onclick="loadSavedActivity('${item.id}')">
                        📂 Openen
                    </button>
                    <button class="download-btn" onclick="downloadSavedActivity('${item.id}')">
                        💾 Download
                    </button>
                    <button class="delete-btn" onclick="deleteSavedActivity('${item.id}')">
                        🗑️ Verwijder
                    </button>
                </div>
            </li>
        `;
    });

    html += `
            </ul>
        </div>
    `;

    savedListContainer.innerHTML = html;

    // Voeg event listeners toe
    document.getElementById('sortField').addEventListener('change', () => renderSavedList());
    document.getElementById('sortOrder').addEventListener('change', () => renderSavedList());
}

// Update ook de deleteSavedActivity functie
async function deleteSavedActivity(id) {
    if (confirm(`Weet je zeker dat je deze rit wilt verwijderen?`)) {
        try {
            // GEBRUIK SUPABASE AUTH DELETE FUNCTIE!
            if (window.supabaseAuth && window.supabaseAuth.isLoggedIn()) {
                await window.supabaseAuth.deleteActivity(id);
            } else {
                await deleteActivityFromDB(id);
            }
            await renderSavedList();
            showNotification('✅ Rit succesvol verwijderd', 'success');
        } catch (err) {
            console.error('Verwijderen mislukt:', err);
            showNotification('❌ Fout bij verwijderen: ' + err.message, 'error');
        }
    }
}

// Update ook de loadSavedActivity functie
async function loadSavedActivity(id) {
    try {
        let activity;
        // GEBRUIK SUPABASE AUTH LIST FUNCTIE om de specifieke activity te vinden
        if (window.supabaseAuth && window.supabaseAuth.isLoggedIn()) {
            const activities = await window.supabaseAuth.listActivities();
            activity = activities.find(a => a.id === id);
        } else {
            activity = await getActivityFromDB(id);
        }
        
        if (!activity) {
            throw new Error('Rit niet gevonden');
        }
        
        const text = await activity.fileBlob.text();
        await analyzeText(text, activity.fileBlob, activity.fileName);
        showNotification('✅ Rit geladen: ' + activity.fileName, 'success');
    } catch (err) {
        console.error('Laden mislukt:', err);
        showNotification('❌ Fout bij laden: ' + err.message, 'error');
    }
}

// Hulpfunctie voor notifications
function showNotification(message, type = 'info') {
    // Gebruik de notification functie van auth.js als die beschikbaar is
    if (window.supabaseAuth && window.supabaseAuth.showNotification) {
        window.supabaseAuth.showNotification(message, type);
    } else {
        // Fallback naar simple alert
        alert(message);
    }
}

// Download een opgeslagen activiteit
function downloadSavedActivity(id) {
    getActivityFromDB(id).then(activity => {
        const url = URL.createObjectURL(activity.fileBlob);
        const a = document.createElement("a"); 
        a.href = url; 
        a.download = activity.fileName; 
        a.click();
        URL.revokeObjectURL(url);
    });
}



// Initialiseer de opgeslagen tab
function initSavedTab() {
    console.log('💾 Initialiseer opgeslagen tab');
    renderSavedList();
}