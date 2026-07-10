import { shimBrowserGlobals, loadApp, makeTheme, makeLocale, withDesign } from './_uiShim.mjs';
shimBrowserGlobals();
import { renderToStaticMarkup } from 'react-dom/server';
import { createHash } from 'node:crypto';
await loadApp();
const c = makeTheme(), t = makeLocale();
for (const name of ['BBMWizard','MonoWizard','FilterDesignWizard']) {
  const mod = await import(`../src/components/windows/${name}.js`);
  const html = renderToStaticMarkup(withDesign(React.createElement(mod[name], { c, t, onClose: ()=>{} })));
  console.log(name, html.length, createHash('sha256').update(html).digest('hex').slice(0,16));
}
