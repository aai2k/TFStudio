// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// In the packaged desktop app the site is served from file:// inside
// resources/help/, so links and assets must be relative. Astro's `base: './'`
// + `trailingSlash: 'always'` keeps every URL portable between the Vercel
// demo (Phase 10.3) and the offline app shell.
export default defineConfig({
  site: 'https://docs.tfstudio.xyz',
  base: '/',
  trailingSlash: 'always',
  integrations: [
    starlight({
      title: 'TFStudio Docs',
      description: 'Optical thin-film coating design — reference manual',
      // Branding: the TFStudio app icon (icons/tfstudio.*), copied
      // into public/ as favicon.{ico,png}. `favicon` sets the primary .ico;
      // the head links add the high-res PNG + Apple touch icon. Served
      // identically by the offline help server (it serves docs-site/dist).
      favicon: '/favicon.ico',
      head: [
        { tag: 'link', attrs: { rel: 'icon', type: 'image/png', href: '/favicon.png', sizes: '512x512' } },
        { tag: 'link', attrs: { rel: 'apple-touch-icon', href: '/favicon.png' } },
      ],
      // Header link back to the source repository.
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/aai2k/TFStudio' },
      ],
      customCss: ['./src/styles/tfstudio.css'],
      components: {
        // Custom title that prepends the in-app ribbon icon when the page
        // frontmatter sets `ribbonIcon: <toolId>` (see ribbon-icons.js).
        PageTitle: './src/components/PageTitle.astro',
      },
      // English + Chinese. The auto-generated RU pages were removed
      // (2026-06-07) — they'll be re-authored by hand later. Re-add a `ru`
      // locale here and `src/content/docs/ru/**` pages to restore the switcher.
      defaultLocale: 'root',
      locales: {
        root: { label: 'English', lang: 'en' },
        zh: { label: '中文', lang: 'zh-CN' },
      },
      // The tool groups below mirror the app's ribbon (see the ribbon
      // definition in src/components/Toolbar.js): same groups, same order,
      // and the Tolerance and Needle ribbon dropdowns appear as nested
      // sub-groups. Page URLs are independent of this grouping and are kept
      // stable, so a tool can move between groups without breaking a link.
      //
      // Every group and item carries `translations` for the zh-CN locale;
      // slugs and internal links stay unprefixed — Starlight injects the
      // locale prefix automatically when rendering each language.
      sidebar: [
        {
          label: 'Getting Started',
          translations: { 'zh-CN': '入门' },
          items: [
            { label: 'Welcome', translations: { 'zh-CN': '欢迎' }, slug: 'index' },
            { label: 'Surface & Evaluation Modes', translations: { 'zh-CN': '表面与评价模式' }, slug: 'design/evaluation-modes' },
          ],
        },
        {
          label: 'Edit',
          translations: { 'zh-CN': '编辑' },
          items: [
            { label: 'History', translations: { 'zh-CN': '历史记录' }, slug: 'design/history' },
          ],
        },
        {
          label: 'Design',
          translations: { 'zh-CN': '设计' },
          items: [
            { label: 'Design Editor',   translations: { 'zh-CN': '设计编辑器' }, slug: 'design/design-editor' },
            { label: 'Material Editor', translations: { 'zh-CN': '材料编辑器' }, slug: 'design/material-editor' },
            { label: 'Specification',   translations: { 'zh-CN': '技术规格' },   slug: 'design/specification' },
            { label: 'Stack Formula',   translations: { 'zh-CN': '膜系公式' },   slug: 'design/stack-formula' },
          ],
        },
        {
          label: 'Analysis',
          translations: { 'zh-CN': '分析' },
          items: [
            { label: 'Optical Evaluation', translations: { 'zh-CN': '光学评价' },   slug: 'analysis/optical-evaluation' },
            { label: 'Color Evaluation',   translations: { 'zh-CN': '颜色评价' },   slug: 'analysis/color-evaluation' },
            { label: 'Admittance Diagram', translations: { 'zh-CN': '导纳图' },     slug: 'analysis/admittance' },
            { label: 'Electric Field',     translations: { 'zh-CN': '电场' },       slug: 'analysis/efield' },
            { label: 'Ellipsometry',       translations: { 'zh-CN': '椭偏仪' },     slug: 'analysis/ellipsometry' },
            { label: 'GD / GDD',           slug: 'analysis/gd-gdd' },
            { label: 'Material Dispersion', translations: { 'zh-CN': '材料色散' },  slug: 'analysis/material-dispersion' },
            { label: 'RI Profile',         translations: { 'zh-CN': '折射率分布' }, slug: 'analysis/refractive-index-profile' },
            { label: 'Integral Values',    translations: { 'zh-CN': '积分值' },     slug: 'analysis/integral-values' },
            {
              label: 'Tolerance',
              translations: { 'zh-CN': '公差分析' },
              collapsed: true,
              items: [
                { label: 'Monte-Carlo',            translations: { 'zh-CN': '蒙特卡洛' },      slug: 'analysis/error-analysis' },
                { label: 'Layer Sensitivity',      translations: { 'zh-CN': '层灵敏度' },      slug: 'analysis/layer-sensitivity' },
                { label: 'Inhomogeneities',        translations: { 'zh-CN': '非均匀性' },      slug: 'analysis/inhomogeneities' },
                { label: 'Systematic Deviations',  translations: { 'zh-CN': '系统偏差' },      slug: 'analysis/systematic-deviations' },
                { label: 'Roughness / Scattering', translations: { 'zh-CN': '粗糙度 / 散射' }, slug: 'analysis/roughness-scattering' },
              ],
            },
            { label: 'Plot Engine', translations: { 'zh-CN': '绘图引擎' }, slug: 'analysis/plot-engine' },
          ],
        },
        {
          label: 'Optimization',
          translations: { 'zh-CN': '优化' },
          items: [
            { label: 'Merit Function Editor', translations: { 'zh-CN': '评价函数编辑器' }, slug: 'design/merit-function-editor' },
            { label: 'Operand Reference',     translations: { 'zh-CN': '操作数参考' },     slug: 'design/operands' },
            { label: 'Refinement',            translations: { 'zh-CN': '精炼' },           slug: 'synthesis/refinement' },
            {
              label: 'Needle',
              translations: { 'zh-CN': '针式优化' },
              collapsed: true,
              items: [
                { label: 'Automatic', translations: { 'zh-CN': '自动' }, link: '/synthesis/needle/#needle-automatic' },
                { label: 'Manual',    translations: { 'zh-CN': '手动' }, link: '/synthesis/needle/#needle-manual' },
              ],
            },
            { label: 'Gradual Evolution',    translations: { 'zh-CN': '渐进演化' },   slug: 'synthesis/gradual-evolution' },
            { label: 'Structural Optimizer', translations: { 'zh-CN': '结构优化器' }, slug: 'synthesis/structural-optimizer' },
            { label: 'Variator',             translations: { 'zh-CN': '变化器' },     slug: 'design/variator' },
            { label: 'Design Cleaner',       translations: { 'zh-CN': '设计清理器' }, slug: 'synthesis/design-cleaner' },
            { label: 'Filter Design',        translations: { 'zh-CN': '滤光片设计' }, slug: 'synthesis/wdm-wizard' },
            { label: 'Optimization Methods', translations: { 'zh-CN': '优化方法' },   slug: 'synthesis/optimization-methods' },
          ],
        },
        {
          label: 'Simulation',
          translations: { 'zh-CN': '仿真' },
          items: [
            { label: 'BBM Simulator',  translations: { 'zh-CN': 'BBM 仿真器' }, slug: 'simulation/bbm-simulator' },
            { label: 'Mono Simulator', translations: { 'zh-CN': '单色仿真器' }, slug: 'simulation/mono-simulator' },
            { label: 'Monitor Worksheet', translations: { 'zh-CN': '监控工作表' }, slug: 'simulation/monitor-worksheet' },
          ],
        },
        {
          label: 'Data Exchange',
          translations: { 'zh-CN': '数据交换' },
          items: [
            { label: 'Measured Spectra', translations: { 'zh-CN': '实测光谱' },   slug: 'data-exchange/measured-spectra' },
            { label: 'Measured Ellipsometry', translations: { 'zh-CN': '实测椭偏' }, slug: 'data-exchange/measured-ellipsometry' },
            { label: 'n,k Characterization', translations: { 'zh-CN': 'n,k 表征' }, slug: 'data-exchange/nk-characterization' },
            { label: 'Spectrum File Formats', translations: { 'zh-CN': '光谱文件格式' }, slug: 'data-exchange/spectrum-file-formats' },
            { label: 'Zemax Coatings',   translations: { 'zh-CN': 'Zemax 膜层' }, slug: 'data-exchange/zemax-coatings' },
            { label: 'Process Exporter', translations: { 'zh-CN': '工艺导出' },   slug: 'simulation/process-simulator' },
          ],
        },
        {
          label: 'Information',
          translations: { 'zh-CN': '信息' },
          items: [
            { label: 'Report Generator', translations: { 'zh-CN': '报告生成器' }, slug: 'data-exchange/report-generator' },
          ],
        },
        {
          label: 'Project',
          translations: { 'zh-CN': '项目' },
          items: [
            { label: 'TFStudio website', translations: { 'zh-CN': 'TFStudio 网站' }, link: 'https://tfstudio.xyz/' },
            { label: 'Download',         translations: { 'zh-CN': '下载' },          link: 'https://github.com/aai2k/TFStudio/releases/latest' },
          ],
        },
      ],
    }),
  ],
});
