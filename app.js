// app.js - Map Visualisatie, GPX Parsing & Upload Logic

let map, polyline, elevationChart;
let segmentLayer = null; 
let currentRideData = null; 
let activeSegment = null; 
let hoverMarker = null; 

document.addEventListener('DOMContentLoaded', () => {
    initMap();
    
    const gpxInput = document.getElementById('gpxInput');
    if(gpxInput) gpxInput.addEventListener('change', (e) => handleFileUpload(e));

    const saveBtn = document.getElementById('save-cloud-btn');
    if(saveBtn) saveBtn.addEventListener('click', saveToCloud);
});

function initMap() {
    const mapContainer = document.getElementById('map');
    if(!mapContainer) return;

    map = L.map('map').setView([50.85, 4.35], 7);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { 
        attribution: '© OpenStreetMap' 
    }).addTo(map);

    // Klik op de kaart wist segment-highlighting
    map.on('click', () => {
        if (typeof clearSegmentHighlight === 'function') clearSegmentHighlight();
    });
}

// --- FIX VOOR DE 'getBounds' ERROR ---
function clearSegmentHighlight() {
    activeSegment = null;
    if (segmentLayer && map) { map.removeLayer(segmentLayer); segmentLayer = null; }
    
    // VEILIGHEIDSCHECK: Alleen zoomen als polyline bestaat en op de kaart staat
    if (polyline && map.hasLayer(polyline)) {
        try {
            map.fitBounds(polyline.getBounds());
        } catch (e) {
            console.warn("Kon niet fitten op polyline bounds.");
        }
    }
    
    if(elevationChart && elevationChart.data.datasets.length > 1) { 
        elevationChart.data.datasets.pop(); 
        elevationChart.update(); 
    }
    document.querySelectorAll('.segment-card').forEach(c => c.classList.remove('active-segment'));
}

window.openRide = async function(activity) {
    try {
        if(window.switchTab) window.switchTab('analysis');
        const fileBlob = await window.supabaseAuth.getActivityFile(activity.id);
        const text = await fileBlob.text();
        processGPXAndRender(text, activity.fileName, true);
        
        const saveSection = document.getElementById('save-section');
        if(saveSection) saveSection.classList.add('hidden');
    } catch (e) {
        console.error(e);
        alert("Kon rit data niet ophalen.");
    }
};

async function handleFileUpload(e) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    if(window.switchTab) window.switchTab('analysis');
    const file = files[0];
    const text = await file.text();
    processGPXAndRender(text, file.name);
}

function processGPXAndRender(xmlString, fileName, isExistingRide = false) {
    const data = window.parseGPXData(xmlString, fileName, isExistingRide);
    if (!data) return;
    
    currentRideData = data;
    updateMap(data.uiData.latlngs);
    updateStats(data.summary.distanceKm, data.uiData.durationMs, data.summary.avgSpeed, data.summary.elevationGain);
    updateChart(data.uiData.distances, data.uiData.elevations);
    
    if(typeof updateSegmentsUI === 'function') updateSegmentsUI(data.summary.segments);
    
    document.getElementById('statsPanel')?.classList.remove('hidden');
    document.getElementById('chartsPanel')?.classList.remove('hidden');
    document.getElementById('current-segments-section')?.classList.remove('hidden');
    
    const saveSection = document.getElementById('save-section');
    if(saveSection && !isExistingRide) saveSection.classList.remove('hidden');
}

function updateMap(latlngs) {
    if (!map || !latlngs || latlngs.length === 0) return;
    if (polyline) map.removeLayer(polyline);
    if (segmentLayer) { map.removeLayer(segmentLayer); segmentLayer = null; } 

    polyline = L.polyline(latlngs, {color: '#fc4c02', weight: 4}).addTo(map);
    map.fitBounds(polyline.getBounds(), { padding: [20, 20] });
}

function updateStats(dist, timeMs, speed, ele) {
    const d = document.getElementById('statDist');
    const t = document.getElementById('statTime');
    const s = document.getElementById('statSpeed');
    const e = document.getElementById('statElev');

    if(d) d.innerText = typeof dist === 'string' ? dist : parseFloat(dist).toFixed(2);
    if(e) e.innerText = Math.round(ele);
    if(s) s.innerText = typeof speed === 'string' ? speed : parseFloat(speed).toFixed(1);
    
    if(t) {
        const h = Math.floor(timeMs / 3600000); 
        const m = Math.floor((timeMs % 3600000) / 60000);
        t.innerText = `${h}:${m.toString().padStart(2,'0')}`;
    }
}

function updateChart(labels, dataPoints) {
    const chartEl = document.getElementById('elevationChart');
    if(!chartEl) return;
    const ctx = chartEl.getContext('2d');
    const step = Math.ceil(labels.length / 500); 
    
    const filteredLabels = labels.filter((_, i) => i % step === 0);
    const filteredData = dataPoints.filter((_, i) => i % step === 0);

    if (elevationChart) elevationChart.destroy();
    
    elevationChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: filteredLabels.map(d => parseFloat(d).toFixed(1)),
            datasets: [{ 
                label: 'Hoogte', 
                data: filteredData, 
                borderColor: '#fc4c02', 
                backgroundColor: 'rgba(252,76,2,0.1)', 
                fill: true, 
                pointRadius: 0, 
                borderWidth: 2 
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            onHover: (event, chartElements) => {
                if (chartElements.length > 0) {
                    const index = chartElements[0].index;
                    showPointOnMap(index * step);
                } else {
                    hidePointOnMap();
                }
            },
            scales: { x: { display: false }, y: { display: true } }
        }
    });
}

function showPointOnMap(index) {
    if (!currentRideData || !map) return;
    const latlng = currentRideData.uiData.latlngs[index];
    if (!latlng) return;

    if (!hoverMarker) {
        hoverMarker = L.circleMarker(latlng, { radius: 6, fillColor: "#007bff", color: "#fff", weight: 2, fillOpacity: 1 }).addTo(map);
    } else {
        hoverMarker.setLatLng(latlng);
    }
}

function hidePointOnMap() {
    if (hoverMarker && map) { map.removeLayer(hoverMarker); hoverMarker = null; }
}

async function saveToCloud() {
    if (!currentRideData) return;
    const btn = document.getElementById('save-cloud-btn');
    btn.innerText = "⏳..."; btn.disabled = true;
    try {
        await window.supabaseAuth.saveActivity({
            fileBlob: new Blob([currentRideData.xmlString], {type: 'application/xml'}),
            fileName: document.getElementById('drawn-ride-name')?.value || currentRideData.fileName,
            summary: currentRideData.summary
        });
        btn.innerText = "✅"; btn.style.background = "#28a745";
        if(window.updateDashboard) window.updateDashboard();
    } catch (e) {
        console.error(e);
        btn.innerText = "Opslaan"; btn.disabled = false;
    }
}

function updateSegmentsUI(segments) {
    const list = document.getElementById('segments-list');
    if(!list) return;
    list.innerHTML = '';
    if(!segments || segments.length === 0) return;
    segments.forEach(seg => {
        const div = document.createElement('div');
        div.className = 'segment-card clickable';
        div.innerHTML = `<span><strong>${seg.distance}km</strong></span> <span>${seg.speed.toFixed(1)} km/u</span>`;
        list.appendChild(div);
    });
}