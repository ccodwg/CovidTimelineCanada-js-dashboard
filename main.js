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

// format PT names from abbreviations to full names
const formatPT = (pt) => {
    let ptName = pt;
    switch (pt) {
        case 'CAN': ptName = 'Canada'; break;
        case 'AB' : ptName = 'Alberta'; break;
        case 'BC' : ptName = 'British Columbia'; break;
        case 'MB' : ptName = 'Manitoba'; break;
        case 'NB' : ptName = 'New Brunswick'; break;
        case 'NL' : ptName = 'Newfoundland and Labrador'; break;
        case 'NS' : ptName = 'Nova Scotia'; break;
        case 'NT' : ptName = 'Northwest Territories'; break;
        case 'NU' : ptName = 'Nunavut'; break;
        case 'ON' : ptName = 'Ontario'; break;
        case 'PE' : ptName = 'Prince Edward Island'; break;
        case 'QC' : ptName = 'Quebec'; break;
        case 'SK' : ptName = 'Saskatchewan'; break;
        case 'YT' : ptName = 'Yukon'; break;
    }
    return ptName;
}

// format metric names from abbreviations to full names
// should take into account value_type as well
const formatMetric = (metric, value_type) => {
    let metricName = metric;
    switch (metric) {
        case 'cases': metricName = 'cases'; break;
        case 'deaths': metricName = 'deaths'; break;
        case 'hospitalizations': metricName = 'hospitalizations'; break;
        case 'icu': metricName = 'ICU'; break;
        case 'tests_completed': metricName = 'tests completed'; break;
        case 'vaccine_coverage_dose_1': metricName = 'vaccine coverage (dose 1)'; break;
        case 'vaccine_coverage_dose_2': metricName = 'vaccine coverage (dose 2)'; break;
        case 'vaccine_coverage_dose_3': metricName = 'vaccine coverage (dose 3)'; break;
        case 'vaccine_coverage_dose_4': metricName = 'vaccine coverage (dose 4)'; break;
        case 'vaccine_coverage_dose_5': metricName = 'vaccine coverage (dose 5)'; break;
        case 'vaccine_administration_total_doses': metricName = 'vaccine administration (total doses)'; break;
        case 'vaccine_administration_dose_1': metricName = 'vaccine administration (dose 1)'; break;
        case 'vaccine_administration_dose_2': metricName = 'vaccine administration (dose 2)'; break;
        case 'vaccine_administration_dose_3': metricName = 'vaccine administration (dose 3)'; break;
        case 'vaccine_administration_dose_4': metricName = 'vaccine administration (dose 4)'; break;
        case 'vaccine_administration_dose_5': metricName = 'vaccine administration (dose 5)'; break;
    }
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
    // add markLine for case and test data - when testing was restricted
    if (['cases', 'tests_completed'].includes(metric)) {
        option.series[0].markLine = {
            data: [ { xAxis: '2022-01-01', symbol: 'none' } ],
            label: { formatter: 'Testing restricted in 2022' }
        };
    } else {
        // no markLine
        option.series[0].markLine = {};
    }
    // redraw chart with new data
    if (notmerge) {
        // prevent markLine from persisting
        chart.setOption(option, notMerge = true);
    } else {
        // persist markLine between drawings of chart
        chart.setOption(option);
    }
    
}

// build page
const buildPage = async () => {
    // get metrics and build options for metric dropdown
    const metrics = await getMetrics();
    await optionsMetrics(metrics);

    // create chart 1 on load
    await createChart('chart_1', document.getElementById('metric').value, document.getElementById('pt').value, document.getElementById('value_type').value);

    // rebuild chart 1 when new metric, pt or value_type is selected
    document.getElementById('metric').addEventListener('change', async () => {
        createChart('chart_1', document.getElementById('metric').value, document.getElementById('pt').value, document.getElementById('value_type').value, true);
    });
    document.getElementById('pt').addEventListener('change', async () => {
        createChart('chart_1', document.getElementById('metric').value, document.getElementById('pt').value, document.getElementById('value_type').value);
    });
    document.getElementById('value_type').addEventListener('change', async () => {
        createChart('chart_1', document.getElementById('metric').value, document.getElementById('pt').value, document.getElementById('value_type').value, true);
    });

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
