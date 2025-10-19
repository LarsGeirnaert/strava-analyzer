/* ========== RANGSCHIKKING FUNCTIES ========== */

let allSegmentsCache = null;
let rankingsChart = null;

// Bereken alle segmenten voor rangschikking
async function calculateAllSegments() {
    const activities = await listActivitiesFromDB();
    console.log(`📊 Rangschikking: ${activities.length} ritten gevonden`);
    
    // Maak object voor alle 5km stappen van 5 tot 100km
    const allSegments = {};
    for (let km = 5; km <= 100; km += 5) {
        allSegments[km.toString()] = [];
    }

    let processedCount = 0;
    let errorCount = 0;

    for (const activity of activities) {
        try {
            console.log(`🔍 Verwerken: ${activity.fileName}`);
            
            // Gebruik de opgeslagen afstand in plaats van opnieuw te berekenen
            const storedDistanceKm = activity.summary?.distanceKm ? parseFloat(activity.summary.distanceKm) : null;
            const totalDistanceMeters = storedDistanceKm ? storedDistanceKm * 1000 : 0;
            
            console.log(`📏 ${activity.fileName}: ${storedDistanceKm || 'onbekend'} km (opgeslagen)`);

            if (!storedDistanceKm || totalDistanceMeters < 5000) {
                console.log(`➖ ${activity.fileName}: te kort voor segmenten (${storedDistanceKm || 'onbekend'} km)`);
                continue;
            }

            const text = await activity.fileBlob.text();
            const doc = new DOMParser().parseFromString(text, "application/xml");
            
            if (doc.querySelector("parsererror")) {
                console.warn(`❌ XML parse fout: ${activity.fileName}`);
                errorCount++;
                continue;
            }

            // Parse trackpoints
            const xpath = "//*[local-name()='Trackpoint' or local-name()='trkpt']";
            const nodes = [];
            const iter = doc.evaluate(xpath, doc, null, XPathResult.ORDERED_NODE_ITERATOR_TYPE, null);
            let node;
            while ((node = iter.iterateNext())) nodes.push(node);

            console.log(`📍 ${activity.fileName}: ${nodes.length} trackpoints`);

            if (nodes.length < 2) {
                console.warn(`⚠️ Te weinig trackpoints: ${activity.fileName}`);
                continue;
            }

            const getChildText = (el, names) => {
                for (const n of names) {
                    const found = Array.from(el.childNodes).find(ch => ch.localName === n);
                    if (found && found.textContent) return found.textContent;
                    const q = el.querySelector(n);
                    if (q && q.textContent) return q.textContent;
                }
                return null;
            };

            const trackpoints = nodes.map(tp => {
                const timeStr = getChildText(tp, ["Time", "time"]);
                const time = timeStr ? new Date(timeStr) : null;
                
                const distStr = getChildText(tp, ["DistanceMeters"]);
                const distance = distStr !== null ? toNumberSafe(distStr) : NaN;
                
                let lat = NaN, lon = NaN;
                if (tp.hasAttribute && (tp.hasAttribute("lat") || tp.hasAttribute("lon"))) {
                    lat = toNumberSafe(tp.getAttribute("lat"));
                    lon = toNumberSafe(tp.getAttribute("lon"));
                }
                return { time, distance, lat, lon };
            });

            // Controleer of er tijden zijn
            const hasTimes = trackpoints.every(tp => tp.time instanceof Date && !isNaN(tp.time));
            if (!hasTimes) {
                console.warn(`⏰ Geen timestamps: ${activity.fileName}`);
                continue;
            }

            // Bereken cumulatieve afstand
            const cumDist = new Array(trackpoints.length).fill(0);
            const hasDistanceValues = trackpoints.some(tp => !isNaN(tp.distance));
            
            if (hasDistanceValues) {
                const base = isNaN(trackpoints[0].distance) ? 0 : trackpoints[0].distance;
                for (let i = 0; i < trackpoints.length; i++) {
                    const d = isNaN(trackpoints[i].distance) ? NaN : trackpoints[i].distance - base;
                    cumDist[i] = isNaN(d) ? (i === 0 ? 0 : cumDist[i-1]) : d;
                }
                console.log(`📐 ${activity.fileName}: gebruikt DistanceMeters uit bestand`);
            } else {
                for (let i = 1; i < trackpoints.length; i++) {
                    const a = trackpoints[i-1], b = trackpoints[i];
                    if (!isNaN(a.lat) && !isNaN(a.lon) && !isNaN(b.lat) && !isNaN(b.lon)) {
                        cumDist[i] = cumDist[i-1] + haversine(a.lat, a.lon, b.lat, b.lon);
                    } else {
                        cumDist[i] = cumDist[i-1];
                    }
                }
                console.log(`📐 ${activity.fileName}: gebruikt GPS coordinaten voor afstand`);
            }

            const calculatedTotalDistance = cumDist[cumDist.length - 1];
            console.log(`📏 ${activity.fileName}: ${(calculatedTotalDistance / 1000).toFixed(2)} km (berekend)`);

            // Bereken segmenten voor alle 5km stappen tot 100km
            let segmentCount = 0;
            const maxDistance = Math.min(100, Math.floor(storedDistanceKm / 5) * 5); // Max 100km of afgerond op 5km

            for (let km = 5; km <= maxDistance; km += 5) {
                const targetMeters = km * 1000;
                
                // Gebruik de opgeslagen afstand als primaire check
                if (totalDistanceMeters < targetMeters) {
                    continue; // Stil overslaan, niet loggen
                }

                // Secundaire check met berekende afstand
                if (calculatedTotalDistance < targetMeters) {
                    continue; // Stil overslaan, niet loggen
                }

                const segments = computeFastestSegments(trackpoints, cumDist, [targetMeters]);
                
                if (segments[0]) {
                    allSegments[km.toString()].push({
                        activityId: activity.id,
                        fileName: activity.fileName,
                        rideDate: activity.summary?.rideDate,
                        segment: segments[0],
                        durationSec: segments[0].durationSec,
                        avgKmh: segments[0].avgKmh,
                        storedDistance: storedDistanceKm,
                        calculatedDistance: calculatedTotalDistance / 1000,
                        originalActivity: activity
                    });
                    segmentCount++;
                    console.log(`✅ ${activity.fileName}: ${km}km segment gevonden (${segments[0].avgKmh.toFixed(1)} km/u)`);
                }
            }

            processedCount++;
            console.log(`✓ ${activity.fileName}: ${segmentCount} segmenten gevonden`);

        } catch (error) {
            console.error(`💥 Fout bij verwerken ${activity.fileName}:`, error);
            errorCount++;
        }
    }

    // Sorteer segmenten per afstand en toon samenvatting
    let totalSegments = 0;
    let availableDistances = [];
    
    for (const dist in allSegments) {
        allSegments[dist].sort((a, b) => a.durationSec - b.durationSec);
        totalSegments += allSegments[dist].length;
        if (allSegments[dist].length > 0) {
            availableDistances.push(`${dist}km`);
            console.log(`🏆 ${dist}km: ${allSegments[dist].length} segmenten`);
        }
    }

    console.log(`📈 Rangschikking samenvatting: ${processedCount} ritten verwerkt, ${errorCount} fouten, ${totalSegments} segmenten totaal`);
    console.log(`🎯 Beschikbare afstanden: ${availableDistances.join(', ')}`);

    allSegmentsCache = allSegments;
    return allSegments;
}

// Toon rangschikking voor een specifieke afstand
async function showRankings(distance) {
    const resultsContainer = document.getElementById('rankingsResults');
    
    resultsContainer.innerHTML = `
        <div class="no-rankings">
            <div style="font-size: 3rem; margin-bottom: 20px; opacity: 0.5;">🔍</div>
            <h4>Ranglijsten worden berekend...</h4>
            <p>Even geduld, dit kan even duren bij veel ritten</p>
        </div>
    `;

    try {
        if (!allSegmentsCache) {
            console.log('🔄 Cache leeg, bereken alle segmenten...');
            await calculateAllSegments();
        }

        const segments = allSegmentsCache[distance];
        
        if (!segments || segments.length === 0) {
            resultsContainer.innerHTML = `
                <div class="no-rankings">
                    <p>❌ Geen ${distance} km segmenten gevonden</p>
                    <p><small>Mogelijke oorzaken:</small></p>
                    <ul style="text-align: left; margin: 10px 0; padding-left: 20px;">
                        <li>Ritten hebben onvoldoende afstand (minimaal ${distance} km nodig)</li>
                        <li>Geen GPS/tijd data in bestanden</li>
                        <li>Probleem met bestandsformaat</li>
                    </ul>
                    <p><small>Open browser console voor gedetailleerde logs</small></p>
                </div>
            `;
            return;
        }

        // Haal de huidige sortering op (standaard is 'date')
        const sortBy = document.getElementById('chartSortBy')?.value || 'date';
        
        // Toon rangschikking met grafiek
        let html = `
            <div class="rankings-chart-container">
                <div class="rankings-chart-header">
                    <h4>📊 Snelheidsverdeling - ${distance} km Segmenten</h4>
                    <div class="rankings-chart-filters">
                        <label>Toon top:</label>
                        <select id="chartTopLimit">
                            <option value="10">Top 10</option>
                            <option value="20">Top 20</option>
                            <option value="50" selected>Top 50</option>
                            <option value="100">Top 100</option>
                            <option value="0">Alle</option>
                        </select>
                        <label>Sorteer op:</label>
                        <select id="chartSortBy">
                            <option value="date">Datum</option>
                            <option value="speed" selected>Snelheid</option>
                            <option value="elevation">Hoogtemeters</option>
                        </select>
                    </div>
                </div>
                <div class="rankings-chart-wrapper">
                    <canvas id="rankingsChart"></canvas>
                </div>
                <div class="rankings-legend">
                    <div class="legend-item">
                        <div class="legend-color" style="background: #3b82f6;"></div>
                        <span>Snelheid (km/u)</span>
                    </div>
                    ${sortBy === 'date' ? `
                    <div class="legend-item">
                        <div class="legend-color" style="background: #dc2626;"></div>
                        <span>Trendlijn</span>
                    </div>
                    ` : ''}
                    <div class="legend-item">
                        <div class="legend-color" style="background: #f59e0b;"></div>
                        <span>Gemiddeld</span>
                    </div>
                </div>
            </div>

            <div class="rankings-stats">
                <div class="ranking-stat-card">
                    <div class="ranking-stat-value">${segments.length}</div>
                    <div class="ranking-stat-label">Totaal Segmenten</div>
                </div>
                <div class="ranking-stat-card">
                    <div class="ranking-stat-value">${calculateAverageSpeed(segments).toFixed(1)}</div>
                    <div class="ranking-stat-label">Gem. Snelheid</div>
                </div>
                <div class="ranking-stat-card">
                    <div class="ranking-stat-value">${segments[0]?.avgKmh?.toFixed(1) || '0'}</div>
                    <div class="ranking-stat-label">Beste Snelheid</div>
                </div>
                <div class="ranking-stat-card">
                <div class="ranking-stat-value">${calculateAverageElevation(segments)}</div>
                <div class="ranking-stat-label">Gem. Hoogte</div>
            </div>
            </div>

            <div style="margin: 25px 0; padding: 15px; background: var(--success-color); color: white; border-radius: 8px; text-align: center;">
    ✅ ${segments.length} ${distance} km segmenten gevonden - Toont ${sortBy === 'date' ? 'op datum (oud → nieuw)' : sortBy === 'speed' ? 'op snelheid (langzaam → snel)' : 'op hoogtemeters (weinig → veel)'}
</div>

        `;

        // Voeg MSE analyse toe (alleen voor datum-sortering)
        if (sortBy === 'date') {
            const regression = calculateLinearRegression(segments, 'date');
            if (regression) {
                html += `
                    <div class="mse-analysis">
                        <div class="mse-stats">
                            <h5>📈 Trendanalyse (Op Datum)</h5>
                            <div class="mse-grid">
                                <div class="mse-stat">
                                    <span class="mse-label">Trendvergelijking:</span>
                                    <span class="mse-value">${regression.equation}</span>
                                </div>
                                <div class="mse-stat">
                                    <span class="mse-label">R² (verklaarde variantie):</span>
                                    <span class="mse-value">${regression.rSquared.toFixed(4)}</span>
                                </div>
                                <div class="mse-stat">
                                    <span class="mse-label">Helling (km/u per dag):</span>
                                    <span class="mse-value">${regression.slope.toFixed(4)}</span>
                                </div>
                                <div class="mse-stat">
                                    <span class="mse-label">Startpunt (oudste rit):</span>
                                    <span class="mse-value">${regression.intercept.toFixed(1)} km/u</span>
                                </div>
                            </div>
                            <div class="mse-explanation">
                                <p><strong>Interpretatie:</strong> De trendlijn laat zien hoe je snelheid zich ontwikkelt over tijd.</p>
                                <p>${regression.slope > 0 ? 
                                    `📈 <strong>Positieve trend (+${regression.slope.toFixed(3)} km/u per dag)</strong> - Je snelheid verbetert over tijd!` : 
                                    regression.slope < 0 ? 
                                    `📉 <strong>Negatieve trend (${regression.slope.toFixed(3)} km/u per dag)</strong> - Je snelheid neemt af over tijd.` :
                                    `➡️ <strong>Stabiele trend</strong> - Je snelheid blijft constant over tijd.`
                                }</p>
                                <p>R² = ${regression.rSquared.toFixed(3)} betekent dat ${(regression.rSquared * 100).toFixed(1)}% 
                                van de snelheidsverschillen verklaard wordt door het tijdsverloop.</p>
                            </div>
                        </div>
                    </div>
                `;
            }
        }

        // Voeg de tabel toe
        html += `
            <table class="ranking-table">
                <thead>
                    <tr>
                        <th style="width: 60px">#</th>
                        <th>Rit</th>
                        <th style="width: 100px">Snelheid</th>
                        <th style="width: 120px">Tijd</th>
                        <th style="width: 100px">Datum</th>
                        <th style="width: 120px">Acties</th>
                    </tr>
                </thead>
                <tbody>
        `;

        // Sorteer segments voor de tabel weergave
        let tableSegments = [...segments].sort((a, b) => b.avgKmh - a.avgKmh);

        tableSegments.slice(0, 50).forEach((segment, index) => {
            const rank = index + 1;
            const dateStr = segment.rideDate ? 
                new Date(segment.rideDate).toLocaleDateString('nl-NL') : 'Onbekend';
            
            const performanceClass = getPerformanceClass(segment.avgKmh, segments);
            
            html += `
                <tr class="rank-${rank <= 3 ? rank : ''}">
                    <td>
                        <div class="rank-badge">${rank}</div>
                    </td>
                    <td>
                        <div class="file-name">${segment.fileName}</div>
                    </td>
                    <td>
                        <span class="speed-value">${segment.avgKmh?.toFixed(1) || '0'} km/u</span>
                        <span class="performance-badge ${performanceClass}">${getPerformanceLabel(segment.avgKmh, segments)}</span>
                    </td>
                    <td>
                        <span class="duration-value">${formatDuration(segment.durationSec)}</span>
                    </td>
                    <td>
                        <span class="ride-date">${dateStr}</span>
                    </td>
                    <td>
                        <div class="ranking-actions">
                            <button onclick="loadRankingActivity('${segment.activityId}')" title="Rit openen">
                                📂
                            </button>
                            <button onclick="highlightRankingSegment('${segment.activityId}', ${distance})" title="Segment markeren">
                                🔍
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        });

        html += `
                </tbody>
            </table>
            <div style="margin-top: 15px; text-align: center; color: var(--text-secondary); font-size: 0.9rem;">
                Toont ${Math.min(tableSegments.length, 50)} van ${tableSegments.length} segmenten - gesorteerd op snelheid (snelste eerst)            </div>
        `;

        resultsContainer.innerHTML = html;

        // Maak de chart aan
        setTimeout(() => {
            createRankingsChart(segments, distance);
        }, 100);

        // Voeg event listeners toe voor filters
        const topLimitSelect = document.getElementById('chartTopLimit');
        const sortBySelect = document.getElementById('chartSortBy');
        
        if (topLimitSelect) {
            topLimitSelect.addEventListener('change', () => updateRankingsChart(segments, distance));
        }
        if (sortBySelect) {
            sortBySelect.addEventListener('change', () => updateRankingsChart(segments, distance));
        }

    } catch (error) {
        console.error('💥 Fout bij tonen rangschikking:', error);
        resultsContainer.innerHTML = `
            <div class="no-rankings">
                <p>❌ Fout bij berekenen rangschikking</p>
                <p><small>${error.message}</small></p>
                <p><small>Open browser console voor details</small></p>
            </div>
        `;
    }
}

// Rangschikking hulpfuncties
function calculateAverageElevation(segments) {
    if (!segments.length) return '0';
    const total = segments.reduce((sum, segment) => {
        return sum + (segment.originalActivity?.summary?.elevationGain || 0);
    }, 0);
    return Math.round(total / segments.length);
}

function createRankingsChart(segments, distance) {
    const ctx = document.getElementById('rankingsChart')?.getContext('2d');
    if (!ctx) return;

    // Vernietig bestaande chart
    if (rankingsChart && typeof rankingsChart.destroy === 'function') {
        rankingsChart.destroy();
    }

    const topLimit = parseInt(document.getElementById('chartTopLimit')?.value || '50');
    const sortBy = document.getElementById('chartSortBy')?.value || 'speed';
    
    // ALTIJD sorteren op snelheid (snelste eerst) voor de echte ranking
    let displaySegments = [...segments].sort((a, b) => b.avgKmh - a.avgKmh);
    
    // Bereken lineaire regressie (alleen voor datum sortering)
    const regression = sortBy === 'date' ? calculateLinearRegression(displaySegments) : null;
    
    // Beperk aantal weergave VOOR sortering (zodat we de beste houden)
    let limitedSegments = displaySegments;
    if (topLimit > 0) {
        limitedSegments = displaySegments.slice(0, topLimit);
    }

    // Pas sortering toe voor weergave op de beperkte set
    if (sortBy === 'date') {
        limitedSegments.sort((a, b) => {
            const dateA = a.rideDate ? new Date(a.rideDate) : new Date(0);
            const dateB = b.rideDate ? new Date(b.rideDate) : new Date(0);
            return dateA - dateB;
        });
    } else if (sortBy === 'speed') {
        // Keer de volgorde om zodat snelste rechts staat (langzaam -> snel)
        limitedSegments.reverse();
    } else if (sortBy === 'elevation') {
        // Sorteer op hoogtemeters (weinig -> veel)
        limitedSegments.sort((a, b) => {
            const elevA = a.originalActivity?.summary?.elevationGain || 0;
            const elevB = b.originalActivity?.summary?.elevationGain || 0;
            return elevA - elevB;
        });
    }

    if (limitedSegments.length === 0) {
        console.warn('Geen segmenten om weer te geven in de grafiek');
        return;
    }

    // Bepaal labels op basis van sortering
    let labels = [];
    if (sortBy === 'date') {
        labels = limitedSegments.map(segment => {
            return segment.rideDate ? 
                new Date(segment.rideDate).toLocaleDateString('nl-NL') : 'Onbekend';
        });
    } else if (sortBy === 'elevation') {
        // Voor hoogte: toon hoogtemeters in label
        labels = limitedSegments.map((segment, index) => {
            const elevation = segment.originalActivity?.summary?.elevationGain || 0;
            return `${elevation}m`;
        });
    } else {
        // Voor snelheid: gebruik ranking nummers van langzaam naar snel
        labels = limitedSegments.map((segment, index) => {
            const speedSorted = [...segments].sort((a, b) => b.avgKmh - a.avgKmh);
            const actualRank = speedSorted.findIndex(s => s.activityId === segment.activityId) + 1;
            return `#${actualRank}`;
        });
    }
    
    const speeds = limitedSegments.map(segment => segment.avgKmh);
    const averageSpeed = calculateAverageSpeed(limitedSegments);
    
    // Bepaal kleuren op basis van ECHTE snelheidsranking (niet weergave ranking)
    const backgroundColors = limitedSegments.map((segment) => {
        const speedSorted = [...segments].sort((a, b) => b.avgKmh - a.avgKmh);
        const actualRank = speedSorted.findIndex(s => s.activityId === segment.activityId) + 1;
        
        if (actualRank === 1) return '#10b981';
        if (actualRank === 2) return '#22c55e';  
        if (actualRank === 3) return '#16a34a';
        if (actualRank <= 10) return '#2563eb';
        if (actualRank <= 20) return '#3b82f6';
        return '#60a5fa';
    });

    // Bepaal chart label op basis van sortering
    let chartLabel = `Snelheid (km/u) - ${distance}km`;
    if (sortBy === 'elevation') {
        chartLabel = `Snelheid vs Hoogte - ${distance}km`;
    }

    // Bereid datasets voor
    const datasets = [
        {
            label: chartLabel,
            data: speeds,
            backgroundColor: backgroundColors,
            borderColor: backgroundColors.map(color => {
                if (color === '#10b981') return '#059669';
                if (color === '#22c55e') return '#16a34a';
                if (color === '#16a34a') return '#15803d';
                if (color === '#2563eb') return '#1d4ed8';
                if (color === '#3b82f6') return '#2563eb';
                return '#3b82f6';
            }),
            borderWidth: 2,
            borderRadius: 6,
            borderSkipped: false,
        }
    ];

    // Voeg trendlijn toe alleen bij datum sortering
    if (sortBy === 'date' && regression && regression.rSquared > 0.1) {
        const trendlineData = regression.xValues.map(x => regression.slope * x + regression.intercept);
        
        datasets.push({
            label: `Trendlijn (${regression.equation})`,
            data: trendlineData,
            borderColor: '#dc2626',
            borderWidth: 3,
            borderDash: [5, 5],
            pointRadius: 0,
            fill: false,
            tension: 0,
            type: 'line'
        });
    }

    // Voeg gemiddelde lijn toe
    datasets.push({
        label: `Gemiddeld (${averageSpeed.toFixed(1)} km/u)`,
        data: new Array(limitedSegments.length).fill(averageSpeed),
        borderColor: '#f59e0b',
        borderWidth: 2,
        borderDash: [3, 3],
        pointRadius: 0,
        fill: false,
        tension: 0,
        type: 'line'
    });

    rankingsChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: {
                        boxWidth: 12,
                        padding: 15,
                        usePointStyle: true
                    }
                },
                tooltip: {
                    callbacks: {
                        title: (tooltipItems) => {
                            const index = tooltipItems[0].dataIndex;
                            const segment = limitedSegments[index];
                            const speedSorted = [...segments].sort((a, b) => b.avgKmh - a.avgKmh);
                            const actualRank = speedSorted.findIndex(s => s.activityId === segment.activityId) + 1;
                            const elevation = segment.originalActivity?.summary?.elevationGain || 0;
                            
                            let rankText = '';
                            if (actualRank === 1) rankText = '🥇 1e plaats';
                            else if (actualRank === 2) rankText = '🥈 2e plaats';
                            else if (actualRank === 3) rankText = '🥉 3e plaats';
                            else rankText = `#${actualRank}`;
                            
                            if (sortBy === 'elevation') {
                                return `${rankText} - ${segment.fileName} (${elevation}m)`;
                            }
                            return `${rankText} - ${segment.fileName}`;
                        },
                        label: (context) => {
                            const segment = limitedSegments[context.dataIndex];
                            const elevation = segment.originalActivity?.summary?.elevationGain || 0;
                            
                            // Voor trendlijn en gemiddelde lijn, toon andere informatie
                            if (context.datasetIndex > 0) {
                                if (context.dataset.datasetType === 'trendline') {
                                    return [
                                        `Trendlijn: ${context.parsed.y.toFixed(1)} km/u`,
                                        `Vergelijking: ${regression.equation}`,
                                        `R²: ${regression.rSquared.toFixed(3)}`
                                    ];
                                } else if (context.dataset.datasetType === 'average') {
                                    return `Gemiddelde: ${context.parsed.y.toFixed(1)} km/u`;
                                }
                                return context.dataset.label || '';
                            }
                            
                            // Voor de hoofd dataset (snelheden)
                            const labels = [
                                `Snelheid: ${segment.avgKmh?.toFixed(1)} km/u`,
                                `Tijd: ${formatDuration(segment.durationSec)}`,
                                `Datum: ${segment.rideDate ? new Date(segment.rideDate).toLocaleDateString('nl-NL') : 'Onbekend'}`
                            ];
                            
                            if (sortBy === 'elevation') {
                                labels.splice(1, 0, `Hoogtemeters: ${elevation} m`);
                            }
                            
                            return labels;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: false,
                    title: {
                        display: true,
                        text: 'Snelheid (km/u)',
                        font: {
                            size: 13,
                            weight: 'bold'
                        }
                    },
                    grid: {
                        color: 'rgba(0,0,0,0.05)'
                    },
                    min: Math.max(0, Math.min(...speeds) - 2),
                    ticks: {
                        font: {
                            size: 11
                        }
                    }
                },
                x: {
                    title: {
                        display: true,
                        text: getXAxisTitle(sortBy),
                        font: {
                            size: 13,
                            weight: 'bold'
                        }
                    },
                    grid: {
                        display: false
                    },
                    ticks: {
                        font: {
                            size: sortBy === 'date' ? 10 : 11,
                            maxRotation: sortBy === 'date' ? 45 : 0
                        }
                    }
                }
            },
            interaction: {
                intersect: false,
                mode: 'index'
            },
            animation: {
                duration: 1000,
                easing: 'easeOutQuart'
            }
        }
    });

    // Update de legenda om trendlijn te tonen
    updateRankingsLegend(sortBy, regression);
}

function updateRankingsLegend(sortBy, regression) {
    const legendContainer = document.querySelector('.rankings-legend');
    if (!legendContainer) return;

    let legendHTML = `
        <div class="legend-item">
            <div class="legend-color" style="background: #3b82f6;"></div>
            <span>Snelheid (km/u)</span>
        </div>
    `;

    if (sortBy === 'date' && regression) {
        legendHTML += `
            <div class="legend-item">
                <div class="legend-color" style="background: #dc2626;"></div>
                <span>Trendlijn</span>
            </div>
        `;
    }

    legendHTML += `
        <div class="legend-item">
            <div class="legend-color" style="background: #f59e0b;"></div>
            <span>Gemiddeld</span>
        </div>
    `;

    legendContainer.innerHTML = legendHTML;
}

function updateRankingsChart(segments, distance) {
    const sortBy = document.getElementById('chartSortBy')?.value || 'speed';
    createRankingsChart(segments, distance);
    
    // Update ook de MSE analyse (alleen voor datum-sortering)
    if (sortBy === 'date') {
        addMSEToRankingDetails(segments, sortBy);
    }
}

function calculateAverageSpeed(segments) {
    if (!segments.length) return 0;
    const total = segments.reduce((sum, segment) => sum + segment.avgKmh, 0);
    return total / segments.length;
}

function getPerformanceClass(speed, segments) {
    const maxSpeed = Math.max(...segments.map(s => s.avgKmh));
    const percentage = (speed / maxSpeed) * 100;
    
    if (percentage >= 90) return 'performance-excellent';
    if (percentage >= 75) return 'performance-good';
    return 'performance-average';
}

function getPerformanceLabel(speed, segments) {
    const maxSpeed = Math.max(...segments.map(s => s.avgKmh));
    const percentage = (speed / maxSpeed) * 100;
    
    if (percentage >= 90) return 'Excellent';
    if (percentage >= 75) return 'Goed';
    return 'Gemiddeld';
}

// Laad een rangschikkingsactiviteit
async function loadRankingActivity(activityId) {
    const activity = await getActivityFromDB(activityId);
    const text = await activity.fileBlob.text();
    await analyzeText(text, activity.fileBlob, activity.fileName);
    
    const chartsTab = document.querySelector('[data-tab="charts"]');
    if (chartsTab) chartsTab.click();
}

// Markeer een rangschikkingssegment
async function highlightRankingSegment(activityId, distance) {
    const activity = await getActivityFromDB(activityId);
    const text = await activity.fileBlob.text();
    await analyzeText(text, activity.fileBlob, activity.fileName);
    
    setTimeout(() => {
        const targetMeters = distance * 1000;
        const segments = computeFastestSegments(currentAnalysis.trackpoints, currentAnalysis.cumDist, [targetMeters]);
        
        if (segments[0]) {
            const startDistanceKm = currentAnalysis.cumDist[segments[0].startIdx] / 1000;
            const endDistanceKm = currentAnalysis.cumDist[segments[0].endIdx] / 1000;
            highlightSegmentInChart(startDistanceKm, endDistanceKm, distance, true);
            
            // Markeer ook de rij in de tabel
            document.querySelectorAll('.table-row-selected').forEach(row => {
                row.classList.remove('table-row-selected');
            });
            
            const fastestTableBody = document.querySelector('#fastestTableBody');
            if (fastestTableBody) {
                const rows = fastestTableBody.querySelectorAll('tr');
                for (const row of rows) {
                    if (row.textContent.includes(`${distance} km`)) {
                        row.classList.add('table-row-selected');
                        break;
                    }
                }
            }
            
            showTemporaryMessage(`${distance} km segment gemarkeerd (${segments[0].avgKmh.toFixed(1)} km/u)`);
        }
    }, 500);
    
    const chartsTab = document.querySelector('[data-tab="charts"]');
    if (chartsTab) chartsTab.click();
}

// Initialiseer rangschikking
function initRankings() {
    const rankingsDistance = document.getElementById('rankingsDistance');
    const refreshRankings = document.getElementById('refreshRankings');
    const chartSortBy = document.getElementById('chartSortBy');
    
    // Zet datum als default waarde in de dropdown
    if (chartSortBy) {
        chartSortBy.value = 'date';
    }
    
    if (rankingsDistance && refreshRankings) {
        // Laad direct met datum sortering
        showRankings('5');
        
        rankingsDistance.addEventListener('change', (e) => {
            showRankings(e.target.value);
        });
        
        refreshRankings.addEventListener('click', async () => {
            allSegmentsCache = null;
            await calculateAllSegments();
            showRankings(rankingsDistance.value);
        });
    }
}

// Hulpfuncties voor rangschikking
function getXAxisTitle(sortBy) {
    const titles = {
        'date': 'Datum (oud → nieuw)',
        'speed': 'Ranking Positie (langzaam → snel)',
        'elevation': 'Ranking Positie (weinig → veel hoogte)'
    };
    return titles[sortBy] || 'Ranking Positie';
}

function calculateLinearRegression(segments) {
    if (!segments || segments.length === 0) {
        console.log('Geen segments voor regressie');
        return null;
    }
    
    // Filter segments met geldige datums en snelheden
    const validSegments = segments.filter(segment => {
        const hasDate = segment.rideDate && !isNaN(new Date(segment.rideDate).getTime());
        const hasSpeed = segment.avgKmh && segment.avgKmh > 0;
        return hasDate && hasSpeed;
    });
    
    console.log(`Regressie: ${validSegments.length} van ${segments.length} segments zijn geldig`);
    
    if (validSegments.length < 2) {
        console.log('Te weinig geldige segments voor regressie');
        return null;
    }
    
    // Sorteer op datum (oud naar nieuw)
    validSegments.sort((a, b) => {
        const dateA = new Date(a.rideDate);
        const dateB = new Date(b.rideDate);
        return dateA - dateB;
    });
    
    // Converteer datums naar dagen sinds eerste datum
    const firstDate = new Date(validSegments[0].rideDate).getTime();
    const xValues = validSegments.map(segment => 
        (new Date(segment.rideDate).getTime() - firstDate) / (1000 * 60 * 60 * 24) // dagen
    );
    
    const yValues = validSegments.map(segment => segment.avgKmh);
    
    // Bereken gemiddelden
    const xMean = xValues.reduce((a, b) => a + b, 0) / validSegments.length;
    const yMean = yValues.reduce((a, b) => a + b, 0) / validSegments.length;
    
    // Bereken helling (a) en intercept (b)
    let numerator = 0;
    let denominator = 0;
    
    for (let i = 0; i < validSegments.length; i++) {
        numerator += (xValues[i] - xMean) * (yValues[i] - yMean);
        denominator += Math.pow(xValues[i] - xMean, 2);
    }
    
    const slope = denominator !== 0 ? numerator / denominator : 0;
    const intercept = yMean - slope * xMean;
    
    // Bereken R²
    let ssTotal = 0;
    let ssResidual = 0;
    
    for (let i = 0; i < validSegments.length; i++) {
        const yPred = slope * xValues[i] + intercept;
        ssTotal += Math.pow(yValues[i] - yMean, 2);
        ssResidual += Math.pow(yValues[i] - yPred, 2);
    }
    
    const rSquared = ssTotal !== 0 ? 1 - (ssResidual / ssTotal) : 0;
    
    // Formatteer vergelijking
    const equation = `y = ${slope >= 0 ? '+' : ''}${slope.toFixed(4)}·dagen + ${intercept.toFixed(1)}`;
    
    console.log('Regressie resultaat:', {
        slope,
        intercept,
        rSquared,
        equation,
        validSegments: validSegments.length
    });
    
    return {
        slope: slope,
        intercept: intercept,
        rSquared: rSquared,
        equation: equation,
        xValues: xValues,
        firstDate: firstDate,
        validSegments: validSegments
    };
}

function addMSEToRankingDetails(segments, sortBy = 'date') {
    const regression = calculateLinearRegression(segments, sortBy);
    
    if (!regression) {
        console.log('Geen geldige regressie mogelijk (te weinig datums)');
        return;
    }
    
    const analysisContainer = document.createElement('div');
    analysisContainer.className = 'mse-analysis';
    analysisContainer.innerHTML = `
        <div class="mse-stats">
            <h5>📈 Trendanalyse (Op Datum)</h5>
            <div class="mse-grid">
                <div class="mse-stat">
                    <span class="mse-label">Trendvergelijking:</span>
                    <span class="mse-value">${regression.equation}</span>
                </div>
                <div class="mse-stat">
                    <span class="mse-label">R² (verklaarde variantie):</span>
                    <span class="mse-value">${regression.rSquared.toFixed(4)}</span>
                </div>
                <div class="mse-stat">
                    <span class="mse-label">Helling (km/u per dag):</span>
                    <span class="mse-value">${regression.slope.toFixed(4)}</span>
                </div>
                <div class="mse-stat">
                    <span class="mse-label">Startpunt (oudste rit):</span>
                    <span class="mse-value">${regression.intercept.toFixed(1)} km/u</span>
                </div>
            </div>
            <div class="mse-explanation">
                <p><strong>Interpretatie:</strong> De trendlijn laat zien hoe je snelheid zich ontwikkelt over tijd.</p>
                <p>${regression.slope > 0 ? 
                    `📈 <strong>Positieve trend (+${regression.slope.toFixed(3)} km/u per dag)</strong> - Je snelheid verbetert over tijd!` : 
                    regression.slope < 0 ? 
                    `📉 <strong>Negatieve trend (${regression.slope.toFixed(3)} km/u per dag)</strong> - Je snelheid neemt af over tijd.` :
                    `➡️ <strong>Stabiele trend</strong> - Je snelheid blijft constant over tijd.`
                }</p>
                <p>R² = ${regression.rSquared.toFixed(3)} betekent dat ${(regression.rSquared * 100).toFixed(1)}% 
                van de snelheidsverschillen verklaard wordt door het tijdsverloop.</p>
            </div>
        </div>
    `;
    
    const resultsContainer = document.getElementById('rankingsResults');
    if (resultsContainer) {
        const existingMSE = resultsContainer.querySelector('.mse-analysis');
        if (existingMSE) {
            existingMSE.remove();
        }
        resultsContainer.insertBefore(analysisContainer, resultsContainer.querySelector('.rankings-stats'));
    }
}