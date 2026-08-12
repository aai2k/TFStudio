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
      // Branding — the TFStudio app icon (icons/tfstudio-purple2.*), copied
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
      // English-only for now. The auto-generated RU pages were removed
      // (2026-06-07) — they'll be re-authored by hand later. Re-add a `ru`
      // locale here and `src/content/docs/ru/**` pages to restore the switcher.
      defaultLocale: 'root',
      locales: {
        root: { label: 'English', lang: 'en' },
      },
      // The tool groups below mirror the app's ribbon (see the ribbon
      // definition in src/components/Toolbar.js): same groups, same order,
      // and the Tolerance and Needle ribbon dropdowns appear as nested
      // sub-groups. Page URLs are independent of this grouping and are kept
      // stable, so a tool can move between groups without breaking a link.
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'Welcome',                     slug: 'index' },
            { label: 'Surface & Evaluation Modes',  slug: 'design/evaluation-modes' },
          ],
        },
        {
          label: 'Edit',
          items: [
            { label: 'History', slug: 'design/history' },
          ],
        },
        {
          label: 'Design',
          items: [
            { label: 'Design Editor',   slug: 'design/design-editor' },
            { label: 'Material Editor', slug: 'design/material-editor' },
            { label: 'Specification',   slug: 'design/specification' },
            { label: 'Stack Formula',   slug: 'design/stack-formula' },
          ],
        },
        {
          label: 'Analysis',
          items: [
            { label: 'Optical Evaluation', slug: 'analysis/optical-evaluation' },
            { label: 'Color Evaluation',   slug: 'analysis/color-evaluation' },
            { label: 'Admittance Diagram', slug: 'analysis/admittance' },
            { label: 'Electric Field',     slug: 'analysis/efield' },
            { label: 'Ellipsometry',       slug: 'analysis/ellipsometry' },
            { label: 'GD / GDD',           slug: 'analysis/gd-gdd' },
            { label: 'RI Profile',         slug: 'analysis/refractive-index-profile' },
            { label: 'Integral Values',    slug: 'analysis/integral-values' },
            {
              label: 'Tolerance',
              collapsed: true,
              items: [
                { label: 'Monte-Carlo',            slug: 'analysis/error-analysis' },
                { label: 'Layer Sensitivity',      slug: 'analysis/layer-sensitivity' },
                { label: 'Inhomogeneities',        slug: 'analysis/inhomogeneities' },
                { label: 'Systematic Deviations',  slug: 'analysis/systematic-deviations' },
                { label: 'Roughness / Scattering', slug: 'analysis/roughness-scattering' },
              ],
            },
            { label: 'Plot Engine', slug: 'analysis/plot-engine' },
          ],
        },
        {
          label: 'Optimization',
          items: [
            { label: 'Merit Function Editor', slug: 'design/merit-function-editor' },
            { label: 'Operand Reference',     slug: 'design/operands' },
            { label: 'Refinement',            slug: 'synthesis/refinement' },
            {
              label: 'Needle',
              collapsed: true,
              items: [
                { label: 'Automatic', link: '/synthesis/needle/#needle-automatic' },
                { label: 'Manual',    link: '/synthesis/needle/#needle-manual' },
              ],
            },
            { label: 'Gradual Evolution',   slug: 'synthesis/gradual-evolution' },
            { label: 'Structural Optimizer', slug: 'synthesis/structural-optimizer' },
            { label: 'Variator',            slug: 'design/variator' },
            { label: 'Design Cleaner',      slug: 'synthesis/design-cleaner' },
            { label: 'Filter Design',       slug: 'synthesis/wdm-wizard' },
            { label: 'Optimization Methods', slug: 'synthesis/optimization-methods' },
          ],
        },
        {
          label: 'Simulation',
          items: [
            { label: 'BBM Simulator',  slug: 'simulation/bbm-simulator' },
            { label: 'Mono Simulator', slug: 'simulation/mono-simulator' },
          ],
        },
        {
          label: 'Data Exchange',
          items: [
            { label: 'Measured Spectra', slug: 'data-exchange/measured-spectra' },
            { label: 'Zemax Coatings',   slug: 'data-exchange/zemax-coatings' },
            { label: 'Process Exporter', slug: 'simulation/process-simulator' },
          ],
        },
        {
          label: 'Information',
          items: [
            { label: 'Report Generator', slug: 'data-exchange/report-generator' },
          ],
        },
        {
          label: 'Project',
          items: [
            { label: 'TFStudio website', link: 'https://tfstudio.xyz/' },
            { label: 'Download',         link: 'https://github.com/aai2k/TFStudio/releases/latest' },
          ],
        },
      ],
    }),
  ],
});
