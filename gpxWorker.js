self.onmessage = function(e) {
    const { xmlString, fileName, isExistingRide } = e.data;
    // Roep je eigen paring functie aan (die nu in de worker staat)
    const result = parseGPXData(xmlString, fileName, isExistingRide);
    self.postMessage(result);
};