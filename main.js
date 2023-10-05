// define constants
const ptNames = {
    'CAN': 'Canada',
    'AB': 'Alberta',
    'BC': 'British Columbia',
    'MB': 'Manitoba',
    'NB': 'New Brunswick',
    'NL': 'Newfoundland and Labrador',
    'NS': 'Nova Scotia',
    'NT': 'Northwest Territories',
    'NU': 'Nunavut',
    'ON': 'Ontario',
    'PE': 'Prince Edward Island',
    'QC': 'Quebec',
    'SK': 'Saskatchewan',
    'YT': 'Yukon'
};

const metricNames = {
    'cases': 'cases',
    'deaths': 'deaths',
    'hospitalizations': 'hospitalizations',
    'icu': 'ICU',
    'tests_completed': 'tests completed',
    'vaccine_coverage_dose_1': 'vaccine coverage (dose 1)',
    'vaccine_coverage_dose_2': 'vaccine coverage (dose 2)',
    'vaccine_coverage_dose_3': 'vaccine coverage (dose 3)',
    'vaccine_coverage_dose_4': 'vaccine coverage (dose 4)',
    'vaccine_administration_total_doses': 'vaccine administration (total doses)',
    'vaccine_administration_dose_1': 'vaccine administration (dose 1)',
    'vaccine_administration_dose_2': 'vaccine administration (dose 2)',
    'vaccine_administration_dose_3': 'vaccine administration (dose 3)',
    'vaccine_administration_dose_4': 'vaccine administration (dose 4)',
};


// get metrics
const getMetrics = async () => {
    const response = await fetch('https://raw.githubusercontent.com/ccodwg/CovidTimelineCanada/main/docs/values/values.json');
    const data = await response.json();
    // remove metrics that are not currently supported
    delete data['hosp_admissions'];
    delete data['icu_admissions'];
    return data
}

// build select options for metrics
const optionsMetrics = async (metrics) => {
    const select = document.getElementById('metric');
    for (const k in metrics) {
        const option = document.createElement('option');
        option.value = k;
        option.text = metrics[k]['name_long'];
        select.appendChild(option);
    }
}

// get data from API
const getData = async (metric, pt) => {
    const response = (pt == 'CAN') ?
        await fetch(`https://api.opencovid.ca/timeseries?geo=can&stat=${metric}`) :
        await fetch(`https://api.opencovid.ca/timeseries?geo=pt&stat=${metric}&loc=${pt}`)
    const data = await response.json();
    return data['data'][metric];
}

// parse data from API
const parseData = async (metric, pt) => {
    const data = await getData(metric, pt);
    const dates = Object.entries(data).map(function(x) {return x[1]['date'];});
    const values = Object.entries(data).map(function(x) {return x[1]['value'];});
    const values_daily = Object.entries(data).map(function(x) {return x[1]['value_daily'];});
    return [dates, values, values_daily];
}

// get CAN completeness data from GitHub
const getCompletenessData = async (metric) => {
    const response = await fetch(`https://raw.githubusercontent.com/ccodwg/CovidTimelineCanada/main/data/can/${metric}_can_completeness.json`);
    const data = await response.json();
    return data;
}

// parse CAN completeness data from GitHub
const parseCompletenessData = async (metric, pts) => {
    const data = await getCompletenessData(metric);
    const completeness = Object.entries(data).filter(function(x) {return pts.every(v => x[1]['pt'].includes(v));});
    const completeness_date = completeness[completeness.length - 1][0];
    return completeness_date;
}

// format PT names from abbreviations to full names
const formatPT = (pt) => ptNames[pt];

// format metric names from abbreviations to full names
// should take into account value_type as well
const formatMetric = (metric, value_type) => {
    let metricName = metricNames[metric];
    if (value_type == 'cumulative') {
        if (metric == 'hospitalizations' | metric == 'icu') {
            metricName = 'Active ' + metricName;
        } else {
            metricName = 'Cumulative ' + metricName;
        }
    } else {
        if (metric == 'hospitalizations' | metric == 'icu') {
            metricName = 'Change in active ' + metricName;
        } else if (metric == 'vaccine_coverage_dose_1' | metric == 'vaccine_coverage_dose_2' | metric == 'vaccine_coverage_dose_3' | metric == 'vaccine_coverage_dose_4' | metric == 'vaccine_coverage_dose_5') {
            metricName = 'Change in ' + metricName;
        } else {
            metricName = 'Daily ' + metricName;
        }
    }
    return metricName;
}

// calculate 7-day rolling average
const rollingAverage = (data, window) => {
    const result = [];
    for (let i = 0, len = data.length; i < len; i++) {
        let n = Math.min( i + 1, window);
        let sum = 0;
        for (let j = 0; j < n; j++) {
            sum += data[i-j];
        }
        result.push(sum / n);
    }
    return result;
}

// create timeseries chart using Apache ECharts
const createChart = async (chart_id, metric, pt, value_type, notmerge) => {
    const [dates, values, values_daily] = await parseData(metric, pt);
    const chart_div = document.getElementById(chart_id);
    const chart = echarts.init(chart_div);
    const option = {
        title: {
            text: formatMetric(metric, value_type) +  ' in ' + formatPT(pt),
            left: 'center',
            textStyle: {
                width: chart_div.offsetWidth * 0.9,
                overflow: 'break'
            }
        },
        tooltip: {
            trigger: 'axis'
        },
        xAxis: {
            type: 'category',
            data: dates,
            boundaryGap: false
        },
        yAxis: {
            type: 'value',
            min: (metric == 'cases' | metric == 'deaths') ? 0 : null, // hide negative values when they don't make sense
        },
        grid: {
            // ensure axis labels do not get cut off
            bottom: 0,
            containLabel: true
        },
        toolbox: {
            feature: {
                saveAsImage: {},
                dataView: {
                    readOnly: true
                }
            },
            right: 0,
            top: 0
        }
    };
    // add values
    if (value_type == 'cumulative') {
        option.series = [{
            data: values,
            name: formatMetric(metric, 'cumulative'),
            type: 'line',
            showSymbol: false
        }]
    } else {
        // calculate 7-day rolling average
        values_daily_smooth = rollingAverage(values_daily, 7);
        if (metric == 'vaccine_coverage_dose_1' | metric == 'vaccine_coverage_dose_2' | metric == 'vaccine_coverage_dose_3' | metric == 'vaccine_coverage_dose_4' | metric == 'vaccine_coverage_dose_5') {
            // round rolling average to one decimal place
            values_daily_smooth = values_daily_smooth.map(x => Math.round(x * 10) / 10);
        } else {
            // round rolling average to whole numbers
            values_daily_smooth = values_daily_smooth.map(x => Math.round(x));
        }
        option.series = [{
            data: values_daily,
            name: formatMetric(metric, 'daily'),
            type: 'bar',
            itemStyle: {
                opacity: 0.4
            }
        },
        {
            data: values_daily_smooth,
            name: '7-day average',
            type: 'line',
            color: '#ff2929',
            showSymbol: false
        }]
    }
    
    // update data note
    const data_note = document.getElementById('chart_1_note_text');
    let data_note_text = [];
    if (['cases', 'deaths', 'tests_completed'].includes(metric)) {
        data_note_text.push('Testing was restricted in late 2021/early 2022.')
    }
    if (pt == 'CAN' & ['cases', 'deaths', 'tests_completed'].includes(metric)) {
        data_note_text.push('Canadian data may be incomplete in recent weeks. All provinces last reported on ' + await parseCompletenessData(metric, ['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'ON', 'PE', 'QC', 'SK']) + '.');
    } else {
        data_note_text.push(formatPT(pt) + ' last reported on ' + dates[dates.length - 1] + '.');
    }
    data_note.innerHTML = data_note_text.join(' ');

    // add markLine for CAN completeness
    if (['cases', 'deaths', 'tests_completed'].includes(metric) & pt == 'CAN') {
        const completeness_date = await parseCompletenessData(metric, ['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'ON', 'PE', 'QC', 'SK']);
        option.series[0].markLine = {
            data: [ { xAxis: completeness_date, symbol: 'none' } ],
            label: { formatter: 'All provinces\nlast reported' }
        };
    }

    // redraw chart with new data
    chart.setOption(option, notMerge = true);
    
}

const rebuildChart = async () => {
    await createChart('chart_1', document.getElementById('metric').value, document.getElementById('pt').value, document.getElementById('value_type').value);
}

// build page
const buildPage = async () => {
    // get metrics and build options for metric dropdown
    const metrics = await getMetrics();
    await optionsMetrics(metrics);

    // create chart 1 on load
    await createChart('chart_1', document.getElementById('metric').value, document.getElementById('pt').value, document.getElementById('value_type').value);

    // rebuild chart 1 when new metric, pt or value_type is selected
    document.getElementById('metric').addEventListener('change', rebuildChart);
    document.getElementById('pt').addEventListener('change', rebuildChart);
    document.getElementById('value_type').addEventListener('change', rebuildChart);

    // resize chart and title width if window is resized
    const chart_1 = echarts.init(document.getElementById('chart_1'));
    window.addEventListener('resize', () => {
        chart_1.resize();
        chart_1.setOption({
            title: {
                textStyle: {
                    width: document.getElementById('chart_1').offsetWidth * 0.9
                }
            }
        });
    });
}

buildPage();
