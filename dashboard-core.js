const METRIC_PROFILES = {
    cases: {
        family: 'flow',
        defaultMode: 'interval',
        levelLabel: 'Cumulative cases',
        intervalLabel: 'New cases'
    },
    deaths: {
        family: 'flow',
        defaultMode: 'interval',
        levelLabel: 'Cumulative deaths',
        intervalLabel: 'New deaths'
    },
    hospitalizations: {
        family: 'stock',
        defaultMode: 'level',
        levelLabel: 'Active hospitalizations',
        intervalLabel: 'Change in active hospitalizations'
    },
    icu: {
        family: 'stock',
        defaultMode: 'level',
        levelLabel: 'Active ICU hospitalizations',
        intervalLabel: 'Change in active ICU hospitalizations'
    },
    hosp_admissions: {
        family: 'flow',
        defaultMode: 'interval',
        levelLabel: 'Cumulative hospital admissions',
        intervalLabel: 'Hospital admissions'
    },
    icu_admissions: {
        family: 'flow',
        defaultMode: 'interval',
        levelLabel: 'Cumulative ICU admissions',
        intervalLabel: 'ICU admissions'
    },
    tests_completed: {
        family: 'flow',
        defaultMode: 'interval',
        levelLabel: 'Cumulative tests completed',
        intervalLabel: 'Tests completed'
    },
    vaccine_coverage_dose_1: coverageProfile('First-dose vaccine coverage'),
    vaccine_coverage_dose_2: coverageProfile('Second-dose vaccine coverage'),
    vaccine_coverage_dose_3: coverageProfile('Third-dose vaccine coverage'),
    vaccine_coverage_dose_4: coverageProfile('Fourth-dose vaccine coverage'),
    vaccine_administration_total_doses: administrationProfile(
        'Cumulative vaccine doses administered',
        'Vaccine doses administered'
    ),
    vaccine_administration_dose_1: administrationProfile(
        'Cumulative first vaccine doses administered',
        'First vaccine doses administered'
    ),
    vaccine_administration_dose_2: administrationProfile(
        'Cumulative second vaccine doses administered',
        'Second vaccine doses administered'
    ),
    vaccine_administration_dose_3: administrationProfile(
        'Cumulative third vaccine doses administered',
        'Third vaccine doses administered'
    ),
    vaccine_administration_dose_4: administrationProfile(
        'Cumulative fourth vaccine doses administered',
        'Fourth vaccine doses administered'
    ),
    vaccine_administration_dose_5plus: administrationProfile(
        'Cumulative fifth-or-later vaccine doses administered',
        'Fifth-or-later vaccine doses administered'
    ),
    vaccine_distribution_total_doses: {
        family: 'flow',
        defaultMode: 'interval',
        levelLabel: 'Cumulative vaccine doses distributed',
        intervalLabel: 'Vaccine doses distributed'
    }
};

function coverageProfile(label) {
    return {
        family: 'coverage',
        defaultMode: 'level',
        levelLabel: label,
        intervalLabel: `Change in ${label.toLowerCase()}`
    };
}

function administrationProfile(levelLabel, intervalLabel) {
    return {
        family: 'flow',
        defaultMode: 'interval',
        levelLabel,
        intervalLabel
    };
}

const GEOGRAPHY_LEVELS = ['can', 'pt', 'hr'];

export function metricProfile(metric) {
    const profile = METRIC_PROFILES[metric];
    if (!profile) {
        throw new Error(`No metric profile is defined for "${metric}".`);
    }
    return profile;
}

function metricAvailableAtLevel(metricMetadata, level) {
    const value = metricMetadata?.geo?.[level];
    return typeof value === 'string' && value.toLowerCase() !== 'na';
}

export function availableLevels(metricMetadata) {
    return GEOGRAPHY_LEVELS.filter(level => metricAvailableAtLevel(metricMetadata, level));
}

export function datasetPath(metric, level, metricMetadata) {
    if (!metricAvailableAtLevel(metricMetadata, level)) {
        return null;
    }
    if (!GEOGRAPHY_LEVELS.includes(level)) {
        throw new Error(`Unknown geography level "${level}".`);
    }

    const filename = metric === 'vaccine_distribution_total_doses'
        ? `${metric}.csv`
        : `${metric}_${level}.csv`;
    return `data/${level}/${filename}`;
}

export function makeGeography(level, region, subRegion = null) {
    if (!GEOGRAPHY_LEVELS.includes(level)) {
        throw new Error(`Unknown geography level "${level}".`);
    }
    const normalizedRegion = String(region || '').toUpperCase();
    if (!normalizedRegion) {
        throw new Error('A region code is required.');
    }
    if (level === 'hr' && (subRegion === null || String(subRegion) === '')) {
        throw new Error('A health-region identifier is required.');
    }
    return {
        level,
        region: level === 'can' ? 'CAN' : normalizedRegion,
        subRegion: level === 'hr' ? String(subRegion) : null
    };
}

export function geographyKey(geography) {
    const normalized = makeGeography(
        geography.level,
        geography.region,
        geography.subRegion
    );
    return normalized.level === 'hr'
        ? `hr:${normalized.region}:${normalized.subRegion}`
        : `${normalized.level}:${normalized.region}`;
}

export function parseGeographyKey(key) {
    const [level, region, subRegion, ...extra] = String(key).split(':');
    if (extra.length || (level === 'hr' && subRegion === undefined)) {
        throw new Error(`Invalid geography key "${key}".`);
    }
    return makeGeography(level, region, subRegion ?? null);
}

function geographyFromRow(row, level) {
    if (level === 'can') {
        return makeGeography('can', 'CAN');
    }
    if (level === 'pt') {
        return makeGeography('pt', row.region);
    }
    return makeGeography('hr', row.region, row.sub_region_1);
}

export function groupRowsByGeography(rows, level) {
    const groups = new Map();
    for (const row of rows) {
        let geography;
        try {
            geography = geographyFromRow(row, level);
        } catch {
            continue;
        }
        const key = geographyKey(geography);
        if (!groups.has(key)) {
            groups.set(key, []);
        }
        groups.get(key).push(row);
    }
    return groups;
}

export function metricModeLabel(metric, mode, cadence = 'daily') {
    const profile = metricProfile(metric);
    if (mode === 'level') {
        return cadence === 'weekly'
            ? `Weekly ${lowercaseFirst(profile.levelLabel)}`
            : profile.levelLabel;
    }
    if (mode !== 'interval') {
        throw new Error(`Unknown value mode "${mode}".`);
    }
    const prefix = cadence === 'weekly' ? 'Weekly' : 'Daily';
    return `${prefix} ${lowercaseFirst(profile.intervalLabel)}`;
}

export function allowsNegative(metric, mode) {
    const profile = metricProfile(metric);
    return mode === 'interval' && ['stock', 'coverage'].includes(profile.family);
}

export function sanitizeValue(rawValue, metric, mode) {
    const result = sanitizeValueWithReason(rawValue, metric, mode);
    return result.value;
}

function sanitizeValueWithReason(rawValue, metric, mode) {
    if (rawValue === null || rawValue === undefined || String(rawValue).trim() === '') {
        return {value: null, reason: 'missing'};
    }
    const value = typeof rawValue === 'number' ? rawValue : Number(rawValue);
    if (!Number.isFinite(value)) {
        return {value: null, reason: 'non-finite'};
    }
    if (value < 0 && !allowsNegative(metric, mode)) {
        return {value: null, reason: 'negative'};
    }
    if (metricProfile(metric).family === 'coverage' && mode === 'level' && value > 100) {
        return {value: null, reason: 'out-of-range'};
    }
    return {value, reason: null};
}

export function buildSeries(rows, metric, mode, cadence = 'daily') {
    const byDate = new Map();
    const diagnostics = {
        missing: 0,
        nonFinite: 0,
        negative: 0,
        outOfRange: 0,
        invalidDate: 0
    };

    for (const row of rows) {
        if (!isDateString(row.date)) {
            diagnostics.invalidDate += 1;
            continue;
        }
        const level = sanitizeValueWithReason(row.value, metric, 'level');
        const interval = sanitizeValueWithReason(row.value_daily, metric, 'interval');
        const selected = mode === 'level' ? level : interval;
        if (selected.reason) {
            const key = selected.reason === 'non-finite'
                ? 'nonFinite'
                : selected.reason === 'out-of-range'
                    ? 'outOfRange'
                    : selected.reason;
            diagnostics[key] += 1;
        }
        byDate.set(row.date, {
            date: row.date,
            level: level.value,
            interval: interval.value
        });
    }

    const observations = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
    const points = cadence === 'weekly'
        ? aggregateWeekly(observations, metric, mode)
        : observations.map(row => ({date: row.date, value: row[mode]}));

    return {points, diagnostics};
}

export function rollingAverage(values, windowSize = 7) {
    if (!Number.isInteger(windowSize) || windowSize < 1) {
        throw new Error('Rolling-average window must be a positive integer.');
    }
    return values.map((_, index) => {
        const start = Math.max(0, index - windowSize + 1);
        const window = values.slice(start, index + 1);
        if (window.some(value => !Number.isFinite(value))) {
            return null;
        }
        return window.reduce((sum, value) => sum + value, 0) / window.length;
    });
}

export function rollingAveragePoints(points, windowSize = 7) {
    const values = rollingAverage(points.map(point => point.value), windowSize);
    return points.map((point, index) => {
        const start = Math.max(0, index - windowSize + 1);
        const dates = points.slice(start, index + 1).map(item => item.date);
        const consecutive = dates.every((date, dateIndex) => (
            dateIndex === 0 || daysBetween(dates[dateIndex - 1], date) === 1
        ));
        return {
            date: point.date,
            value: consecutive ? values[index] : null
        };
    });
}

export function weekEndingSunday(dateString) {
    if (!isDateString(dateString)) {
        throw new Error(`Invalid date "${dateString}".`);
    }
    const date = new Date(`${dateString}T00:00:00Z`);
    const daysUntilSunday = (7 - date.getUTCDay()) % 7;
    date.setUTCDate(date.getUTCDate() + daysUntilSunday);
    return date.toISOString().slice(0, 10);
}

export function aggregateWeekly(observations, metric, mode) {
    const weeks = new Map();
    for (const observation of observations) {
        const week = weekEndingSunday(observation.date);
        if (!weeks.has(week)) {
            weeks.set(week, []);
        }
        weeks.get(week).push(observation);
    }

    if (mode === 'level') {
        return [...weeks].map(([date, rows]) => ({
            date,
            value: lastFinite(rows.map(row => row.level))
        }));
    }

    const profile = metricProfile(metric);
    if (profile.family === 'stock' || profile.family === 'coverage') {
        let previousEndpoint = null;
        return [...weeks].map(([date, rows]) => {
            const endpoint = lastFinite(rows.map(row => row.level));
            const value = endpoint === null || previousEndpoint === null
                ? null
                : endpoint - previousEndpoint;
            if (endpoint !== null) {
                previousEndpoint = endpoint;
            }
            return {date, value};
        });
    }

    return [...weeks].map(([date, rows]) => {
        const values = rows.map(row => row.interval);
        return {
            date,
            value: values.some(value => !Number.isFinite(value))
                ? null
                : values.reduce((sum, value) => sum + value, 0)
        };
    });
}

function normalizeDataNotes(dataNotes) {
    if (!dataNotes || typeof dataNotes !== 'object') {
        return {};
    }
    return Object.fromEntries(Object.entries(dataNotes).map(([key, notes]) => [
        key.toLowerCase(),
        Array.isArray(notes) ? notes : [notes]
    ]));
}

export function dataNotesForGeographies(metricMetadata, geographies) {
    const notesByScope = normalizeDataNotes(metricMetadata?.data_notes);
    const scopes = new Set();
    for (const geography of geographies) {
        if (geography.level === 'can') {
            scopes.add('can');
        } else {
            scopes.add(geography.level);
            scopes.add(geography.region.toLowerCase());
        }
    }
    const seen = new Set();
    const result = [];

    for (const scope of scopes) {
        for (const note of notesByScope[scope] || []) {
            const signature = JSON.stringify([
                scope,
                note.date_start || '',
                note.date_end || '',
                note.note || '',
                note.source || ''
            ]);
            if (!seen.has(signature)) {
                seen.add(signature);
                result.push({...note, scope});
            }
        }
    }
    return result;
}

export function latestCompletenessDate(completeness, requiredRegions) {
    const dates = Object.entries(completeness || {})
        .filter(([, value]) => requiredRegions.every(region => value?.pt?.includes(region)))
        .map(([date]) => date)
        .filter(isDateString)
        .sort();
    return dates.at(-1) || null;
}

function lowercaseFirst(value) {
    if (!value || /^[A-Z]{2}/.test(value)) {
        return value;
    }
    return value[0].toLowerCase() + value.slice(1);
}

function lastFinite(values) {
    for (let index = values.length - 1; index >= 0; index -= 1) {
        if (Number.isFinite(values[index])) {
            return values[index];
        }
    }
    return null;
}

function isDateString(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
        return false;
    }
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function daysBetween(first, second) {
    const firstDate = new Date(`${first}T00:00:00Z`);
    const secondDate = new Date(`${second}T00:00:00Z`);
    return (secondDate - firstDate) / 86400000;
}
