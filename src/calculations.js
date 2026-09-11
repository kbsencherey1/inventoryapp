function calculateStatus(expectedQty, countedQty) {
  if (countedQty === null || countedQty === undefined || countedQty === '') {
    return 'NOT COUNTED';
  }
  const expected = Number(expectedQty);
  const counted = Number(countedQty);
  if (!Number.isFinite(counted)) return 'NOT COUNTED';
  if (counted === expected) return 'COMPLETE';
  return counted < expected ? 'SHORT' : 'EXCESS';
}

function normalizeCount(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function summarizeLines(lines) {
  return lines.reduce(
    (summary, line) => {
      const status = calculateStatus(line.expectedQty, line.countedQty);
      summary[status] += 1;
      if (status !== 'NOT COUNTED') {
        summary.expected += Number(line.expectedQty) || 0;
        summary.counted += Number(line.countedQty) || 0;
      }
      return summary;
    },
    { COMPLETE: 0, SHORT: 0, EXCESS: 0, 'NOT COUNTED': 0, expected: 0, counted: 0 }
  );
}

module.exports = { calculateStatus, normalizeCount, summarizeLines };
