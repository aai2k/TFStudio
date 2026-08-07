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
}

console.log(`build_environment: ${passed} passed`);
