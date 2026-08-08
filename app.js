// app.js - Map Visualisatie, GPX Parsing & Upload Logic

let map, polyline, elevationChart;
let segmentLayer = null;
let currentRideData = null;
let activeSegment = null;
let hoverMarker = null;
Chart.defaults.color = '#F9FAFB';

document.addEventListener('DOMContentLoaded', () => {
    initMap();

    const gpxInput = document.getElementById('gpxInput');
    if(gpxInput) gpxInput.addEventListener('change', (e) => handleFileUpload(e));

    const folderInput = document.getElementById('folderInput');
    if(folderInput) folderInput.addEventListener('change', (e) => handleFolderUpload(e));

    const saveBtn = document.getElementById('save-cloud-btn');
    if(saveBtn) saveBtn.addEventListener('click', saveToCloud);
});

function initMap() {
    const mapContainer = document.getElementById('map');
    if(!mapContainer) return;
    map = L.map('map').setView([50.85, 4.35], 7);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(map);
    map.on('click', () => { if (typeof clearSegmentHighlight === 'function') clearSegmentHighlight(); });
}

window.openRide = async function(activity) {
    try {
        if(window.switchTab) window.switchTab('analysis');

        const sumDash = document.getElementById('ride-summary-dashboard');
        const mapView = document.getElementById('ride-map-view');

        if(sumDash) sumDash.classList.remove('hidden');
        if(mapView) mapView.classList.add('hidden');

        // --- DE FIX: LAADSCHERM ---
        // 1. We zetten direct de titel, maar we maken de statistieken leeg met een laad-animatie
        document.getElementById('sum-title').innerText = activity.fileName || "Rit laden...";
        document.getElementById('sum-date').innerText = "Gegevens berekenen...";
        
        const loaderHtml = `<span class="skeleton skeleton-val" style="width: 60px; height: 24px; display: inline-block;"></span>`;
        document.getElementById('sum-dist').innerHTML = loaderHtml;
        document.getElementById('sum-time').innerHTML = loaderHtml;
        document.getElementById('sum-avg').innerHTML = loaderHtml;
        document.getElementById('sum-max').innerHTML = loaderHtml;
        document.getElementById('sum-elev').innerHTML = loaderHtml;
        document.getElementById('sum-power').innerHTML = loaderHtml;
        document.getElementById('sum-badges').innerHTML = '';
        document.getElementById('sum-segments').innerHTML = '<p class="sub-text">Segmenten berekenen...</p>';

        // 2. Haal de ruwe GPX file op uit de cloud
        const fileBlob = await window.supabaseAuth.getActivityFile(activity.id);
        const text = await fileBlob.text();
        
        // 3. Verwerk data en teken kaart (hier wordt de échte beweegtijd berekend)
        processGPXAndRender(text, activity.fileName, true, activity.summary);

        // 4. Update de summary met de juiste gegevens en auto-fix de database
        if (currentRideData && currentRideData.summary) {
            const dbTime = activity.summary.durationSec || 0;
            const realTime = currentRideData.summary.durationSec || 0;
            
            activity.summary = currentRideData.summary;
            
            if (Math.abs(dbTime - realTime) > 60) {
                window.supabaseAuth.updateActivitySummary(activity.id, currentRideData.summary).catch(e => console.warn("Auto-fix mislukt:", e));
                
                if (allActivitiesCache) {
                    const cacheIdx = allActivitiesCache.findIndex(a => a.id === activity.id);
                    if(cacheIdx !== -1) allActivitiesCache[cacheIdx].summary = currentRideData.summary;
                }
            }
        }

        // 5. Vul nu pas écht de UI in met de 100% correcte cijfers (geen geflikker meer!)
        if(window.populateRideSummary) window.populateRideSummary(activity);

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
    
    // Ga direct naar de analyse tab
    if(window.switchTab) window.switchTab('analysis');
    
    const file = files[0];
    
    try {
        const text = await file.text();
        
        // Verwerk de GPX direct, ZONDER worker (isExistingRide = false)
        processGPXAndRender(text, file.name, false);
        
        // Gooi de input leeg, zodat je hetzelfde bestand hierna nog eens kan selecteren
        e.target.value = '';
        
        if (window.showToast) window.showToast("Rit succesvol geüpload!", "success");
    } catch (error) {
        console.error("Fout bij het verwerken van de GPX:", error);
        if (window.showToast) window.showToast("Fout bij het laden van het bestand.", "error");
    }
}

async function handleFolderUpload(e) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const progressEl = document.getElementById('upload-progress');
    if(progressEl) progressEl.style.display = 'block';

    const CUTOFF_DATE = new Date('2024-01-01T00:00:00').getTime();
    let processed = 0; let uploaded = 0; let skipped = 0;

    if(window.switchTab) window.switchTab('analysis');
    console.log(`Start verwerken van ${files.length} bestanden...`);

    for (const file of files) {
        if (!file.name.toLowerCase().endsWith('.gpx')) continue;
        try {
            if(progressEl) progressEl.innerText = `Checken: ${file.name} (${processed}/${files.length})`;
            const text = await file.text();
            const timeMatch = text.match(/<time>(.*?)<\/time>/);

            if (timeMatch && timeMatch[1]) {
                const rideDate = new Date(timeMatch[1]).getTime();
                if (rideDate > CUTOFF_DATE) {
                    const data = parseGPXData(text, file.name);
                    if (data) {
                        await window.supabaseAuth.saveActivity({
                            fileBlob: new Blob([text], {type: 'application/xml'}),
                            fileName: data.fileName,
                            summary: data.summary
                        });
                        console.log(`Geüpload: ${file.name}`);
                        uploaded++;
                    }
                } else {
                    console.log(`Overgeslagen (Te oud): ${file.name}`);
                    skipped++;
                }
            }
        } catch (err) { console.error(`Fout bij ${file.name}:`, err); }
        processed++;
    }

    if(progressEl) progressEl.innerText = `Klaar! ${uploaded} geüpload, ${skipped} overgeslagen.`;
    alert(`Batch klaar!\n- ${uploaded} nieuwe ritten toegevoegd.\n- ${skipped} ritten van voor 2024 genegeerd.`);
    if(window.updateDashboard) window.updateDashboard();
    document.getElementById('folderInput').value = '';
}

function processGPXAndRender(xmlString, fileName, isExistingRide = false, existingSummary = null) {
    const data = parseGPXData(xmlString, fileName, isExistingRide);
    if (!data) return;
    currentRideData = data;
    updateMap(data.uiData.latlngs);

    const avgPower = data.uiData.powers.length > 0
        ? Math.round(data.uiData.powers.reduce((a,b)=>a+b,0) / data.uiData.powers.length)
        : 0;

    const displayMaxSpeed = (existingSummary && existingSummary.maxSpeed)
        ? existingSummary.maxSpeed
        : data.summary.maxSpeed;

    updateStats(
        data.summary.distanceKm,
        data.uiData.durationMs,
        data.summary.avgSpeed,
        data.summary.elevationGain,
        avgPower,
        displayMaxSpeed
    );

    updateChart(data.uiData.distances, data.uiData.elevations, data.uiData.speeds, data.uiData.powers);

    if(typeof updateSegmentsUI === 'function') updateSegmentsUI(data.summary.segments);

    document.getElementById('statsPanel')?.classList.remove('hidden');
    document.getElementById('chartsPanel')?.classList.remove('hidden');
    document.getElementById('current-segments-section')?.classList.remove('hidden');
    
    // --- START VAN DE FIX ---
    const saveSection = document.getElementById('save-section');
    if (saveSection) {
        if (!isExistingRide) {
            // Het is een nieuwe upload, toon de knop!
            saveSection.classList.remove('hidden');
            
            // Haal de knop op en reset hem volledig
            const saveBtn = document.getElementById('save-cloud-btn');
            if (saveBtn) {
                saveBtn.innerText = "Rit Opslaan";          // Reset tekst
                saveBtn.disabled = false;                   // Maak weer klikbaar
                saveBtn.classList.remove('btn-success');    // Haal de 'succes' kleur weg
                saveBtn.classList.add('btn-primary');       // Zet de standaard kleur terug
            }
        } else {
            // Het is een bestaande rit uit de cloud, verberg de opslaan knop
            saveSection.classList.add('hidden');
        }
    }
    // --- EINDE VAN DE FIX ---
}

function updateStats(dist, timeMs, speed, ele, power, maxSpeed) {
    const d = document.getElementById('statDist');
    const t = document.getElementById('statTime');
    const s = document.getElementById('statSpeed');
    const e = document.getElementById('statElev');
    const p = document.getElementById('statPower');
    const ms = document.getElementById('statMaxSpeed');

    if(d) d.innerText = typeof dist === 'string' ? dist : parseFloat(dist).toFixed(2);
    if(e) e.innerText = Math.round(ele);
    if(s) s.innerText = typeof speed === 'string' ? speed : parseFloat(speed).toFixed(1);
    if(ms) ms.innerText = maxSpeed ? parseFloat(maxSpeed).toFixed(1) : "0.0";
    if(t) { const h = Math.floor(timeMs / 3600000); const m = Math.floor((timeMs % 3600000) / 60000); t.innerText = `${h}:${m.toString().padStart(2,'0')}`; }
    if(p) p.innerText = power || 0;
}

function removeSpikes(data) {
    const clean = [...data];
    const threshold = 15;
    for (let i = 1; i < clean.length - 1; i++) {
        const prev = clean[i-1];
        const curr = clean[i];
        const next = clean[i+1];
        if (curr > 20 && curr > prev + threshold && curr > next + threshold) {
            clean[i] = (prev + next) / 2;
        }
    }
    return clean;
}

function applyMedianFilter(data, windowSize) {
    const result = [];
    const half = Math.floor(windowSize / 2);
    for(let i = 0; i < data.length; i++) {
        let start = Math.max(0, i - half);
        let end = Math.min(data.length, i + half + 1);
        const slice = data.slice(start, end).filter(v => !isNaN(v));
        if (slice.length === 0) { result.push(0); continue; }
        slice.sort((a, b) => a - b);
        const mid = Math.floor(slice.length / 2);
        result.push(slice[mid]);
    }
    return result;
}

function smoothArray(data, windowSize) {
    return data.map((val, idx, arr) => {
        if (val === undefined || val === null || isNaN(val)) return 0;
        let start = Math.max(0, idx - windowSize);
        let end = Math.min(arr.length, idx + windowSize + 1);
        let sum = 0, count = 0;
        for(let k = start; k < end; k++) {
            if(!isNaN(arr[k])) { sum += arr[k]; count++; }
        }
        return count > 0 ? sum / count : 0;
    });
}

function parseGPXData(xmlString, fileName, isExistingRide = false) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlString, "text/xml");

    let displayName = fileName;
    if (!isExistingRide) {
        const nameTags = xmlDoc.getElementsByTagName('name');
        if (nameTags.length > 0) displayName = nameTags[0].textContent.trim();
    }

    let trkpts = xmlDoc.getElementsByTagName('trkpt');
    if (trkpts.length === 0) trkpts = xmlDoc.getElementsByTagName('Trackpoint');
    if (trkpts.length === 0) trkpts = xmlDoc.getElementsByTagName('rtept');
    if (trkpts.length === 0) return null;

    const latlngs = [], elevations = [], distances = [], times = [];
    let rawSpeeds = [], rawPowers = [];
    let totalDist = 0, elevationGain = 0;
    let startTime = null, endTime = null;
    
    // NIEUW: Teller voor de tijd dat je écht fietst
    let movingTimeMs = 0; 

    const riderWeight = 75; const bikeWeight = 9; const totalWeight = riderWeight + bikeWeight;

    for (let i = 0; i < trkpts.length; i++) {
        let lat = parseFloat(trkpts[i].getAttribute('lat'));
        let lon = parseFloat(trkpts[i].getAttribute('lon'));
        let ele = parseFloat(trkpts[i].getElementsByTagName('ele')[0]?.textContent || 0);
        let timeStr = trkpts[i].getElementsByTagName('time')[0]?.textContent;

        if (!isNaN(lat) && !isNaN(lon)) {
            const t = new Date(timeStr || new Date().getTime() + i*1000);
            latlngs.push([lat, lon]); elevations.push(ele); times.push(t);

            let currentSpeed = 0;
            let currentPower = 0;

            if(i === 0) {
                startTime = t;
                rawSpeeds.push(0); rawPowers.push(0);
            } else {
                const prevLat = latlngs[i-1][0]; const prevLon = latlngs[i-1][1];
                const distDiff = getDistanceFromLatLonInKm(prevLat, prevLon, lat, lon);
                totalDist += distDiff;

                const prevEle = elevations[i-1];
                const eleDiff = ele - prevEle;
                if (eleDiff > 0) elevationGain += eleDiff;

                const timeDiffMs = t - times[i-1];
                const timeDiffHours = timeDiffMs / 3600000;

                if (timeDiffHours > 0.0000001 && distDiff > 0) {
                    currentSpeed = distDiff / timeDiffHours;
                }

                if(currentSpeed > 100 || isNaN(currentSpeed)) {
                    currentSpeed = rawSpeeds[i-1] || 0;
                }

                // NIEUW: Als je sneller gaat dan 2 km/u, tel de tijd dan op bij de beweegtijd
                if (currentSpeed > 2.0) {
                    movingTimeMs += timeDiffMs;
                }

                const v = currentSpeed / 3.6;
                const grade = (distDiff * 1000) > 0 ? eleDiff / (distDiff * 1000) : 0;
                if (v > 1) {
                    const pRolling = 9.8 * totalWeight * v * 0.005;
                    const pGravity = 9.8 * totalWeight * v * grade;
                    const pDrag = 0.5 * 1.225 * 0.4 * v * v * v;
                    currentPower = Math.max(0, pRolling + pGravity + pDrag);
                }
                rawSpeeds.push(currentSpeed);
                rawPowers.push(currentPower);
            }
            endTime = t;
            distances.push(totalDist);
        }
    }

    const cleanSpeeds = applyMedianFilter(rawSpeeds, 5);
    const smoothSpeeds = smoothArray(cleanSpeeds, 4);
    const smoothPowers = smoothArray(rawPowers, 6);

    let rideMaxSpeed = 0;
    if (smoothSpeeds.length > 0) {
        const validSpeeds = smoothSpeeds.filter(s => !isNaN(s) && s < 85);
        if (validSpeeds.length > 0) {
            rideMaxSpeed = Math.max(...validSpeeds);
        }
    }

    const segments = calculateFastestSegments(distances, times);
    
    // AANGEPAST: Gebruik nu movingTimeMs voor de gemiddelde snelheid!
    const movingHours = movingTimeMs / 3600000;
    const avgSpeed = movingHours > 0 ? totalDist / movingHours : 0;

    return {
        xmlString: xmlString,
        fileName: displayName,
        summary: {
            distanceKm: totalDist.toFixed(2),
            elevationGain: Math.round(elevationGain),
            avgSpeed: avgSpeed.toFixed(1), // Dit klopt nu veel beter!
            maxSpeed: parseFloat(rideMaxSpeed.toFixed(1)),
            durationSec: movingTimeMs / 1000, // We slaan nu de BEWEEGTIJD op
            elapsedSec: (endTime - startTime) / 1000, // En de originele verstreken tijd voor de zekerheid
            rideDate: startTime ? startTime.toISOString() : new Date().toISOString(),
            segments: segments,
            type: 'ride'
        },
        uiData: { latlngs, elevations, distances, speeds: smoothSpeeds, powers: smoothPowers, durationMs: movingTimeMs, times}
    };
}

function calculateFastestSegments(distances, times) {
    const results = [];
    if (!distances || distances.length === 0) return results;

    const totalDist = distances[distances.length - 1];

    for (let k = 5; k <= 100; k += 5) {
        if (totalDist < k) break;

        let bestTimeMs = Infinity;
        let bestStartIdx = 0;
        let bestEndIdx = 0;
        let found = false;

        let startIdx = 0;
        let endIdx = 1;

        // Sliding window: schuif het "raam" van K kilometer efficiënt over de array
        while (endIdx < distances.length) {
            const currentDist = distances[endIdx] - distances[startIdx];

            if (currentDist >= k) {
                const timeDiff = times[endIdx] - times[startIdx];
                if (timeDiff < bestTimeMs) {
                    bestTimeMs = timeDiff;
                    bestStartIdx = startIdx;
                    bestEndIdx = endIdx;
                    found = true;
                }
                // Raam is groot genoeg, krimp vanaf links om te zoeken naar een snellere start
                startIdx++; 
            } else {
                // Raam is nog te klein, breid uit naar rechts
                endIdx++; 
            }
        }

        if (found) {
            results.push({
                distance: k,
                timeMs: bestTimeMs,
                speed: k / (bestTimeMs / 3600000),
                startIdx: bestStartIdx,
                endIdx: bestEndIdx
            });
        }
    }
    return results;
}

function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
    const R = 6371; const p = Math.PI/180;
    const a = 0.5 - Math.cos((lat2-lat1)*p)/2 + Math.cos(lat1*p)*Math.cos(lat2*p) * (1-Math.cos((lon2-lon1)*p))/2;
    return 12742 * Math.asin(Math.sqrt(a));
}

function animatePathOnMap(latlngs, mapInstance, polylineRef) {
    let currentIndex = 0;
    const currentLatlngs = [];
    polylineRef.setLatLngs([]); 

    const pointsPerFrame = Math.max(1, Math.floor(latlngs.length / 100));

    function animate() {
        if (currentIndex < latlngs.length) {
            for(let i=0; i<pointsPerFrame; i++) {
                if(currentIndex < latlngs.length) {
                    currentLatlngs.push(latlngs[currentIndex]);
                    currentIndex++;
                }
            }
            polylineRef.setLatLngs(currentLatlngs);
            requestAnimationFrame(animate);
        } else {
            const endPoint = latlngs[latlngs.length - 1];
            L.circleMarker(endPoint, { radius: 6, fillColor: "#10B981", color: "#fff", weight: 2, opacity: 1, fillOpacity: 1 }).addTo(mapInstance);
        }
    }
    requestAnimationFrame(animate);
}


function updateChart(labels, elePoints, speedPoints, powerPoints) {
    const chartEl = document.getElementById('elevationChart');
    if(!chartEl) return;
    const ctx = chartEl.getContext('2d');
    const step = Math.ceil(labels.length / 500);
    const filteredLabels = labels.filter((_, i) => i % step === 0);
    const filteredEle = elePoints.filter((_, i) => i % step === 0);
    const filteredSpeed = speedPoints ? speedPoints.filter((_, i) => i % step === 0) : [];
    const filteredPower = powerPoints ? powerPoints.filter((_, i) => i % step === 0) : [];

    if (elevationChart) elevationChart.destroy();

    elevationChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: filteredLabels.map(d => parseFloat(d).toFixed(1)),
            datasets: [
                { label: 'Hoogte (m)', data: filteredEle, borderColor: '#FC5200', backgroundColor: 'rgba(252,82,0,0.1)', fill: true, pointRadius: 0, borderWidth: 2, yAxisID: 'y', order: 3 },
                { label: 'Snelheid (km/u)', data: filteredSpeed, borderColor: '#007bff', backgroundColor: 'transparent', fill: false, pointRadius: 0, borderWidth: 1.5, tension: 0.4, yAxisID: 'y1', order: 2 },
                { label: 'Vermogen (W)', data: filteredPower, borderColor: '#6f42c1', backgroundColor: 'transparent', fill: false, pointRadius: 0, borderWidth: 1, tension: 0.4, yAxisID: 'y2', order: 1, hidden: true }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            onHover: (event, elements) => {
                if (elements && elements.length > 0) { showPointOnMap(elements[0].index * step); } else { hidePointOnMap(); }
            },
            scales: {
                x: { display: false },
                y: { type: 'linear', display: true, position: 'left', title: {display:true, text:'Hoogte'} },
                y1: { type: 'linear', display: true, position: 'right', grid: {drawOnChartArea:false}, title: {display:true, text:'Km/u'} },
                y2: { type: 'linear', display: false, position: 'right', grid: {drawOnChartArea:false}, min: 0 }
            },
            plugins: { legend: { display: true, labels: { boxWidth: 10 } } }
        }
    });
}

function showPointOnMap(index) {
    if (!currentRideData || !map) return;
    const safeIndex = Math.min(index, currentRideData.uiData.latlngs.length - 1);
    const latlng = currentRideData.uiData.latlngs[safeIndex];
    if (!latlng) return;
    if (!hoverMarker) { hoverMarker = L.circleMarker(latlng, { radius: 8, fillColor: "#007bff", color: "#ffffff", weight: 3, opacity: 1, fillOpacity: 1 }).addTo(map); }
    else { hoverMarker.setLatLng(latlng); if (!map.hasLayer(hoverMarker)) hoverMarker.addTo(map); }
    hoverMarker.bringToFront();
}

function hidePointOnMap() { if (hoverMarker && map) { map.removeLayer(hoverMarker); hoverMarker = null; } }

async function saveToCloud() {
    if (!currentRideData) return;
    const btn = document.getElementById('save-cloud-btn');
    btn.innerText = "Bezig..."; btn.disabled = true;
    try {
        await window.supabaseAuth.saveActivity({
            fileBlob: new Blob([currentRideData.xmlString], {type: 'application/xml'}),
            fileName: document.getElementById('drawn-ride-name')?.value || currentRideData.fileName,
            summary: currentRideData.summary
        });
        btn.innerText = "Opgeslagen";
        btn.classList.remove('btn-primary');
        btn.classList.add('btn-success');
        if(window.updateDashboard) window.updateDashboard();
    } catch (e) { 
        console.error(e); 
        btn.innerText = "Rit Opslaan"; 
        btn.disabled = false; 
    }
}

window.updateSegmentsUI = function(segments) {
    const list = document.getElementById('segments-list');
    if(!list) return;
    list.innerHTML = '';
    if(!segments || segments.length === 0) { list.innerHTML = '<small class="sub-text">Geen segmenten.</small>'; return; }

    const clearBtn = document.createElement('div');
    clearBtn.id = 'clear-segment-btn';
    clearBtn.className = 'btn-danger full-width margin-bottom hidden';
    clearBtn.style.textAlign = 'center'; clearBtn.style.justifyContent = 'center'; 
    clearBtn.innerHTML = 'Wis Selectie';
    clearBtn.onclick = () => clearSegmentHighlight();
    list.appendChild(clearBtn);

    segments.forEach(seg => {
        const div = document.createElement('div');
        div.className = 'segment-card clickable';
        div.dataset.dist = seg.distance;
        div.innerHTML = `<span><strong>${seg.distance}km</strong></span> <span>${seg.speed.toFixed(1)} km/u</span>`;
        div.onclick = () => { if (activeSegment === seg.distance) clearSegmentHighlight(); else highlightSegment(seg.startIdx, seg.endIdx, seg.distance); };
        list.appendChild(div);
    });
};

function updateMap(latlngs) {
    if (!map || !latlngs || latlngs.length === 0) return;

    if (window.resetPlayback) window.resetPlayback();
    if (polyline) map.removeLayer(polyline);
    if (segmentLayer) { map.removeLayer(segmentLayer); segmentLayer = null; }

    // Teken in één klap de volledige route (veel sneller!)
    polyline = L.polyline(latlngs, {color: '#FC5200', weight: 4, lineCap: 'round'}).addTo(map);

    const boundsPolyline = L.polyline(latlngs);
    map.fitBounds(boundsPolyline.getBounds(), {
        paddingTopLeft: [20, 20],
        paddingBottomRight: [20, 20],
        animate: true
    });

    // Start- en eindpunt markeren
    L.circleMarker(latlngs[0], { radius: 6, fillColor: "#10B981", color: "#fff", weight: 2, opacity: 1, fillOpacity: 1 }).addTo(map); // Groen (Start)
    L.circleMarker(latlngs[latlngs.length - 1], { radius: 6, fillColor: "#EF4444", color: "#fff", weight: 2, opacity: 1, fillOpacity: 1 }).addTo(map); // Rood (Eind)
}

function highlightSegment(startIdx, endIdx, dist) {
    if (!map || !currentRideData) return;

    if (startIdx === undefined || endIdx === undefined) {
        alert("Dit is een oude rit zonder opgeslagen GPS-coördinaten voor de segmenten.\n\nGa naar de tab 'Ranglijsten' en klik op de knop 'Fix Data' om dit voor al je ritten werkend te maken!");
        return;
    }

    activeSegment = dist;

    document.querySelectorAll('.segment-card').forEach(c => c.classList.remove('active-segment'));
    const activeCard = document.querySelector(`.segment-card[data-dist="${dist}"]`);
    if(activeCard) activeCard.classList.add('active-segment');

    const btn = document.getElementById('clear-segment-btn');
    if(btn) btn.classList.remove('hidden');

    if (segmentLayer) { map.removeLayer(segmentLayer); }

    const fullPath = currentRideData.uiData.latlngs;
    const segmentPath = fullPath.slice(startIdx, endIdx + 1);

    segmentLayer = L.polyline(segmentPath, { color: '#10B981', weight: 6, opacity: 1, lineCap: 'round' }).addTo(map);
    segmentLayer.bringToFront(); 

    map.fitBounds(segmentLayer.getBounds(), {
        paddingTopLeft: [50, 50],
        paddingBottomRight: [50, 50], // FIX: Was [50, 300], is nu 50
        animate: true
    });

    if (elevationChart) {
        const originalDataset = elevationChart.data.datasets[0];
        const totalPoints = originalDataset.data.length;
        const realTotalPoints = currentRideData.uiData.latlngs.length;
        const ratio = totalPoints / realTotalPoints;

        const chartStart = Math.floor(startIdx * ratio);
        const chartEnd = Math.ceil(endIdx * ratio);

        const highlightData = new Array(totalPoints).fill(null);
        for (let i = 0; i < totalPoints; i++) {
            if (i >= chartStart && i <= chartEnd) {
                highlightData[i] = originalDataset.data[i];
            }
        }

        let segIndex = elevationChart.data.datasets.findIndex(d => d.label === 'Segment');

        if (segIndex !== -1) {
            elevationChart.data.datasets[segIndex].data = highlightData;
        } else {
            elevationChart.data.datasets.push({
                label: 'Segment',
                data: highlightData,
                borderColor: '#10B981',
                backgroundColor: 'rgba(16, 185, 129, 0.4)',
                borderWidth: 3,
                pointRadius: 0,
                fill: true,
                order: 0
            });
        }
        elevationChart.update();
    }
}

function clearSegmentHighlight() {
    activeSegment = null;

    if (segmentLayer && map) { map.removeLayer(segmentLayer); segmentLayer = null; }
    if (polyline && map.hasLayer(polyline)) { try { map.fitBounds(polyline.getBounds()); } catch(e) {} }

    if (elevationChart) {
        let segIndex = elevationChart.data.datasets.findIndex(d => d.label === 'Segment');
        if (segIndex !== -1) {
            elevationChart.data.datasets.splice(segIndex, 1);
            elevationChart.update();
        }
    }

    document.querySelectorAll('.segment-card').forEach(c => c.classList.remove('active-segment'));
    const btn = document.getElementById('clear-segment-btn');
    if(btn) btn.classList.add('hidden');
}

window.fixMaxSpeeds = async function() {
    const btn = document.getElementById('fix-data-btn');
    if(btn) {
        btn.innerHTML = "Bezig met Harde Reset...";
        btn.disabled = true;
    }

    try {
        const activities = await window.supabaseAuth.listActivities();
        console.log(`Start harde reset voor ${activities.length} ritten...`);

        let count = 0;
        for (const act of activities) {
            if (act.summary.type === 'route') continue;
            const blob = await window.supabaseAuth.getActivityFile(act.id);
            const text = await blob.text();
            const freshData = parseGPXData(text, act.fileName, true);

            if (freshData && freshData.summary) {
                const newSummary = freshData.summary;
                await window.supabaseAuth.updateActivitySummary(act.id, newSummary);
                count++;
                if(btn) btn.innerHTML = `Bezig... ${count}/${activities.length}`;
            }
        }

        alert(`GELUKT! ${count} ritten zijn volledig gereset en opnieuw berekend.`);
        location.reload();

    } catch (e) {
        console.error(e);
        alert("Fout tijdens resetten: " + e.message);
        if(btn) { btn.innerHTML = "Fix Data"; btn.disabled = false; }
    }
};

window.parseGPXData = parseGPXData;

// --- AFSPEEL VARIABELEN & FUNCTIES ---
let playbackAnimationId = null;
let playbackIndex = 0;
let isPlaying = false;
let playbackSpeedSetting = 10; // Standaard op 10x
let playbackPolyline = null;   // NIEUW: De groeiende lijn

// Luistert naar het dropdown menu
window.changePlaybackSpeed = function() {
    const select = document.getElementById('playback-speed');
    if (select) {
        playbackSpeedSetting = parseFloat(select.value);
    }
};

window.togglePlayback = function() {
    if (!currentRideData || !currentRideData.uiData || !currentRideData.uiData.latlngs) return;
    
    const btn = document.getElementById('playback-btn');
    
    if (isPlaying) {
        // Pauzeren
        isPlaying = false;
        cancelAnimationFrame(playbackAnimationId);
        btn.innerHTML = '▶ Hervatten';
    } else {
        // Afspelen
        isPlaying = true;
        btn.innerHTML = '⏸ Pauze';
        
        // Reset als hij aan het einde was
        if (playbackIndex >= currentRideData.uiData.latlngs.length - 1) {
            playbackIndex = 0; 
        }

        // NIEUW: Verberg de volledige route van de kaart
        if (polyline && map.hasLayer(polyline)) {
            map.removeLayer(polyline);
        }

        // NIEUW: Maak de "groeiende" lijn aan als deze nog niet bestaat
        if (!playbackPolyline) {
            playbackPolyline = L.polyline([], {color: '#FC5200', weight: 4, lineCap: 'round'}).addTo(map);
        } else if (!map.hasLayer(playbackPolyline)) {
            playbackPolyline.addTo(map);
        }

        animatePlayback();
    }
};

window.resetPlayback = function() {
    isPlaying = false;
    cancelAnimationFrame(playbackAnimationId);
    playbackIndex = 0;
    
    const btn = document.getElementById('playback-btn');
    if(btn) btn.innerHTML = '▶ Speel Af';
    
    hidePointOnMap(); 

    // NIEUW: Verwijder de groeiende lijn en herstel de volledige route
    if (playbackPolyline && map.hasLayer(playbackPolyline)) {
        map.removeLayer(playbackPolyline);
        playbackPolyline.setLatLngs([]); // Maak hem leeg voor de volgende keer
    }
    if (polyline && !map.hasLayer(polyline)) {
        polyline.addTo(map);
    }
};

function animatePlayback() {
    if (!isPlaying || !currentRideData || !map) return;
    
    const latlngs = currentRideData.uiData.latlngs;
    
    const baseSpeedMultiplier = Math.max(0.1, (latlngs.length / 400) / 10); 
    playbackIndex += (baseSpeedMultiplier * playbackSpeedSetting);
    
    if (playbackIndex >= latlngs.length - 1) {
        playbackIndex = latlngs.length - 1;
        isPlaying = false;
        document.getElementById('playback-btn').innerHTML = '🔄 Opnieuw';
    }
    
    const currentIndex = Math.floor(playbackIndex);

    // NIEUW: Laat de lijn groeien tot het huidige punt!
    if (playbackPolyline) {
        const currentPath = latlngs.slice(0, currentIndex + 1);
        playbackPolyline.setLatLngs(currentPath);
    }

    showPointOnMap(currentIndex);

    if (isPlaying) {
        playbackAnimationId = requestAnimationFrame(animatePlayback);
    }
}

// --- VERGELIJK VARIABELEN ---
let compareMap = null;
let compBaseLayer = null;
let compLayer1 = null;
let compLayer2 = null;

window.compareSelectedRides = async function() {
    if (selectedRides.size !== 2) return;
    
    const ids = Array.from(selectedRides);
    const act1 = allActivitiesCache.find(a => a.id === ids[0]);
    const act2 = allActivitiesCache.find(a => a.id === ids[1]);

    // UI wisselen
    document.querySelectorAll('.view-section').forEach(v => v.classList.add('hidden'));
    document.getElementById('view-compare').classList.remove('hidden');

    // Skeletons
    document.getElementById('comp-name-1').innerText = "Gegevens inladen...";
    document.getElementById('comp-name-2').innerText = "Gegevens inladen...";

    try {
        // Haal beide GPX files vers op uit de cloud
        const b1 = await window.supabaseAuth.getActivityFile(act1.id);
        const b2 = await window.supabaseAuth.getActivityFile(act2.id);
        
        const t1 = await b1.text();
        const t2 = await b2.text();

        const d1 = window.parseGPXData(t1, act1.fileName, true);
        const d2 = window.parseGPXData(t2, act2.fileName, true);

        renderCompareUI(d1, d2);
    } catch (e) {
        console.error(e);
        alert("Fout bij ophalen van data voor vergelijking.");
    }
};

function renderCompareUI(data1, data2) {
    // Helper voor de tijd
    const formatTime = (sec) => {
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        return `${h}:${m.toString().padStart(2, '0')}`;
    };

    // --- VUL TEKST IN ---
    document.getElementById('comp-name-1').innerText = data1.fileName;
    document.getElementById('comp-date-1').innerText = new Date(data1.summary.rideDate).toLocaleDateString('nl-NL');
    document.getElementById('comp-dist-1').innerText = parseFloat(data1.summary.distanceKm).toFixed(2) + " km";
    document.getElementById('comp-time-1').innerText = formatTime(data1.summary.durationSec);
    document.getElementById('comp-avg-1').innerText = parseFloat(data1.summary.avgSpeed).toFixed(1) + " km/u";
    document.getElementById('comp-max-1').innerText = parseFloat(data1.summary.maxSpeed).toFixed(1) + " km/u";
    document.getElementById('comp-elev-1').innerText = data1.summary.elevationGain + " m";

    document.getElementById('comp-name-2').innerText = data2.fileName;
    document.getElementById('comp-date-2').innerText = new Date(data2.summary.rideDate).toLocaleDateString('nl-NL');
    document.getElementById('comp-dist-2').innerText = parseFloat(data2.summary.distanceKm).toFixed(2) + " km";
    document.getElementById('comp-time-2').innerText = formatTime(data2.summary.durationSec);
    document.getElementById('comp-avg-2').innerText = parseFloat(data2.summary.avgSpeed).toFixed(1) + " km/u";
    document.getElementById('comp-max-2').innerText = parseFloat(data2.summary.maxSpeed).toFixed(1) + " km/u";
    document.getElementById('comp-elev-2').innerText = data2.summary.elevationGain + " m";

    // --- MAP INITIALISEREN ---
    if (!compareMap) {
        compareMap = L.map('map-compare').setView([50.85, 4.35], 8);
        const isDark = document.body.classList.contains('dark-mode');
        const tileUrl = isDark ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png' : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
        compBaseLayer = L.tileLayer(tileUrl, { attribution: '©OpenStreetMap, ©CartoDB' }).addTo(compareMap);
    }
    setTimeout(() => compareMap.invalidateSize(), 100);

    if (compLayer1) compareMap.removeLayer(compLayer1);
    if (compLayer2) compareMap.removeLayer(compLayer2);

    // Teken rit 1 (Oranje) en rit 2 (Blauw)
    compLayer1 = L.polyline(data1.uiData.latlngs, {color: '#FC5200', weight: 4, opacity: 0.8}).addTo(compareMap);
    compLayer2 = L.polyline(data2.uiData.latlngs, {color: '#3B82F6', weight: 4, opacity: 0.8}).addTo(compareMap);

    // Zoom uit zodat beide ritten in beeld passen!
    const group = new L.featureGroup([compLayer1, compLayer2]);
    compareMap.fitBounds(group.getBounds(), {padding: [30, 30]});

    // --- GRAFIEK GENEREREN ---
    const ctx = document.getElementById('compareSpeedChart').getContext('2d');
    if (activeCharts['compChart']) activeCharts['compChart'].destroy();

    // Chart.js snapt dat de x-as niet gelijk oploopt als we coördinaten {x, y} meegeven
    const set1 = data1.uiData.distances.map((dist, i) => ({ x: dist, y: data1.uiData.speeds[i] }));
    const set2 = data2.uiData.distances.map((dist, i) => ({ x: dist, y: data2.uiData.speeds[i] }));

    const step1 = Math.max(1, Math.floor(set1.length / 400));
    const step2 = Math.max(1, Math.floor(set2.length / 400));

    activeCharts['compChart'] = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [
                {
                    label: data1.fileName,
                    data: set1.filter((_, i) => i % step1 === 0),
                    borderColor: '#FC5200',
                    borderWidth: 2,
                    pointRadius: 0,
                    tension: 0.4
                },
                {
                    label: data2.fileName,
                    data: set2.filter((_, i) => i % step2 === 0),
                    borderColor: '#3B82F6',
                    borderWidth: 2,
                    pointRadius: 0,
                    tension: 0.4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { type: 'linear', title: { display: true, text: 'Afstand (km)' } },
                y: { title: { display: true, text: 'Snelheid (km/u)' } }
            }
        }
    });
}


let mapboxMap = null;
let cinematicFrameId = null;
let currentMarker = null;
let ghostMarker = null;

// Functie om de snelste eerdere rit te vinden op (ongeveer) dezelfde route
function findGhostRide(currentRide) {
    if (!window.allActivitiesCache) return null;
    
    const dist = parseFloat(currentRide.summary.distanceKm);
    
    // Zoek ritten die qua afstand max 2% afwijken
    const possibleGhosts = window.allActivitiesCache.filter(act => {
        if (act.id === currentRide.id || act.summary.type === 'route') return false;
        const actDist = parseFloat(act.summary.distanceKm);
        return Math.abs(actDist - dist) < (dist * 0.02); 
    });

    if (possibleGhosts.length === 0) return null;

    // Sorteer op snelheid (snelste is je PR / Ghost)
    possibleGhosts.sort((a, b) => parseFloat(b.summary.avgSpeed) - parseFloat(a.summary.avgSpeed));
    return possibleGhosts[0];
}

window.startCinematicReplay = async function() {
    if (!currentRideData || !currentRideData.uiData) return;

    // Haal je gratis API key op via mapbox.com
    mapboxgl.accessToken = 'VUL_HIER_JE_MAPBOX_TOKEN_IN'; 

    const ghostRideMeta = findGhostRide(currentRideData);
    let ghostData = null;

    // Haal de GPS data van de Ghost rit op uit de cloud
    if (ghostRideMeta) {
        try {
            const blob = await window.supabaseAuth.getActivityFile(ghostRideMeta.id);
            const text = await blob.text();
            ghostData = window.parseGPXData(text, ghostRideMeta.fileName, true);
        } catch (e) { console.warn("Kon ghost data niet inladen", e); }
    }

    // UI klaarmaken
    document.querySelectorAll('.view-section').forEach(v => v.classList.add('hidden'));
    document.getElementById('view-cinematic').classList.remove('hidden');
    document.getElementById('ghost-ui-overlay').classList.remove('hidden');

    const startCoord = currentRideData.uiData.latlngs[0];

    // Initialiseer Mapbox als deze nog niet bestaat
    if (!mapboxMap) {
        mapboxMap = new mapboxgl.Map({
            container: 'mapbox-container',
            style: 'mapbox://styles/mapbox/satellite-streets-v12', // Realistische satellietbeelden
            center: [startCoord[1], startCoord[0]], // [Lng, Lat] in Mapbox!
            zoom: 14,
            pitch: 65, // 3D Kanteling
            bearing: 0
        });

        mapboxMap.on('load', () => {
            // 3D Terrein toevoegen
            mapboxMap.addSource('mapbox-dem', {
                'type': 'raster-dem',
                'url': 'mapbox://mapbox.mapbox-terrain-dem-v1',
                'tileSize': 512,
                'maxzoom': 14
            });
            mapboxMap.setTerrain({ 'source': 'mapbox-dem', 'exaggeration': 1.5 });

            // Sky laag voor een realistische horizon
            mapboxMap.addLayer({
                'id': 'sky',
                'type': 'sky',
                'paint': { 'sky-type': 'atmosphere', 'sky-atmosphere-sun': [0.0, 0.0], 'sky-atmosphere-sun-intensity': 15 }
            });

            runCinematicAnimation(currentRideData, ghostData);
        });
    } else {
        runCinematicAnimation(currentRideData, ghostData);
    }
};

function runCinematicAnimation(currentRide, ghostRide) {
    if (currentMarker) currentMarker.remove();
    if (ghostMarker) ghostMarker.remove();
    cancelAnimationFrame(cinematicFrameId);

    // Voeg markers toe aan Mapbox
    const elCurrent = document.createElement('div');
    elCurrent.className = 'marker-current';
    currentMarker = new mapboxgl.Marker(elCurrent).setLngLat([0,0]).addTo(mapboxMap);

    let hasGhost = !!(ghostRide && ghostRide.uiData);
    if (hasGhost) {
        const elGhost = document.createElement('div');
        elGhost.className = 'marker-ghost';
        ghostMarker = new mapboxgl.Marker(elGhost).setLngLat([0,0]).addTo(mapboxMap);
    } else {
        document.getElementById('replay-time-gap').innerText = "Geen PR gevonden";
        document.getElementById('replay-time-gap').style.color = "#888";
    }

    let progressIndex = 0;
    const path = currentRide.uiData.latlngs;
    const speeds = currentRide.uiData.speeds;
    const distances = currentRide.uiData.distances;
    
    // Animatiesnelheid (afhankelijk van route lengte)
    const speedMultiplier = Math.max(0.5, (path.length / 500));

    function animate() {
        progressIndex += speedMultiplier;
        if (progressIndex >= path.length - 1) progressIndex = 0; // Loop de animatie

        const idx = Math.floor(progressIndex);
        const currentPos = path[idx];
        const currentLngLat = [currentPos[1], currentPos[0]];

        // Update blauwe stip
        currentMarker.setLngLat(currentLngLat);
        document.getElementById('replay-current-speed').innerText = `${(speeds[idx]||0).toFixed(1)} km/u`;

        // Ghost Logica
        if (hasGhost) {
            const currentDist = distances[idx];
            const ghostDistances = ghostRide.uiData.distances;
            
            // Zoek waar de Ghost was op exact deze afstand
            let ghostIdx = ghostDistances.findIndex(d => d >= currentDist);
            if (ghostIdx === -1) ghostIdx = ghostDistances.length - 1;

            const ghostPos = ghostRide.uiData.latlngs[ghostIdx];
            ghostMarker.setLngLat([ghostPos[1], ghostPos[0]]);
            document.getElementById('replay-ghost-speed').innerText = `${(ghostRide.uiData.speeds[ghostIdx]||0).toFixed(1)} km/u`;

            // Bereken live tijdsverschil
            // Hier gaan we ervan uit dat 1 index stap ongeveer overeenkomt met 1 seconde (hangt af van GPX file)
            // Nauwkeuriger zou zijn om de echte timestamps uit de XML te halen, maar dit is een werkbare proxy
            const timeDiffSec = ghostIdx - idx; 
            const gapEl = document.getElementById('replay-time-gap');
            
            if (timeDiffSec > 0) {
                gapEl.innerText = `+${timeDiffSec}s (Achter)`;
                gapEl.style.color = "#EF4444"; // Rood
            } else {
                gapEl.innerText = `${timeDiffSec}s (Voor)`;
                gapEl.style.color = "#10B981"; // Groen
            }
        }

        // Helikopter Camera Beweging
        // Bereken bearing (kijkrichting) naar het volgende puntg
        let bearing = mapboxMap.getBearing();
        if (idx < path.length - 5) {
            const nextPos = path[idx + 5];
            const angle = Math.atan2(nextPos[1] - currentPos[1], nextPos[0] - currentPos[0]) * 180 / Math.PI;
            bearing = (90 - angle + 360) % 360;
        }

        mapboxMap.easeTo({
            center: currentLngLat,
            bearing: bearing,
            pitch: 65,
            duration: 0, // 0 voor vloeiende framerate updates
            zoom: 15.5
        });

        cinematicFrameId = requestAnimationFrame(animate);
    }
    animate();
}

window.stopCinematicReplay = function() {
    cancelAnimationFrame(cinematicFrameId);
    document.getElementById('view-cinematic').classList.add('hidden');
    document.getElementById('ghost-ui-overlay').classList.add('hidden');
    document.getElementById('ride-map-view').classList.remove('hidden');
    
    // Forceer Leaflet map fix
    if (typeof map !== 'undefined' && map) setTimeout(() => map.invalidateSize(), 100);
};

// --- MIJN SEGMENTEN TAB (CUSTOM SEGMENTS) ---
let csMap = null;
let isDrawingCS = false;
let csDrawnPoints = [];
let csRoadSegments = []; // Array om te kunnen "undo-en"
let csPolyline = null;
let csMarkers = [];
let csHoverLine = null;
let csHoverFullPath = null;

// Multi-select variabelen
let csSelectedIndices = new Set();
let csSelectedPolylines = [];

const originalSwitchTab = window.switchTab;
window.switchTab = function(tabName) {
    originalSwitchTab(tabName);
    if (tabName === 'segment-builder') setTimeout(initCSMap, 150);
};

function initCSMap() {
    if (csMap) { csMap.invalidateSize(); updateCSMapTheme(); return; }
    csMap = L.map('map-custom-segments').setView([51.185, 3.565], 11);
    updateCSMapTheme();
}

function updateCSMapTheme() {
    if (!csMap) return;
    const isDark = document.body.classList.contains('dark-mode');
    const tileUrl = isDark ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png' : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
    csMap.eachLayer(layer => { if (layer instanceof L.TileLayer) csMap.removeLayer(layer); });
    L.tileLayer(tileUrl, { attribution: '©OpenStreetMap, ©CartoDB' }).addTo(csMap).setZIndex(0);
}

const originalToggleTheme = window.toggleTheme;
window.toggleTheme = () => { originalToggleTheme(); updateCSMapTheme(); };

window.toggleCSDrawing = function() {
    const btnDraw = document.getElementById('btn-draw-cs');
    const btnFinish = document.getElementById('btn-finish-cs');
    const btnUndo = document.getElementById('btn-undo-cs');
    const instr = document.getElementById('cs-instruction');
    const resultsDiv = document.getElementById('cs-results-list');

    if (!isDrawingCS) {
        isDrawingCS = true;
        csDrawnPoints = [];
        csRoadSegments = [];
        
        if (csPolyline) csMap.removeLayer(csPolyline);
        clearCSHoverAndSelected();
        csMarkers.forEach(m => csMap.removeLayer(m));
        csMarkers = [];
        
        document.getElementById('cs-dist').innerText = "0";
        document.getElementById('cs-efforts').innerText = "0";
        document.getElementById('cs-pr').innerText = "--:--";
        resultsDiv.innerHTML = '<div class="empty-state">Lijn aan het tekenen...</div>';
        
        btnDraw.innerText = "Wis Lijn";
        btnDraw.classList.replace('btn-primary', 'btn-danger');
        btnFinish.classList.remove('hidden');
        btnUndo.classList.remove('hidden');
        instr.innerText = "1. Klik op de weg om de route te traceren.";
        
        csMap.on('click', handleCSDrawClick);
    } else {
        isDrawingCS = false;
        btnDraw.innerText = "Teken Lijn";
        btnDraw.classList.replace('btn-danger', 'btn-primary');
        btnFinish.classList.add('hidden');
        btnUndo.classList.add('hidden');
        instr.innerText = "Teken een route op de kaart om al je eerdere tijden op dit stuk te vinden.";
        csMap.off('click', handleCSDrawClick);
    }
};

window.undoLastCSPoint = function() {
    if (csDrawnPoints.length === 0) return;
    
    // Verwijder laatste bolletje en lijnsegment
    const marker = csMarkers.pop();
    csMap.removeLayer(marker);
    csDrawnPoints.pop();
    csRoadSegments.pop();
    
    redrawCSLine();
    
    if (csDrawnPoints.length === 0) {
        document.getElementById('cs-instruction').innerText = "1. Klik op de weg om de route te traceren.";
    }
};

async function handleCSDrawClick(e) {
    const newPt = e.latlng;
    const marker = L.circleMarker(newPt, { radius: 5, fillColor: "#FC5200", color: "#fff", weight: 2, fillOpacity: 1 }).addTo(csMap);
    csMarkers.push(marker);

    document.getElementById('cs-instruction').innerText = "Lijn berekenen...";
    let newSegment = [];

    // Bereken het route-stukje tussen dit en het vorige punt
    if (csDrawnPoints.length > 0) {
        const prevPt = csDrawnPoints[csDrawnPoints.length - 1];
        const url = `https://routing.openstreetmap.de/routed-bike/route/v1/driving/${prevPt.lng},${prevPt.lat};${newPt.lng},${newPt.lat}?overview=full&geometries=geojson`;
        try {
            const res = await fetch(url);
            const data = await res.json();
            if (data.routes && data.routes.length > 0) {
                newSegment = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
            } else newSegment = [[newPt.lat, newPt.lng]];
        } catch(err) { newSegment = [[newPt.lat, newPt.lng]]; }
    } else {
        newSegment = [[newPt.lat, newPt.lng]];
    }
    
    csRoadSegments.push(newSegment);
    csDrawnPoints.push(newPt);
    redrawCSLine();
    document.getElementById('cs-instruction').innerText = "Klik verder of druk op 'Zoeken' als je klaar bent.";
}

function redrawCSLine() {
    if (csPolyline) csMap.removeLayer(csPolyline);
    const fullPath = csRoadSegments.flat();
    if (fullPath.length > 0) {
        csPolyline = L.polyline(fullPath, { color: '#10B981', weight: 6, opacity: 0.6 }).addTo(csMap);
    }
    let dist = 0;
    for(let i = 1; i < fullPath.length; i++) dist += csMap.distance(fullPath[i-1], fullPath[i]);
    document.getElementById('cs-dist').innerText = (dist/1000).toFixed(2);
}

window.finishCSDrawing = async function() {
    const fullPath = csRoadSegments.flat();
    if (fullPath.length < 2) {
        if(window.showToast) window.showToast("Teken minstens 2 punten!", "error");
        return;
    }

    const btnFinish = document.getElementById('btn-finish-cs');
    const btnUndo = document.getElementById('btn-undo-cs');
    const instr = document.getElementById('cs-instruction');
    
    btnFinish.innerText = "Laden..."; 
    btnFinish.disabled = true;
    csMap.off('click', handleCSDrawClick);

    // Bereken de exacte afstand van jouw getekende lijn
    let drawnDist = 0;
    for(let i = 1; i < fullPath.length; i++) {
        drawnDist += csMap.distance(fullPath[i-1], fullPath[i]);
    }
    const drawnDistKm = drawnDist / 1000;

    const segmentBounds = L.polyline(fullPath).getBounds().pad(0.05); 
    const user = window.supabaseAuth.getCurrentUser();
    const cacheKey = `heatmap_data_v2_${user ? user.id : ''}`;
    const cachedHeatmap = JSON.parse(localStorage.getItem(cacheKey) || "{}");

    if (!window.allActivitiesCache) window.allActivitiesCache = await window.supabaseAuth.listActivities();
    const ridesToScan = window.allActivitiesCache.filter(a => a.summary.type !== 'route');
    
    let processed = 0;
    const results = [];

    for (const act of ridesToScan) {
        processed++;
        instr.innerText = `Scannen: Rit ${processed} van ${ridesToScan.length}...`;

        if (cachedHeatmap[act.id]) {
            const pts = cachedHeatmap[act.id];
            let inBounds = false;
            for (let p of pts) {
                if (segmentBounds.contains([p[0], p[1]])) {
                    inBounds = true; 
                    break;
                }
            }
            if (!inBounds) continue; 
        }

        try {
            const blob = await window.supabaseAuth.getActivityFile(act.id);
            const text = await blob.text();
            const data = window.parseGPXData(text, act.fileName, true);
            if (!data || !data.uiData || !data.uiData.times) continue;

            const latlngs = data.uiData.latlngs;
            const times = data.uiData.times;
            const distances = data.uiData.distances;

            const targetStartPt = L.latLng(fullPath[0][0], fullPath[0][1]);
            const targetEndPt = L.latLng(fullPath[fullPath.length - 1][0], fullPath[fullPath.length - 1][1]);

            // --- DE NIEUWE ROBUUSTE LOGICA ---
            
            // Hulpfunctie om ALLE passages (doorkomsten) van een bepaald punt te vinden
            function findPassages(targetPt, latlngsArray) {
                let passages = [];
                let inZone = false;
                let bestIdx = -1;
                let bestDist = Infinity;

                for (let i = 0; i < latlngsArray.length; i++) {
                    const d = csMap.distance(latlngsArray[i], targetPt);
                    if (d < 45) { // Binnen 45 meter is een hit
                        inZone = true;
                        if (d < bestDist) {
                            bestDist = d;
                            bestIdx = i; // Bewaar het aller-dichtste punt van deze doorkomst
                        }
                    } else if (inZone && d > 100) { 
                        // Zodra je verder dan 100m weg bent, sluiten we deze doorkomst af
                        passages.push(bestIdx);
                        inZone = false;
                        bestIdx = -1;
                        bestDist = Infinity;
                    }
                }
                if (inZone && bestIdx !== -1) {
                    passages.push(bestIdx);
                }
                return passages;
            }

            // Verzamel alle momenten dat je de start en de finish passeerde
            const startPassages = findPassages(targetStartPt, latlngs);
            const endPassages = findPassages(targetEndPt, latlngs);

            let usedStarts = new Set();

            // Koppel elke finish aan de juiste start
            for (let eIdx of endPassages) {
                // Zoek alle starts die vóór deze specifieke finish plaatsvonden
                let validStarts = startPassages.filter(s => s < eIdx);
                if (validStarts.length === 0) continue;
                
                // DE FIX: Pak de LAATSTE start vóór de finish (dit negeert je eerdere U-bocht passages!)
                let sIdx = validStarts[validStarts.length - 1];
                
                // Zorg dat we een start niet dubbel gebruiken (bijv. als je na de finish nog eens langs de finish fietst)
                if (usedStarts.has(sIdx)) continue;

                const timeMs = times[eIdx].getTime() - times[sIdx].getTime();
                const distKm = distances[eIdx] - distances[sIdx];
                const distRatio = distKm / drawnDistKm;

                // Strenge controle (25% afwijking toegestaan t.o.v. de getekende lijn)
                if (timeMs > 0 && distKm > 0.05 && distRatio > 0.75 && distRatio < 1.25) {
                    const speedKmh = distKm / (timeMs / 3600000);
                    const trace = latlngs.slice(sIdx, eIdx + 1);
                    results.push({ act, timeMs, speed: speedKmh, dist: distKm, date: new Date(act.summary.rideDate), trace, fullPath: latlngs });
                    usedStarts.add(sIdx);
                }
            }
        } catch (e) {}
    }

    results.sort((a, b) => a.timeMs - b.timeMs);
    
    btnFinish.innerText = "Zoeken"; 
    btnFinish.disabled = false;
    btnFinish.classList.add('hidden');
    btnUndo.classList.add('hidden');
    isDrawingCS = false;
    document.getElementById('btn-draw-cs').innerText = "Nieuwe Lijn";
    document.getElementById('btn-draw-cs').classList.replace('btn-danger', 'btn-primary');
    
    if (csPolyline) csMap.fitBounds(csPolyline.getBounds(), { padding: [50, 50] });
    renderCSResults(results);
};

function renderCSResults(results) {
    const resultsDiv = document.getElementById('cs-results-list');
    const instr = document.getElementById('cs-instruction');
    document.getElementById('cs-efforts').innerText = results.length;
    
    clearCSHoverAndSelected();

    if (results.length === 0) {
        instr.innerText = "Geen ritten gevonden.";
        document.getElementById('cs-pr').innerText = "--:--";
        resultsDiv.innerHTML = '<div class="empty-state">Je hebt dit segment nog nooit gereden.</div>';
        return;
    }

    instr.innerText = `Klik op ritten om ze samen op de kaart te leggen.`;
    const prSec = Math.floor(results[0].timeMs / 1000);
    document.getElementById('cs-pr').innerText = `${Math.floor(prSec / 60)}:${(prSec % 60).toString().padStart(2,'0')}`;
    window.csCurrentResults = results;

    resultsDiv.innerHTML = results.map((r, i) => {
        const totSec = Math.floor(r.timeMs / 1000);
        const m = Math.floor(totSec / 60);
        const s = totSec % 60;
        const color = i === 0 ? 'var(--medal-gold)' : i === 1 ? 'var(--medal-silver)' : i === 2 ? 'var(--medal-bronze)' : 'var(--text-main)';
        
        const stringifiedAct = JSON.stringify(r.act).replace(/"/g, '&quot;');

        // Klikken triggert multi-select. Knop erin springt naar Analyse.
        return `
        <div id="cs-item-${i}" class="cs-result-item" 
             onmouseenter="showGhostTrace(${i})" 
             onmouseleave="hideGhostTrace()"
             onclick="toggleCSSelection(${i})">
            <div style="display:flex; align-items:center; gap:12px;">
                <span class="cs-rank" style="color: ${color};">${i+1}</span>
                <div>
                    <strong style="display:block; color:var(--text-main); font-size: 1rem;">${m}:${s.toString().padStart(2,'0')}</strong>
                    <span class="sub-text">${r.date.toLocaleDateString()}</span>
                </div>
            </div>
            <div style="text-align: right; display:flex; flex-direction:column; align-items:flex-end;">
                <strong class="primary-text">${r.speed.toFixed(1)} <small>km/u</small></strong>
                <button class="btn-secondary btn-small" style="margin-top:4px; padding:2px 6px; font-size:0.7rem;" 
                        onclick="event.stopPropagation(); switchTab('analysis'); window.openRide(${stringifiedAct});">
                    Analyse
                </button>
            </div>
        </div>`;
    }).join('');
}

window.toggleCSSelection = function(index) {
    if (csSelectedIndices.has(index)) csSelectedIndices.delete(index);
    else csSelectedIndices.add(index);
    
    // Kleur in de lijst toewijzen of weghalen
    document.querySelectorAll('.cs-result-item').forEach((el, i) => {
        if (csSelectedIndices.has(i)) el.classList.add('selected');
        else el.classList.remove('selected');
    });
    
    renderCSSelectedLines();
};

function renderCSSelectedLines() {
    csSelectedPolylines.forEach(p => csMap.removeLayer(p));
    csSelectedPolylines = [];
    
    // Spectrum voor meerdere overlappende ritten
    const palette = ['#3B82F6', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6'];
    let colorIdx = 0;
    
    csSelectedIndices.forEach(idx => {
        const data = window.csCurrentResults[idx];
        const color = palette[colorIdx % palette.length];
        colorIdx++;
        
        const fullL = L.polyline(data.fullPath, { color: color, weight: 3, opacity: 0.3 }).addTo(csMap);
        const traceL = L.polyline(data.trace, { color: color, weight: 6, opacity: 1 }).addTo(csMap);
        
        csSelectedPolylines.push(fullL, traceL);
        traceL.bringToFront();
    });
}

function clearCSHoverAndSelected() {
    if (csHoverLine) csMap.removeLayer(csHoverLine);
    if (csHoverFullPath) csMap.removeLayer(csHoverFullPath);
    csSelectedPolylines.forEach(p => csMap.removeLayer(p));
    csSelectedPolylines = [];
    csSelectedIndices.clear();
}

window.showGhostTrace = function(index) {
    // Check of deze rit niet toevallig al geselecteerd (aangeklikt) is
    if (csSelectedIndices.has(index)) return; 
    if (!window.csCurrentResults || !window.csCurrentResults[index]) return;
    
    const data = window.csCurrentResults[index];
    if (csHoverLine) csMap.removeLayer(csHoverLine);
    if (csHoverFullPath) csMap.removeLayer(csHoverFullPath);
    
    csHoverFullPath = L.polyline(data.fullPath, { color: '#9CA3AF', weight: 3, opacity: 0.4, dashArray: '5, 5' }).addTo(csMap);
    csHoverLine = L.polyline(data.trace, { color: '#9CA3AF', weight: 6, opacity: 0.9 }).addTo(csMap);
    csHoverLine.bringToFront();
};

window.hideGhostTrace = function() {
    if (csHoverLine) csMap.removeLayer(csHoverLine);
    if (csHoverFullPath) csMap.removeLayer(csHoverFullPath);
};

window.searchLocationCS = async function() {
    const query = document.getElementById('cs-location-search').value.trim();
    if (!query) return;

    // Zoek de specifieke zoek-knop op om 'laden...' te tonen
    const btn = document.querySelector('button[onclick="searchLocationCS()"]');
    const oldText = btn.innerText;
    btn.innerText = "...";
    btn.disabled = true;

    try {
        // Gebruik de OpenStreetMap API (gratis, geen API key nodig)
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`;
        const res = await fetch(url);
        const data = await res.json();

        if (data && data.length > 0) {
            const lat = parseFloat(data[0].lat);
            const lon = parseFloat(data[0].lon);
            
            // Vlieg soepel naar de nieuwe locatie op zoomniveau 13
            csMap.flyTo([lat, lon], 13, { animate: true, duration: 1.5 });
        } else {
            if (window.showToast) window.showToast("Locatie niet gevonden.", "error");
            else alert("Locatie niet gevonden.");
        }
    } catch (e) {
        console.error("Fout bij zoeken locatie:", e);
        if (window.showToast) window.showToast("Netwerkfout bij zoeken.", "error");
    } finally {
        btn.innerText = oldText;
        btn.disabled = false;
    }
};

// --- HEATMAP OVERLAY VOOR MIJN SEGMENTEN ---
let csHeatmapGroup = null;

window.toggleCSHeatmap = async function(show) {
    if (!csMap) return;

    if (!show) {
        if (csHeatmapGroup) {
            csMap.removeLayer(csHeatmapGroup);
            csHeatmapGroup = null;
        }
        return;
    }

    // Maak laag aan
    csHeatmapGroup = L.layerGroup().addTo(csMap);

    const user = window.supabaseAuth.getCurrentUser();
    if (!user) return;

    const cacheKey = `heatmap_data_v2_${user.id}`;
    let cached = JSON.parse(localStorage.getItem(cacheKey) || "{}");

    // Als de cache leeg is, halen we de ritten op en genereren we de punten direct
    if (Object.keys(cached).length === 0) {
        if (window.showToast) window.showToast("Heatmap data inladen...", "success");
        let acts = allActivitiesCache || await window.supabaseAuth.listActivities();
        acts = acts.filter(a => a.summary.type !== 'route');

        for (let act of acts) {
            try {
                const b = await window.supabaseAuth.getActivityFile(act.id);
                const t = await b.text();
                const parsed = window.parseGPXData(t, act.fileName, true);
                if (parsed && parsed.uiData) {
                    const pts = [];
                    const { latlngs, speeds, elevations, distances } = parsed.uiData;
                    for(let j = 0; j < latlngs.length; j += 5) {
                        pts.push([latlngs[j][0], latlngs[j][1], speeds[j] || 0, 0]);
                    }
                    cached[act.id] = pts;
                }
            } catch (e) {}
        }
        try { localStorage.setItem(cacheKey, JSON.stringify(cached)); } catch(e) {}
    }

    // Teken alle lijntjes subtiel in het oranje op de 'Mijn Segmenten' kaart
    Object.values(cached).forEach(pts => {
        if (pts && pts.length > 0) {
            const coords = pts.map(p => [p[0], p[1]]);
            L.polyline(coords, { 
                color: '#ff4400', 
                weight: 3, 
                opacity: 0.2, // Subtiel zodat je getekende segment goed zichtbaar blijft
                lineCap: 'round',
                lineJoin: 'round',
                interactive: false
            }).addTo(csHeatmapGroup);
        }
    });

    // Zorg dat de getekende lijn altijd boven de heatmap ligt
    if (csPolyline) csPolyline.bringToFront();
};