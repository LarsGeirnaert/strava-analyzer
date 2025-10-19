/* ========== OPGESLAGEN RITTEN FUNCTIES ========== */

// Render de lijst met opgeslagen activiteiten
async function renderSavedList() {
    if (!savedListContainer) return;
    
    const sortField = document.getElementById('sortField')?.value || "rideDate";
    const sortOrder = document.getElementById('sortOrder')?.value || "desc";

    let items = [];
    try {
        items = await listActivitiesFromDB();
    } catch (err) {
        console.error("lijst ophalen mislukt:", err);
        savedListContainer.innerHTML = `
            <div class="no-saved">
                <div style="font-size: 3rem; margin-bottom: 20px; opacity: 0.5;">❌</div>
                <h4>Fout bij ophalen ritten</h4>
                <p>Er ging iets mis bij het laden van je opgeslagen ritten</p>
            </div>
        `;
        return;
    }
    
    if (!items.length) { 
        savedListContainer.innerHTML = `
            <div class="no-saved">
                <div style="font-size: 3rem; margin-bottom: 20px; opacity: 0.5;">📂</div>
                <h4>Geen ritten opgeslagen</h4>
                <p>Upload en sla ritten op om ze hier terug te vinden</p>
            </div>
        `; 
        return; 
    }

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
        
        html += `
            <li>
                <div class="activity-info">
                    <strong>${item.fileName}</strong>
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

// Laad een opgeslagen activiteit
async function loadSavedActivity(id) {
    const activity = await getActivityFromDB(id);
    const text = await activity.fileBlob.text();
    await analyzeText(text, activity.fileBlob, activity.fileName);
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

// Verwijder een opgeslagen activiteit
async function deleteSavedActivity(id) {
    if (confirm(`Weet je zeker dat je deze rit wilt verwijderen?`)) {
        await deleteActivityFromDB(id);
        await renderSavedList();
    }
}

// Initialiseer de opgeslagen tab
function initSavedTab() {
    console.log('💾 Initialiseer opgeslagen tab');
    renderSavedList();
}