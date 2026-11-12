import assert from 'node:assert/strict';
import { getPalette } from '../src/constants/colorPalettes.js';
import { chartToolbox, lineSeries } from '../src/components/ui/chartOptions.js';
import { percentSpectrumOption } from '../src/components/windows/analysis/chrome/plot.js';

// chartPicture.js draws through plotSurface.js, which takes its hooks from the
// renderer's React.
globalThis.React = { useEffect() {}, useRef: value => ({ current: value }) };
const { lightOption } = await import('../src/components/ui/chartPicture.js');

const dark = getPalette('Dark Gray');
const light = getPalette('Light');
const CURVE = '#e6194b';

function spectrum(c) {
    const option = percentSpectrumOption({
        c, fileName: 'spectrum', lambdaAxis: 'Wavelength, nm',
        series: [lineSeries({ x: [400, 500], y: [10, 90], name: 'T', color: CURVE })],
    });
    // A legend on a see-through panel: a theme colour with an alpha byte.
    return { ...option, legend: { ...option.legend, backgroundColor: `${c.panel}dd` } };
}

// A plot drawn in a dark theme is saved in the Light theme's colours, role for
// role; its curves keep their own colours.
{
    const option = spectrum(dark);
    const picture = lightOption(option, dark);
    assert.equal(picture.backgroundColor, light.panel, 'the paper is the Light panel');
    assert.equal(picture.grid.backgroundColor, light.bg, 'the plot area is the Light background');
    assert.equal(picture.textStyle.color, light.text);
    assert.equal(picture.xAxis.axisLabel.color, light.text, 'tick labels are in the Light text colour');
    assert.equal(picture.xAxis.splitLine.lineStyle.color, light.border, 'grid lines are the Light border');
    assert.equal(picture.legend.backgroundColor, `${light.panel}dd`, 'a theme colour keeps its alpha byte');
    assert.equal(picture.series[0].lineStyle.color, CURVE, 'a curve colour is not a theme colour');
    assert.equal(picture.xAxis.axisLabel.formatter, option.xAxis.axisLabel.formatter, 'functions are kept');
    assert.equal(picture.series[0].progressive, 0, 'the copy draws every point in one pass');
    assert.equal(picture.animation, false);
    assert.equal(option.backgroundColor, dark.panel, 'the chart on screen is left alone');
}

// A plot already in the Light theme is saved as it is drawn.
{
    const option = spectrum(light);
    const picture = lightOption(option, light);
    assert.deepEqual({ ...picture, series: picture.series.map(({ progressive, ...rest }) => rest) },
        { ...option, animation: false });
}

// The save icon on every chart is the one that saves in the Light theme.
{
    const { feature } = chartToolbox('spectrum', { colors: dark });
    assert.equal(feature.saveAsImage, undefined, "ECharts' own save, in the screen's colours, is gone");
    assert.equal(feature.mySaveAsImage.name, 'TFStudio_spectrum');
    assert.equal(feature.mySaveAsImage.pixelRatio, 2);
    assert.equal(feature.mySaveAsImage.title, 'Save picture');
    assert.equal(typeof feature.mySaveAsImage.onclick, 'function');
}

console.log('chart_picture_light: ok');
