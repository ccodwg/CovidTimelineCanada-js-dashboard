import {
    allowsNegative,
    availableLevels,
    buildSeries,
    dataNotesForGeographies,
    datasetPath,
    geographyKey,
    groupRowsByGeography,
    latestCompletenessDate,
    makeGeography,
    metricModeLabel,
    metricProfile,
    parseGeographyKey,
    rollingAveragePoints
} from './dashboard-core.js';

const UPSTREAM_RAW = 'https://raw.githubusercontent.com/ccodwg/CovidTimelineCanada/main';
const METADATA_URL = `${UPSTREAM_RAW}/docs/values/values.json`;
const PT_METADATA_URL = `${UPSTREAM_RAW}/geo/pt.csv`;
const HR_METADATA_URL = `${UPSTREAM_RAW}/geo/hr.csv`;
const COMPLETENESS_REGIONS = ['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'ON', 'PE', 'QC', 'SK'];
const COMPLETENESS_METRICS = new Set(['cases', 'deaths', 'tests_completed']);
const LEVEL_LABELS = {
    can: 'Canada',
    pt: 'Province or territory',
    hr: 'Health region'
};
const COLORS = ['#3366cc', '#dc3912', '#109618', '#990099', '#ff9900', '#0099c6', '#dd4477', '#66aa00'];
const FALLBACK_PT_NAMES = {
    AB: 'Alberta', BC: 'British Columbia', MB: 'Manitoba', NB: 'New Brunswick',
    NL: 'Newfoundland and Labrador', NS: 'Nova Scotia', NT: 'Northwest Territories',
    NU: 'Nunavut', ON: 'Ontario', PE: 'Prince Edward Island', QC: 'Quebec',
    SK: 'Saskatchewan', YT: 'Yukon'
};

const elements = {
    metric: document.getElementById('metric'),
    valueMode: document.getElementById('value-mode'),
    cadence: document.getElementById('cadence'),
    geographyLevel: document.getElementById('geography-level'),
    geography: document.getElementById('geography'),
    addGeography: document.getElementById('add-geography'),
    selectedGeographies: document.getElementById('selected-geographies'),
    selectionMessage: document.getElementById('selection-message'),
    chartMessage: document.getElementById('chart-message'),
    reportingStatus: document.getElementById('reporting-status'),
    metricDefinition: document.getElementById('metric-definition'),
    generalNotes: document.getElementById('general-notes'),
    jurisdictionNotes: document.getElementById('jurisdiction-notes')
};

const state = {
    metrics: {},
    metric: 'cases',
    mode: 'interval',
    cadence: 'daily',
    selections: [makeGeography('can', 'CAN')],
    ptNames: new Map(Object.entries(FALLBACK_PT_NAMES)),
    hrNames: new Map(),
    renderSequence: 0,
    controlsSequence: 0
};

const datasetCache = new Map();
const resourceCache = new Map();
const chart = echarts.init(document.getElementById('chart'));

class DataError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'DataError';
        this.code = code;
    }
}

async function initialize() {
    bindEvents();
    chart.showLoading();

    state.metrics = await fetchJson(METADATA_URL);
    await loadGeographyNames();

    populateMetricOptions();
    state.metric = elements.metric.value || Object.keys(state.metrics)[0];
    state.mode = metricProfile(state.metric).defaultMode;
    updateModeOptions();
    updateLevelOptions();
    await ensureValidSelections();
    renderSelectedGeographies();
    await updateGeographyOptions();
    renderNotes();
    await renderDashboard();
}

function bindEvents() {
    elements.metric.addEventListener('change', handleMetricChange);
    elements.valueMode.addEventListener('change', async () => {
        state.mode = elements.valueMode.value;
        renderNotes();
        await renderDashboard();
    });
    elements.cadence.addEventListener('change', async () => {
        state.cadence = elements.cadence.value;
        updateModeOptions();
        renderNotes();
        await renderDashboard();
    });
    elements.geographyLevel.addEventListener('change', updateGeographyOptions);
    elements.addGeography.addEventListener('click', addSelectedGeography);
    window.addEventListener('resize', () => chart.resize());
}

async function handleMetricChange() {
    const sequence = ++state.controlsSequence;
    setControlsDisabled(true);
    state.metric = elements.metric.value;
    state.mode = metricProfile(state.metric).defaultMode;
    updateModeOptions();
    updateLevelOptions();

    const removed = await ensureValidSelections();
    if (sequence !== state.controlsSequence) {
        return;
    }

    renderSelectedGeographies();
    await updateGeographyOptions();
    setControlsDisabled(false);
    if (removed.length) {
        setSelectionMessage(
            `${removed.map(geographyLabel).join(', ')} ${removed.length === 1 ? 'is' : 'are'} not available for ${state.metrics[state.metric].name_long}.`
        );
    }
    renderNotes();
    await renderDashboard();
}

function populateMetricOptions() {
    elements.metric.replaceChildren();
    for (const [metric, metadata] of Object.entries(state.metrics)) {
        const option = document.createElement('option');
        option.value = metric;
        option.textContent = metadata.name_long;
        option.selected = metric === state.metric;
        elements.metric.append(option);
    }
}

function updateModeOptions() {
    const selected = state.mode;
    elements.valueMode.replaceChildren();
    for (const mode of ['level', 'interval']) {
        const option = document.createElement('option');
        option.value = mode;
        option.textContent = metricModeLabel(state.metric, mode, state.cadence);
        option.selected = mode === selected;
        elements.valueMode.append(option);
    }
    elements.valueMode.value = selected;
}

function updateLevelOptions() {
    const levels = availableLevels(state.metrics[state.metric]);
    const previous = elements.geographyLevel.value;
    elements.geographyLevel.replaceChildren();
    for (const level of levels) {
        const option = document.createElement('option');
        option.value = level;
        option.textContent = LEVEL_LABELS[level];
        elements.geographyLevel.append(option);
    }
    elements.geographyLevel.value = levels.includes(previous) ? previous : levels[0];
}

async function updateGeographyOptions() {
    const sequence = ++state.controlsSequence;
    const level = elements.geographyLevel.value;
    elements.geography.replaceChildren(new Option('Loading…', ''));
    elements.geography.disabled = true;
    elements.addGeography.disabled = true;

    try {
        const options = await geographyOptions(state.metric, level);
        if (sequence !== state.controlsSequence || level !== elements.geographyLevel.value) {
            return;
        }
        elements.geography.replaceChildren();
        const selectedKeys = new Set(state.selections.map(geographyKey));
        const provinceGroups = new Map();
        for (const geography of options) {
            const key = geographyKey(geography);
            const selected = selectedKeys.has(key);
            const option = document.createElement('option');
            option.value = key;
            const optionLabel = level === 'hr' ? healthRegionName(geography) : geographyLabel(geography);
            option.textContent = `${optionLabel}${selected ? ' (selected)' : ''}`;
            option.disabled = selected;
            if (level === 'hr') {
                if (!provinceGroups.has(geography.region)) {
                    const group = document.createElement('optgroup');
                    group.label = state.ptNames.get(geography.region) || geography.region;
                    provinceGroups.set(geography.region, group);
                    elements.geography.append(group);
                }
                provinceGroups.get(geography.region).append(option);
            } else {
                elements.geography.append(option);
            }
        }
        const firstAvailable = [...elements.geography.options].find(option => !option.disabled);
        if (firstAvailable) {
            elements.geography.value = firstAvailable.value;
        } else if (options.length) {
            const placeholder = new Option('All regions at this level are selected', '');
            placeholder.selected = true;
            elements.geography.prepend(placeholder);
        }
        elements.geography.disabled = !firstAvailable;
        elements.addGeography.disabled = !firstAvailable;
        if (!options.length) {
            elements.geography.append(new Option('No regions available', ''));
        }
    } catch (error) {
        if (sequence !== state.controlsSequence) {
            return;
        }
        elements.geography.replaceChildren(new Option('Could not load regions', ''));
        setSelectionMessage(error.message, 'danger');
    }
}

async function addSelectedGeography() {
    if (!elements.geography.value) {
        return;
    }
    const geography = parseGeographyKey(elements.geography.value);
    const key = geographyKey(geography);
    if (state.selections.some(selection => geographyKey(selection) === key)) {
        setSelectionMessage(`${geographyLabel(geography)} is already selected.`);
        return;
    }
    state.selections.push(geography);
    setSelectionMessage('');
    renderSelectedGeographies();
    await updateGeographyOptions();
    renderNotes();
    await renderDashboard();
}

function renderSelectedGeographies() {
    elements.selectedGeographies.replaceChildren();
    for (const geography of state.selections) {
        const chip = document.createElement('span');
        chip.className = 'geography-chip';
        chip.append(document.createTextNode(geographyLabel(geography)));

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = '×';
        remove.setAttribute('aria-label', `Remove ${geographyLabel(geography)}`);
        remove.addEventListener('click', async () => {
            if (state.selections.length === 1) {
                setSelectionMessage('At least one geography must remain selected.');
                return;
            }
            state.selections = state.selections.filter(
                selection => geographyKey(selection) !== geographyKey(geography)
            );
            setSelectionMessage('');
            renderSelectedGeographies();
            await updateGeographyOptions();
            renderNotes();
            await renderDashboard();
        });
        chip.append(remove);
        elements.selectedGeographies.append(chip);
    }
}

async function ensureValidSelections() {
    const original = state.selections;
    const levels = new Set(availableLevels(state.metrics[state.metric]));
    const candidates = original.filter(geography => levels.has(geography.level));
    const valid = [];

    for (const geography of candidates) {
        try {
            const dataset = await loadDataset(state.metric, geography.level);
            if (dataset.groups.has(geographyKey(geography))) {
                valid.push(geography);
            }
        } catch {
            // Preserve the selection so the chart can report the request failure.
            valid.push(geography);
        }
    }

    if (!valid.length) {
        for (const level of availableLevels(state.metrics[state.metric])) {
            try {
                const options = await geographyOptions(state.metric, level);
                if (options.length) {
                    valid.push(options[0]);
                    break;
                }
            } catch {
                // Try the next valid level.
            }
        }
    }

    state.selections = valid;
    const validKeys = new Set(valid.map(geographyKey));
    return original.filter(geography => !validKeys.has(geographyKey(geography)));
}

async function geographyOptions(metric, level) {
    if (!level) {
        return [];
    }
    const dataset = await loadDataset(metric, level);
    const options = [...dataset.groups.keys()].map(parseGeographyKey);
    return options.sort((first, second) => {
        if (level === 'hr') {
            const firstProvince = state.ptNames.get(first.region) || first.region;
            const secondProvince = state.ptNames.get(second.region) || second.region;
            const provinceOrder = firstProvince.localeCompare(secondProvince);
            if (provinceOrder) {
                return provinceOrder;
            }
        }
        const firstLabel = level === 'hr' ? healthRegionName(first) : geographyLabel(first);
        const secondLabel = level === 'hr' ? healthRegionName(second) : geographyLabel(second);
        return firstLabel.localeCompare(secondLabel);
    });
}

async function renderDashboard() {
    const sequence = ++state.renderSequence;
    chart.showLoading('default', {text: 'Loading data…'});
    hideChartMessage();

    const results = await Promise.all(state.selections.map(async geography => {
        try {
            const dataset = await loadDataset(state.metric, geography.level);
            const rows = dataset.groups.get(geographyKey(geography));
            if (!rows?.length) {
                return {
                    geography,
                    error: new DataError(
                        'jurisdiction-unavailable',
                        `${state.metrics[state.metric].name_long} exists at this geographic level but not for ${geographyLabel(geography)}.`
                    )
                };
            }
            const transformed = buildSeries(rows, state.metric, state.mode, state.cadence);
            const finiteCount = transformed.points.filter(point => Number.isFinite(point.value)).length;
            if (!finiteCount) {
                return {
                    geography,
                    error: new DataError('empty', `${geographyLabel(geography)} has no usable observations for this selection.`),
                    ...transformed,
                    rows
                };
            }
            return {geography, ...transformed, rows};
        } catch (error) {
            return {geography, error};
        }
    }));

    if (sequence !== state.renderSequence) {
        return;
    }

    const valid = results.filter(result => !result.error);
    const completenessDate = await loadCompletenessDate();
    if (sequence !== state.renderSequence) {
        return;
    }

    chart.hideLoading();
    if (!valid.length) {
        chart.clear();
        showChartMessage(
            results.map(result => result.error?.message).filter(Boolean).join(' ') ||
            'No usable data are available for this selection.',
            results.some(result => result.error?.code === 'request') ? 'danger' : 'warning'
        );
        renderReportingStatus(results, completenessDate);
        return;
    }

    const option = makeChartOption(valid, completenessDate);
    chart.setOption(option, true);

    const errors = results.filter(result => result.error);
    if (errors.length) {
        showChartMessage(errors.map(result => result.error.message).join(' '), 'warning');
    }
    renderReportingStatus(results, completenessDate);
}

function makeChartOption(results, completenessDate) {
    const multiple = results.length > 1;
    const modeLabel = metricModeLabel(state.metric, state.mode, state.cadence);
    const title = multiple
        ? modeLabel
        : `${modeLabel} in ${geographyLabel(results[0].geography)}`;
    const series = [];

    results.forEach((result, index) => {
        const color = COLORS[index % COLORS.length];
        const name = multiple ? geographyLabel(result.geography) : modeLabel;

        if (state.mode === 'interval' && state.cadence === 'daily' && !multiple) {
            series.push(makeBarSeries(name, result.points, color));
            series.push(makeLineSeries('7-day average', rollingAveragePoints(result.points), color));
        } else if (state.mode === 'interval' && state.cadence === 'weekly' && !multiple) {
            series.push(makeBarSeries(name, result.points, color));
        } else {
            const points = state.mode === 'interval' && state.cadence === 'daily' && multiple
                ? rollingAveragePoints(result.points)
                : result.points;
            series.push(makeLineSeries(name, points, color));
        }
    });

    if (completenessDate && series.length) {
        series[0].markLine = {
            silent: true,
            symbol: 'none',
            lineStyle: {type: 'dashed', color: '#6c757d'},
            label: {formatter: 'All provinces\nreported'},
            data: [{xAxis: completenessDate}]
        };
    }

    return {
        animationDuration: 300,
        color: COLORS,
        title: {
            text: title,
            subtext: multiple && state.mode === 'interval' && state.cadence === 'daily'
                ? 'Seven-day rolling averages are shown for comparison.'
                : '',
            left: 'center',
            textStyle: {width: Math.max(280, chart.getWidth() * 0.85), overflow: 'break'}
        },
        legend: {
            show: multiple,
            type: 'scroll',
            top: 62,
            left: 'center',
            width: '85%'
        },
        tooltip: {
            trigger: 'axis',
            valueFormatter: value => formatValue(value)
        },
        xAxis: {
            type: 'time',
            boundaryGap: state.mode === 'interval' ? ['1%', '1%'] : false
        },
        yAxis: {
            type: 'value',
            min: allowsNegative(state.metric, state.mode) ? null : 0,
            axisLabel: {formatter: value => compactNumber(value)}
        },
        grid: {
            top: multiple ? 105 : 78,
            left: 20,
            right: 25,
            bottom: 30,
            containLabel: true
        },
        toolbox: {
            feature: {
                saveAsImage: {},
                dataView: {readOnly: true}
            },
            right: 0,
            top: 0
        },
        series
    };
}

function makeBarSeries(name, points, color) {
    return {
        name,
        type: 'bar',
        data: chartPoints(points),
        itemStyle: {color, opacity: 0.45},
        emphasis: {focus: 'series'},
        connectNulls: false
    };
}

function makeLineSeries(name, points, color) {
    return {
        name,
        type: 'line',
        data: chartPoints(points),
        color,
        showSymbol: false,
        connectNulls: false,
        emphasis: {focus: 'series'}
    };
}

function chartPoints(points) {
    return points.map(point => [point.date, point.value]);
}

function renderReportingStatus(results, completenessDate) {
    elements.reportingStatus.replaceChildren();
    const list = document.createElement('ul');

    for (const result of results) {
        const item = document.createElement('li');
        if (result.error) {
            item.textContent = `${geographyLabel(result.geography)}: ${result.error.message}`;
        } else {
            const lastDate = result.rows
                .map(row => row.date)
                .filter(Boolean)
                .sort()
                .at(-1);
            item.append(document.createTextNode(`${geographyLabel(result.geography)}: last observation ${lastDate}.`));
            const omitted = result.diagnostics.negative;
            const invalid = result.diagnostics.missing + result.diagnostics.nonFinite + result.diagnostics.outOfRange;
            if (omitted || invalid) {
                const detail = document.createElement('span');
                detail.className = 'small d-block';
                const messages = [];
                if (omitted) {
                    messages.push(`${omitted} negative correction${omitted === 1 ? '' : 's'} shown as gaps`);
                }
                if (invalid) {
                    messages.push(`${invalid} missing or invalid observation${invalid === 1 ? '' : 's'} shown as gaps`);
                }
                detail.textContent = messages.join('; ') + '.';
                item.append(detail);
            }
        }
        list.append(item);
    }
    elements.reportingStatus.append(list);

    if (completenessDate) {
        const completeness = document.createElement('p');
        completeness.className = 'small mt-2 mb-0';
        completeness.textContent = `The Canada series includes reports from all ten provinces through ${completenessDate}.`;
        elements.reportingStatus.append(completeness);
    }
    if (state.cadence === 'weekly') {
        const weekly = document.createElement('p');
        weekly.className = 'small mt-2 mb-0';
        weekly.textContent = 'Weeks run Monday through Sunday and are labelled by the ending Sunday.';
        elements.reportingStatus.append(weekly);
    }
}

function renderNotes() {
    const metadata = state.metrics[state.metric];
    if (!metadata) {
        return;
    }
    elements.metricDefinition.replaceChildren();
    elements.generalNotes.replaceChildren();
    elements.jurisdictionNotes.replaceChildren();

    const definitionHeading = document.createElement('h3');
    definitionHeading.className = 'h6';
    definitionHeading.textContent = metricModeLabel(state.metric, state.mode, state.cadence);
    const definition = document.createElement('p');
    definition.textContent = state.mode === 'level' ? metadata.value : metadata.value_daily;
    if (state.cadence === 'weekly') {
        const family = metricProfile(state.metric).family;
        if (state.mode === 'level') {
            definition.append(document.createTextNode(' The weekly display uses the final available observation in each Monday–Sunday week.'));
        } else if (family === 'stock' || family === 'coverage') {
            definition.append(document.createTextNode(' Weekly changes are calculated between consecutive week-end observations.'));
        } else {
            definition.append(document.createTextNode(' Weekly values sum the valid interval observations in each Monday–Sunday week.'));
        }
    }
    elements.metricDefinition.append(definitionHeading, definition);

    if (metadata.general_notes) {
        const heading = document.createElement('h3');
        heading.className = 'h6';
        heading.textContent = 'General note';
        const note = document.createElement('p');
        note.textContent = metadata.general_notes;
        elements.generalNotes.append(heading, note);
    }

    const notes = dataNotesForGeographies(metadata, state.selections);
    const heading = document.createElement('h3');
    heading.className = 'h6';
    heading.textContent = 'Jurisdiction notes';
    elements.jurisdictionNotes.append(heading);
    if (!notes.length) {
        const empty = document.createElement('p');
        empty.textContent = 'No jurisdiction-specific notes are provided for this selection.';
        elements.jurisdictionNotes.append(empty);
        return;
    }

    const container = document.createElement('div');
    for (const note of notes) {
        const article = document.createElement('article');
        article.className = 'data-note';
        const scope = document.createElement('strong');
        if (note.scope === 'can') {
            scope.textContent = 'Canada';
        } else if (note.scope === 'pt') {
            scope.textContent = 'All provinces and territories';
        } else if (note.scope === 'hr') {
            scope.textContent = 'All health regions';
        } else {
            scope.textContent = state.ptNames.get(note.scope.toUpperCase()) || note.scope.toUpperCase();
        }
        article.append(scope);

        const rangeText = formatNoteRange(note.date_start, note.date_end);
        if (rangeText) {
            const range = document.createElement('div');
            range.className = 'note-range small';
            range.textContent = rangeText;
            article.append(range);
        }

        const body = document.createElement('p');
        body.className = 'mb-1';
        body.textContent = note.note || '';
        article.append(body);

        const sources = sourceUrls(note.source);
        if (sources.length) {
            const sourceLine = document.createElement('div');
            sourceLine.className = 'note-source small';
            sourceLine.append(document.createTextNode('Source: '));
            sources.forEach((url, index) => {
                if (index) {
                    sourceLine.append(document.createTextNode(', '));
                }
                const link = document.createElement('a');
                link.href = url;
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                link.textContent = sources.length === 1 ? 'view source' : `source ${index + 1}`;
                sourceLine.append(link);
            });
            article.append(sourceLine);
        }
        container.append(article);
    }
    elements.jurisdictionNotes.append(container);
}

function loadDataset(metric, level) {
    const key = `${metric}:${level}`;
    return cached(datasetCache, key, async () => {
        const path = datasetPath(metric, level, state.metrics[metric]);
        if (!path) {
            throw new DataError(
                'level-unavailable',
                `${state.metrics[metric].name_long} is not available at the ${LEVEL_LABELS[level].toLowerCase()} level.`
            );
        }
        const rows = await fetchCsv(`${UPSTREAM_RAW}/${path}`, true);
        const required = ['name', 'region', 'date', 'value', 'value_daily'];
        if (level === 'hr') {
            required.push('sub_region_1');
        }
        const fields = rows.length ? Object.keys(rows[0]) : [];
        const missingFields = required.filter(field => !fields.includes(field));
        if (!rows.length) {
            throw new DataError('empty', `The upstream ${state.metrics[metric].name_long} file is empty.`);
        }
        if (missingFields.length) {
            throw new DataError('schema', `The upstream file is missing: ${missingFields.join(', ')}.`);
        }
        return {groups: groupRowsByGeography(rows, level)};
    });
}

async function loadCompletenessDate() {
    if (!COMPLETENESS_METRICS.has(state.metric) || !state.selections.some(item => item.level === 'can')) {
        return null;
    }
    try {
        const data = await fetchJson(`${UPSTREAM_RAW}/data/can/${state.metric}_can_completeness.json`);
        return latestCompletenessDate(data, COMPLETENESS_REGIONS);
    } catch {
        return null;
    }
}

async function loadGeographyNames() {
    const [ptResult, hrResult] = await Promise.allSettled([
        fetchCsv(PT_METADATA_URL, false),
        fetchCsv(HR_METADATA_URL, false)
    ]);
    if (ptResult.status === 'fulfilled') {
        for (const row of ptResult.value) {
            state.ptNames.set(row.region, row.name_canonical);
        }
    }
    if (hrResult.status === 'fulfilled') {
        for (const row of hrResult.value) {
            state.hrNames.set(`${row.region}:${row.hruid}`, row.name_canonical);
        }
    }
}

function fetchJson(url) {
    return cached(resourceCache, `json:${url}`, async () => {
        const response = await fetchResponse(url);
        return response.json();
    });
}

function fetchCsv(url, dynamicTyping) {
    return cached(resourceCache, `csv:${dynamicTyping}:${url}`, async () => {
        const response = await fetchResponse(url);
        const csv = await response.text();
        const parsed = Papa.parse(csv, {
            header: true,
            dynamicTyping,
            skipEmptyLines: 'greedy'
        });
        if (parsed.errors.length) {
            throw new DataError('parse', `The upstream CSV could not be parsed: ${parsed.errors[0].message}`);
        }
        return parsed.data;
    });
}

function cached(cache, key, load) {
    if (!cache.has(key)) {
        const promise = load().catch(error => {
            cache.delete(key);
            throw error;
        });
        cache.set(key, promise);
    }
    return cache.get(key);
}

async function fetchResponse(url) {
    let response;
    try {
        response = await fetch(url);
    } catch {
        throw new DataError('request', 'The upstream data request failed. Check your connection and try again.');
    }
    if (!response.ok) {
        throw new DataError('request', `The upstream data request failed (${response.status}).`);
    }
    return response;
}

function geographyLabel(geography) {
    if (geography.level === 'can') {
        return 'Canada';
    }
    const province = state.ptNames.get(geography.region) || geography.region;
    if (geography.level === 'pt') {
        return province;
    }
    return `${healthRegionName(geography)} (${province})`;
}

function healthRegionName(geography) {
    return geography.subRegion === '9999'
        ? 'Unknown or unassigned'
        : state.hrNames.get(`${geography.region}:${geography.subRegion}`) || `Health region ${geography.subRegion}`;
}

function formatNoteRange(start, end) {
    if (start && end) {
        return start === end ? `Applies on ${start}` : `Applies ${start} to ${end}`;
    }
    if (start) {
        return `Applies from ${start}`;
    }
    if (end) {
        return `Applies through ${end}`;
    }
    return '';
}

function sourceUrls(source) {
    return String(source || '')
        .split(';')
        .map(part => part.match(/https?:\/\/[^\s]+/)?.[0])
        .filter(Boolean)
        .map(url => url.replace(/[.,]+$/, ''));
}

function formatValue(value) {
    if (!Number.isFinite(value)) {
        return 'No data';
    }
    const coverage = metricProfile(state.metric).family === 'coverage';
    const formatted = value.toLocaleString(undefined, {
        maximumFractionDigits: coverage || !Number.isInteger(value) ? 1 : 0
    });
    if (coverage) {
        return state.mode === 'level' ? `${formatted}%` : `${formatted} percentage points`;
    }
    return formatted;
}

function compactNumber(value) {
    return new Intl.NumberFormat(undefined, {
        notation: Math.abs(value) >= 10000 ? 'compact' : 'standard',
        maximumFractionDigits: 1
    }).format(value);
}

function setSelectionMessage(message, tone = 'muted') {
    elements.selectionMessage.textContent = message;
    elements.selectionMessage.className = `form-text mt-2 text-${tone}`;
}

function showChartMessage(message, tone) {
    elements.chartMessage.textContent = message;
    elements.chartMessage.className = `alert alert-${tone}`;
}

function hideChartMessage() {
    elements.chartMessage.textContent = '';
    elements.chartMessage.className = 'alert d-none';
}

function setControlsDisabled(disabled) {
    elements.metric.disabled = disabled;
    elements.valueMode.disabled = disabled;
    elements.cadence.disabled = disabled;
    elements.geographyLevel.disabled = disabled;
    if (disabled) {
        elements.geography.disabled = true;
        elements.addGeography.disabled = true;
    }
}

initialize().catch(error => {
    chart.hideLoading();
    chart.clear();
    showChartMessage(error.message || 'The dashboard could not be initialized.', 'danger');
    setControlsDisabled(true);
});
