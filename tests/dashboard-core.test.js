import test from 'node:test';
import assert from 'node:assert/strict';

import {
    aggregateWeekly,
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
    rollingAverage,
    sanitizeValue,
    weekEndingSunday
} from '../dashboard-core.js';

const metadata = geo => ({geo});

test('metric semantics provide appropriate labels and defaults', () => {
    assert.equal(metricProfile('cases').defaultMode, 'interval');
    assert.equal(metricProfile('hospitalizations').defaultMode, 'level');
    assert.equal(metricProfile('vaccine_coverage_dose_2').defaultMode, 'level');
    assert.equal(metricModeLabel('cases', 'interval', 'daily'), 'Daily new cases');
    assert.equal(metricModeLabel('hosp_admissions', 'interval', 'weekly'), 'Weekly hospital admissions');
    assert.equal(metricModeLabel('icu_admissions', 'interval', 'daily'), 'Daily ICU admissions');
    assert.equal(metricModeLabel('hospitalizations', 'level'), 'Active hospitalizations');
    assert.equal(metricModeLabel('hospitalizations', 'level', 'weekly'), 'Weekly active hospitalizations');
    assert.equal(
        metricModeLabel('hospitalizations', 'interval', 'daily'),
        'Daily change in active hospitalizations'
    );
});

test('availability normalizes na values and dataset filename exceptions', () => {
    const cases = metadata({can: 'hr', pt: 'hr', hr: 'hr'});
    const admissions = metadata({can: 'na', pt: 'pt', hr: 'na'});
    assert.deepEqual(availableLevels(cases), ['can', 'pt', 'hr']);
    assert.deepEqual(availableLevels(admissions), ['pt']);
    assert.equal(datasetPath('hosp_admissions', 'can', admissions), null);
    assert.equal(datasetPath('cases', 'hr', cases), 'data/hr/cases_hr.csv');
    assert.equal(
        datasetPath('vaccine_distribution_total_doses', 'pt', metadata({pt: 'pt'})),
        'data/pt/vaccine_distribution_total_doses.csv'
    );
});

test('geography keys preserve parent jurisdiction for repeated unknown HRUIDs', () => {
    const abUnknown = makeGeography('hr', 'ab', 9999);
    const bcUnknown = makeGeography('hr', 'bc', 9999);
    assert.equal(geographyKey(abUnknown), 'hr:AB:9999');
    assert.equal(geographyKey(bcUnknown), 'hr:BC:9999');
    assert.deepEqual(parseGeographyKey('hr:ON:3595'), {
        level: 'hr',
        region: 'ON',
        subRegion: '3595'
    });

    const grouped = groupRowsByGeography([
        {region: 'AB', sub_region_1: 9999},
        {region: 'BC', sub_region_1: 9999}
    ], 'hr');
    assert.deepEqual([...grouped.keys()], ['hr:AB:9999', 'hr:BC:9999']);
});

test('sanitization rejects missing/non-finite and inappropriate negative values', () => {
    assert.equal(sanitizeValue('', 'cases', 'interval'), null);
    assert.equal(sanitizeValue('NaN', 'cases', 'interval'), null);
    assert.equal(sanitizeValue(Infinity, 'cases', 'interval'), null);
    assert.equal(sanitizeValue(-2, 'hosp_admissions', 'interval'), null);
    assert.equal(sanitizeValue(-2, 'hospitalizations', 'interval'), -2);
    assert.equal(sanitizeValue(-0.1, 'vaccine_coverage_dose_1', 'interval'), -0.1);
    assert.equal(sanitizeValue(-1, 'hospitalizations', 'level'), null);
    assert.equal(sanitizeValue(101, 'vaccine_coverage_dose_1', 'level'), null);
    assert.equal(allowsNegative('icu', 'interval'), true);
    assert.equal(allowsNegative('vaccine_administration_total_doses', 'interval'), false);
});

test('rolling averages keep missing observations as gaps rather than zero', () => {
    assert.deepEqual(rollingAverage([7, 14, 21], 3), [7, 10.5, 14]);
    assert.deepEqual(
        rollingAverage([7, null, 21, 28, 35], 3),
        [7, null, null, null, 28]
    );
});

test('series building filters invalid observations before transformation', () => {
    const result = buildSeries([
        {date: '2023-01-01', value: '10', value_daily: '10'},
        {date: '2023-01-02', value: '9', value_daily: '-1'},
        {date: '2023-01-03', value: '12', value_daily: ''},
        {date: '', value: '12', value_daily: '3'}
    ], 'cases', 'interval', 'daily');

    assert.deepEqual(result.points, [
        {date: '2023-01-01', value: 10},
        {date: '2023-01-02', value: null},
        {date: '2023-01-03', value: null}
    ]);
    assert.deepEqual(result.diagnostics, {
        missing: 1,
        nonFinite: 0,
        negative: 1,
        outOfRange: 0,
        invalidDate: 1
    });
});

test('weeks end on Sunday and flow quantities sum within the week', () => {
    assert.equal(weekEndingSunday('2023-01-02'), '2023-01-08');
    assert.equal(weekEndingSunday('2023-01-08'), '2023-01-08');

    const weekly = aggregateWeekly([
        {date: '2023-01-02', level: 1, interval: 1},
        {date: '2023-01-03', level: 3, interval: 2},
        {date: '2023-01-08', level: 6, interval: 3},
        {date: '2023-01-09', level: 10, interval: 4}
    ], 'cases', 'interval');
    assert.deepEqual(weekly, [
        {date: '2023-01-08', value: 6},
        {date: '2023-01-15', value: 4}
    ]);
});

test('weekly level uses the final observation and stock change uses endpoints', () => {
    const observations = [
        {date: '2023-01-02', level: 10, interval: 10},
        {date: '2023-01-08', level: 14, interval: 4},
        {date: '2023-01-09', level: 13, interval: -1},
        {date: '2023-01-15', level: 9, interval: -4}
    ];
    assert.deepEqual(aggregateWeekly(observations, 'hospitalizations', 'level'), [
        {date: '2023-01-08', value: 14},
        {date: '2023-01-15', value: 9}
    ]);
    assert.deepEqual(aggregateWeekly(observations, 'hospitalizations', 'interval'), [
        {date: '2023-01-08', value: null},
        {date: '2023-01-15', value: -5}
    ]);
});

test('weekly sums remain missing when an explicit daily value is missing', () => {
    const weekly = aggregateWeekly([
        {date: '2023-01-02', level: 1, interval: 1},
        {date: '2023-01-03', level: 1, interval: null}
    ], 'icu_admissions', 'interval');
    assert.deepEqual(weekly, [{date: '2023-01-08', value: null}]);
});

test('data notes normalize object entries and deduplicate same-jurisdiction HR selections', () => {
    const metricMetadata = {
        data_notes: {
            can: {note: 'Canada note', source: ''},
            hr: [{note: 'All-HR note', source: ''}],
            on: [{note: 'Ontario note', date_start: '2022-01-01', source: 'https://example.com'}]
        }
    };
    const notes = dataNotesForGeographies(metricMetadata, [
        makeGeography('can', 'CAN'),
        makeGeography('hr', 'ON', '3595'),
        makeGeography('hr', 'ON', '3553')
    ]);
    assert.deepEqual(notes.map(note => [note.scope, note.note]), [
        ['can', 'Canada note'],
        ['hr', 'All-HR note'],
        ['on', 'Ontario note']
    ]);
});

test('completeness selects the latest date containing every required region', () => {
    assert.equal(latestCompletenessDate({
        '2023-01-01': {pt: ['AB']},
        '2023-01-02': {pt: ['AB', 'BC']},
        '2023-01-03': {pt: ['BC']}
    }, ['AB', 'BC']), '2023-01-02');
});
