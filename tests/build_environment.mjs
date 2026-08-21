/** Build scripts tolerate a PATH rewritten by tools such as emsdk. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { prepareBuilderEnvironment } from '../tools/run-electron-builder.mjs';

let passed = 0;
function ok(condition, message) {
  if (!condition) throw new Error(message);
  passed++;
}

const root = 'C:\\Windows';
const powerShellDir = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0';
const existsSync = value => value === `${powerShellDir}\\powershell.exe`;

{
  const source = { SystemRoot: root, PATH: 'D:\\emsdk\\node\\bin' };
  const result = prepareBuilderEnvironment(source, { platform: 'win32', existsSync });
  ok(result.PATH.endsWith(`;${powerShellDir}`),
    'Windows PowerShell is restored after an emsdk-only PATH');
  ok(result.CSC_IDENTITY_AUTO_DISCOVERY === 'false', 'code-signing discovery remains disabled');
  ok(source.PATH === 'D:\\emsdk\\node\\bin', 'the caller environment is not mutated');
}

{
  const mixedCase = powerShellDir.toUpperCase() + '\\';
  const result = prepareBuilderEnvironment(
    { SystemRoot: root, Path: `D:\\emsdk;${mixedCase}` },
    { platform: 'win32', existsSync });
  ok(result.Path.split(';').length === 2, 'an existing PowerShell entry is not duplicated');
  ok(result.PATH === undefined, 'the original Windows PATH key casing is retained');
}

{
  const source = { PATH: '/usr/local/bin:/usr/bin' };
  const result = prepareBuilderEnvironment(source, { platform: 'linux', existsSync: () => false });
  ok(result.PATH === source.PATH, 'non-Windows PATH is left unchanged');
}

{
  let threw = false;
  try {
    prepareBuilderEnvironment({ SystemRoot: root, PATH: '' }, {
      platform: 'win32', existsSync: () => false,
    });
  } catch (error) {
    threw = error.message.includes('PowerShell was not found');
  }
  ok(threw, 'a genuinely missing Windows PowerShell installation fails early and clearly');
}

{
  const pkg = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
  for (const name of ['build', 'build:win', 'build:portable', 'build:win7', 'build:linux']) {
    ok(pkg.scripts[name].includes('tools/run-electron-builder.mjs'), `${name} uses the repaired launcher`);
  }
  ok(!pkg.scripts.build.includes('emsdk'), 'the normal build has no emsdk dependency');
}

{
  const releaseScript = readFileSync(path.join(process.cwd(), 'build-release.ps1'), 'utf8');
  const linuxBranch = releaseScript.search(/if \(\$linuxOnly\) \{\r?\n\s+Section "Preflight: Linux build under WSL"/);
  const windowsPreflight = releaseScript.indexOf('# --- 0. Preflight: required tools');
  ok(releaseScript.includes('$linuxOnly = [bool]$Linux'), '-Linux is recognized as an exclusive build mode');
  ok(linuxBranch >= 0 && linuxBranch < windowsPreflight,
    '-Linux exits through WSL before Windows packaging starts');
  ok(releaseScript.includes('bash ./build-release-linux.sh --no-verify'),
    'the WSL build skips the non-representative GUI smoke test');
  // A dependency directory can exist while holding a version older than
  // package.json asks for, which a presence test accepts and the bundler then
  // fails on. Only npm ls compares the installed tree against the manifest.
  ok(/npm ls --depth=0/.test(releaseScript),
    'root dependencies are checked by version, not by directory presence');
  ok(/npm --prefix docs-site ls --depth=0/.test(releaseScript),
    'docs-site dependencies are checked by version, not by directory presence');
  ok(!/Test-Path \(Join-Path \$proj "node_modules\\\\\$dep"\)/.test(releaseScript),
    'the per-directory dependency probe is gone');
  // Windows PowerShell turns a native command's stderr into error records, and
  // the script runs with $ErrorActionPreference = 'Stop'. Piping npm's stderr
  // therefore aborted the build on a stale tree rather than installing it: the
  // check killed the run in the one case it exists to catch.
  ok(!/npm[^\r\n]*ls --depth=0 2>&1/.test(releaseScript),
    'the dependency checks do not pipe npm stderr into the terminating-error stream');
  for (const check of ['npm ls --depth=0', 'npm --prefix docs-site ls --depth=0']) {
    ok(new RegExp(`Test-ExitZero \\{ ${check.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\}`).test(releaseScript),
      `"${check}" is judged by its exit code alone, so a stale tree is installed rather than fatal`);
  }
}

{
  const linuxScript = readFileSync(path.join(process.cwd(), 'build-release-linux.sh'), 'utf8');
  ok(linuxScript.includes('rm -rf -- "$STAGE/dist"'),
    'the reusable WSL stage discards stale packaging output');
  ok(linuxScript.includes('-name "TFStudio-${VERSION}-*.AppImage"'),
    'only current-version AppImage artifacts are copied back');
  ok(linuxScript.includes('-name "TFStudio-${VERSION}-*.tar.gz"'),
    'only current-version tar archives are copied back');
  ok(linuxScript.includes('-name "TFStudio-${VERSION}-*.deb"'),
    'only current-version Debian packages are copied back');
  // The stage outlives a release, so its node_modules is exactly where a bumped
  // dependency goes stale: the old directory is still there and still passes a
  // presence test, and the failure surfaces much later as a bundler error.
  ok(/npm ls --depth=0 >\/dev\/null 2>&1/.test(linuxScript),
    'the reusable WSL stage checks dependencies by version, not by directory presence');
  ok(!/\[ -d node_modules\/tmmcore \]/.test(linuxScript),
    'the per-directory dependency probe is gone');
}

console.log(`build_environment: ${passed} passed`);
