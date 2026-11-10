/**
 * Save the picture a chart's own "Save as image" tool saves (chartOptions.js
 * chartToolbox): its file name, scale and background, without the toolbox, so
 * a window's Export saves the same file as the icon on the chart. Returns
 * false when the chart is not drawn or has no such tool.
 */
export function saveChartPicture(chart) {
    if (!chart || chart.isDisposed?.()) return false;
    const save = [].concat(chart.getOption()?.toolbox || [])[0]?.feature?.saveAsImage;
    if (!save) return false;
    const link = document.createElement('a');
    link.href = chart.getDataURL({
        type: 'png', pixelRatio: save.pixelRatio, backgroundColor: save.backgroundColor,
        excludeComponents: ['toolbox'],
    });
    link.download = `${save.name}.png`;
    link.click();
    return true;
}
