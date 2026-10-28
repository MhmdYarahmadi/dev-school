/**
 * Dockerfile parsing, a BuildKit-style builder (layer cache, multi-stage,
 * .dockerignore, calibrated output/errors) and a best-practice linter.
 */
import { catalogEntry, lookupCatalog, splitRef } from './catalog';
import { CliError, DockerEngine, flag, Out, parseFlags, registerBuild } from './engine';
import type { Image, ImageConfig, Layer } from './types';
import { globToRegExp, joinPath, normalizePath, shellWords, splitShell } from './util';

export interface Instruction {
  line: number; // 1-based line of the instruction start
  cmd: string; // upper-case keyword
  raw: string; // original text (continuations joined)
  args: string; // text after the keyword
}

/** Parse a Dockerfile: comments, line continuations, keywords. */
export function parseDockerfile(text: string): { instrs: Instruction[]; error?: { line: number; msg: string } } {
  const lines = text.split('\n');
  const instrs: Instruction[] = [];
  for (let i = 0; i < lines.length; i++) {
    let l = lines[i];
    if (/^\s*#/.test(l) || !l.trim()) continue;
    const start = i;
    while (/\\\s*$/.test(l) && i + 1 < lines.length) {
      l = l.replace(/\\\s*$/, ' ') + lines[++i].trim();
    }
    const m = /^\s*([A-Za-z]+)\s*(.*)$/.exec(l);
    if (!m) return { instrs, error: { line: start + 1, msg: `unknown instruction: ${l.trim().split(/\s+/)[0]}` } };
    const cmd = m[1].toUpperCase();
    const known = ['FROM', 'RUN', 'CMD', 'LABEL', 'EXPOSE', 'ENV', 'ADD', 'COPY', 'ENTRYPOINT', 'VOLUME', 'USER', 'WORKDIR', 'ARG', 'ONBUILD', 'STOPSIGNAL', 'HEALTHCHECK', 'SHELL', 'MAINTAINER'];
    if (!known.includes(cmd)) return { instrs, error: { line: start + 1, msg: `unknown instruction: ${m[1]}` } };
    instrs.push({ line: start + 1, cmd, raw: l.trim(), args: m[2].trim() });
  }
  return { instrs };
}

/** ["a","b"] exec form → array; otherwise null (shell form). */
function execForm(s: string): string[] | null {
  if (!s.trim().startsWith('[')) return null;
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) && v.every((x) => typeof x === 'string') ? v : null;
  } catch {
    return null;
  }
}

function goList(a: string[]): string {
  return `[${a.map((x) => JSON.stringify(x)).join(' ')}]`;
}

function hash(s: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619) >>> 0;
    h2 = Math.imul(h2 ^ s.charCodeAt(i), 2246822519) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

interface Stage {
  name: string | null;
  index: number;
  base: Image | null; // null for FROM another stage
  baseStage?: Stage;
  files: Record<string, string>;
  config: ImageConfig;
  layers: Layer[];
  size: number;
  contentSize: number;
  origin: string;
  family: 'alpine' | 'debian' | 'scratch';
  aptLists: boolean;
  args: Record<string, string>;
}

function substitute(s: string, vars: Record<string, string>): string {
  return s.replace(/\$\{(\w+)(?::-([^}]*))?\}|\$(\w+)/g, (_m, a, def, b) => vars[a ?? b] ?? def ?? '');
}

// ---------------------------------------------------------------- .dockerignore

function ignoreMatcher(patterns: string[]): (rel: string) => boolean {
  const rules = patterns
    .map((p) => p.trim())
    .filter((p) => p && !p.startsWith('#'))
    .map((p) => ({ neg: p.startsWith('!'), re: globToRegExp(p.replace(/^!/, '').replace(/^\/|\/$/g, '').replace(/\*\*\//g, '')) }));
  return (rel) => {
    let ignored = false;
    const parts = rel.split('/');
    for (const r of rules) {
      // A pattern matches the path or any of its parent directories.
      for (let i = 1; i <= parts.length; i++) {
        if (r.re.test(parts.slice(0, i).join('/')) || (i === parts.length && r.re.test(parts[i - 1]) && !rules.length)) {
          ignored = !r.neg;
          break;
        }
      }
    }
    return ignored;
  };
}

// ---------------------------------------------------------------- the build

interface BuildOpts {
  tags: string[];
  file: string;
  context: string;
  noCache: boolean;
  target?: string;
}

export function build(engine: DockerEngine, o: BuildOpts, out: Out): Image {
  const ctxDir = joinPath(engine.cwd, o.context);
  if (!engine.hostIsDir(ctxDir)) throw new CliError(`ERROR: failed to build: unable to prepare context: path "${o.context}" not found`, 1);
  const dfPath = joinPath(ctxDir, o.file);
  const dfText = engine.files[joinPath(engine.cwd, o.file)] ?? engine.files[dfPath];
  const step = { n: 0 };
  const line = (s: string) => out.add(s, 'dim');
  const begin = (title: string) => {
    step.n++;
    line(`#${step.n} ${title}`);
    return step.n;
  };
  line('#0 building with "default" instance using docker driver');
  line('');
  const n1 = begin('[internal] load build definition from ' + o.file.replace(/^.*\//, ''));
  if (dfText === undefined) {
    line(`#${n1} ERROR: failed to read dockerfile: open ${o.file.replace(/^.*\//, '')}: no such file or directory`);
    throw new CliError(`ERROR: failed to build: failed to solve: failed to read dockerfile: open ${o.file.replace(/^.*\//, '')}: no such file or directory`, 1);
  }
  line(`#${n1} DONE 0.0s`);
  line('');
  const parsed = parseDockerfile(dfText);
  if (parsed.error) throw new CliError(`ERROR: failed to build: failed to solve: dockerfile parse error on line ${parsed.error.line}: ${parsed.error.msg}`, 1);
  const instrs = parsed.instrs;
  if (!instrs.length || instrs[0].cmd !== 'FROM' && instrs[0].cmd !== 'ARG') throw new CliError('ERROR: failed to build: failed to solve: dockerfile parse error on line 1: no build stage in current context', 1);

  // Context files (relative paths), minus .dockerignore.
  const ignorePatterns = (engine.files[joinPath(ctxDir, '.dockerignore')] ?? '').split('\n');
  const ignored = ignoreMatcher(ignorePatterns);
  const context: Record<string, string> = {};
  for (const [k, v] of Object.entries(engine.files)) {
    if (!k.startsWith(ctxDir + '/')) continue;
    const rel = k.slice(ctxDir.length + 1);
    if (!ignored(rel)) context[rel] = v;
  }

  // Split into stages.
  const stageInstrs: Instruction[][] = [];
  const globalArgs: Record<string, string> = {};
  for (const ins of instrs) {
    if (ins.cmd === 'FROM') stageInstrs.push([ins]);
    else if (!stageInstrs.length && ins.cmd === 'ARG') {
      const [k, v] = ins.args.split('=');
      globalArgs[k] = v ?? '';
    } else stageInstrs[stageInstrs.length - 1].push(ins);
  }
  const stageNames = stageInstrs.map((s, i) => /\s+AS\s+(\S+)/i.exec(s[0].args)?.[1] ?? `stage-${i}`);
  let lastIdx = stageInstrs.length - 1;
  if (o.target) {
    lastIdx = stageNames.indexOf(o.target);
    if (lastIdx < 0) throw new CliError(`ERROR: failed to build: failed to solve: target stage "${o.target}" could not be found`, 1);
  }

  // Metadata for each distinct base image.
  const bases = new Set<string>();
  for (const s of stageInstrs.slice(0, lastIdx + 1)) {
    const ref = substitute(s[0].args.replace(/\s+AS\s+\S+$/i, '').trim(), globalArgs);
    if (!stageNames.includes(ref)) bases.add(ref);
  }
  for (const ref of bases) {
    const { repo, tag } = splitRef(ref);
    const lib = repo.includes('/') ? repo : `library/${repo}`;
    const n = begin(`[internal] load metadata for docker.io/${lib}:${tag}`);
    if (ref !== 'scratch' && !lookupCatalog(ref) && lookupCatalog(repo)) {
      line(`#${n} ERROR: docker.io/${lib}:${tag}: not found`);
      throw new CliError(`ERROR: failed to build: failed to solve: ${ref}: failed to resolve source metadata for docker.io/${lib}:${tag}: docker.io/${lib}:${tag}: not found`, 1);
    }
    if (ref !== 'scratch' && !lookupCatalog(ref)) {
      line(`#${n} ERROR: docker.io/${lib}:${tag}: failed to resolve source metadata for docker.io/${lib}:${tag}: pull access denied, repository does not exist or may require authorization: server message: insufficient_scope: authorization failed`);
      throw new CliError(`ERROR: failed to build: failed to solve: ${ref}: failed to resolve source metadata for docker.io/${lib}:${tag}: pull access denied, repository does not exist or may require authorization: server message: insufficient_scope: authorization failed`, 1);
    }
    line(`#${n} DONE ${engine.findImage(`${repo}:${tag}`) ? '0.4' : '2.0'}s`);
    line('');
  }
  const nIgnore = begin('[internal] load .dockerignore');
  line(`#${nIgnore} DONE 0.0s`);
  line('');

  const stages: Stage[] = [];
  let ctxLoaded = false;
  const loadContext = () => {
    if (ctxLoaded) return;
    ctxLoaded = true;
    const n = begin('[internal] load build context');
    line(`#${n} DONE 0.0s`);
    line('');
  };
  const fail = (ins: Instruction, n: number, label: string, detail: string, summary: string): never => {
    line(`#${n} ERROR: ${detail}`);
    line('------');
    line(` > ${label}:`);
    line('------');
    out.add(`${o.file.replace(/^.*\//, '')}:${ins.line}`, 'err');
    out.add('--------------------', 'err');
    const lines = dfText.split('\n');
    for (let i = Math.max(1, ins.line - 2); i <= Math.min(lines.length, ins.line + 1); i++) {
      out.add(`${String(i).padStart(4)} | ${i === ins.line ? '>>>' : '   '} ${lines[i - 1] ?? ''}`, 'err');
    }
    out.add('--------------------', 'err');
    throw new CliError(`ERROR: failed to build: failed to solve: ${summary}`, 1);
  };

  let cacheKey = '';
  let broken = o.noCache;
  for (let si = 0; si <= lastIdx; si++) {
    const ins0 = stageInstrs[si];
    const stageName = stageNames[si];
    const label = (k: number, total: number) => `[${stageNames.length > 1 || /\s+AS\s+/i.test(ins0[0].args) ? `${stageName} ` : ''}${k}/${total}]`;
    const steps = ins0.filter((x) => ['FROM', 'RUN', 'COPY', 'ADD', 'WORKDIR'].includes(x.cmd));
    const total = steps.length;
    let k = 0;
    const fromRef = substitute(ins0[0].args.replace(/\s+AS\s+\S+$/i, '').trim(), globalArgs);
    const prevStage = stages.find((s) => s.name === fromRef);
    let base: Image | null = null;
    if (!prevStage && fromRef !== 'scratch') base = engine.findImage(fromRef) ?? engine.pullQuiet(fromRef);
    const st: Stage = prevStage
      ? { ...prevStage, name: stageName, index: si, base: prevStage.base, baseStage: prevStage, files: { ...prevStage.files }, config: { ...prevStage.config, env: [...prevStage.config.env], volumes: prevStage.config.volumes && [...prevStage.config.volumes] }, layers: [...prevStage.layers], args: { ...prevStage.args } }
      : {
          name: stageName,
          index: si,
          base,
          files: { ...(base?.files ?? {}) },
          config: base ? { ...base.config, env: [...base.config.env], exposed: [...base.config.exposed], cmd: [...base.config.cmd], entrypoint: [...base.config.entrypoint], volumes: base.config.volumes && [...base.config.volumes] } : { cmd: [], entrypoint: [], workdir: '', user: '', env: [], exposed: [] },
          layers: [...(base?.layers ?? [])],
          size: base?.size ?? 0,
          contentSize: base?.contentSize ?? 0,
          origin: base?.origin ?? 'alpine',
          family: base ? catalogEntry(base.origin)?.family ?? 'alpine' : 'scratch',
          aptLists: false,
          args: { ...globalArgs },
        };
    stages.push(st);
    // FROM step. BuildKit runs steps concurrently; as observed on Docker 29, a first build
    // loads the build context before FROM, a cached rebuild resolves FROM first.
    k++;
    cacheKey = hash(`FROM ${fromRef} ${base?.id ?? prevStage?.name}`);
    const fromSeen = engine.state.buildCache.includes(cacheKey);
    if (!fromSeen) loadContext();
    const nFrom = begin(`${label(k, total)} FROM ${base ? `docker.io/${base.repo.includes('/') ? base.repo : `library/${base.repo}`}:${splitRef(fromRef).tag}@sha256:${base.id}` : fromRef}`);
    line(`#${nFrom} DONE ${fromSeen ? '0.0' : '0.8'}s`);
    line('');
    if (!fromSeen) engine.state.buildCache.push(cacheKey);
    else loadContext();
    let cmdSetHere = false;
    const vars = () => ({ ...st.args, ...Object.fromEntries(st.config.env.map((e) => [e.slice(0, e.indexOf('=')), e.slice(e.indexOf('=') + 1)])) });

    for (const ins of ins0.slice(1)) {
      const args = ins.cmd === 'RUN' || ins.cmd === 'CMD' || ins.cmd === 'ENTRYPOINT' ? ins.args : substitute(ins.args, vars());
      const isStep = ['RUN', 'COPY', 'ADD', 'WORKDIR'].includes(ins.cmd);
      let n = 0;
      let stepLabel = '';
      if (isStep) {
        k++;
        stepLabel = `${label(k, total)} ${ins.cmd} ${ins.args}`;
      }
      switch (ins.cmd) {
        case 'WORKDIR': {
          const dir = joinPath(st.config.workdir || '/', args);
          st.config.workdir = dir;
          st.files[dir + '/'] = '';
          st.layers.push({ createdBy: `WORKDIR ${dir}`, size: 0.00819 });
          break;
        }
        case 'ENV': {
          const pairs = /^\S+=/.test(args) ? shellWords(args) : [args.replace(/\s+/, '=')];
          for (const p of pairs) {
            const key = p.slice(0, p.indexOf('='));
            st.config.env = [...st.config.env.filter((e) => !e.startsWith(key + '=')), p];
          }
          st.layers.push({ createdBy: `ENV ${args}`, size: 0 });
          break;
        }
        case 'ARG': {
          const [key, def] = args.split('=');
          st.args[key] = st.args[key] ?? def ?? '';
          break;
        }
        case 'EXPOSE':
          for (const p of args.split(/\s+/)) {
            const port = Number(p.split('/')[0]);
            if (port && !st.config.exposed.includes(port)) st.config.exposed.push(port);
          }
          st.layers.push({ createdBy: `EXPOSE map[${args.split(/\s+/).map((p) => (p.includes('/') ? p : `${p}/tcp`) + ':{}').join(' ')}]`, size: 0 });
          break;
        case 'USER':
          st.config.user = args;
          st.layers.push({ createdBy: `USER ${args}`, size: 0 });
          break;
        case 'LABEL':
        case 'MAINTAINER':
        case 'STOPSIGNAL':
        case 'ONBUILD':
        case 'SHELL':
          st.layers.push({ createdBy: `${ins.cmd} ${args}`, size: 0 });
          break;
        case 'VOLUME': {
          const paths = execForm(args) ?? args.split(/\s+/);
          st.config.volumes = [...new Set([...(st.config.volumes ?? []), ...paths])];
          st.layers.push({ createdBy: `VOLUME ${goList(paths)}`, size: 0 });
          break;
        }
        case 'CMD':
        case 'ENTRYPOINT': {
          const v = execForm(args) ?? ['/bin/sh', '-c', args];
          if (ins.cmd === 'CMD') {
            st.config.cmd = v;
            cmdSetHere = true;
          } else {
            st.config.entrypoint = v;
            // Setting ENTRYPOINT resets the CMD inherited from the base image.
            if (!cmdSetHere) st.config.cmd = [];
          }
          st.layers.push({ createdBy: `${ins.cmd} ${goList(v)}`, size: 0 });
          break;
        }
        case 'HEALTHCHECK': {
          const m = /CMD\s+(.*)$/i.exec(args);
          if (m) {
            const ef = execForm(m[1]);
            st.config.healthcheck = ef ? ef.join(' ') : m[1];
          }
          st.layers.push({ createdBy: `HEALTHCHECK ${args}`, size: 0 });
          break;
        }
        case 'COPY':
        case 'ADD': {
          const words = shellWords(args);
          const fromFlag = words.find((w) => w.startsWith('--from='))?.slice(7);
          const chown = words.find((w) => w.startsWith('--chown='));
          void chown;
          const paths = words.filter((w) => !w.startsWith('--'));
          const dest = paths.pop() ?? '.';
          const srcs = paths;
          let source: Record<string, string>;
          let srcBase = '';
          if (fromFlag) {
            const s = stages.find((x) => x.name === fromFlag) ?? stages[Number(fromFlag)];
            if (!s) {
              n = begin(stepLabel);
              fail(ins, n, stepLabel, `failed to resolve source: stage "${fromFlag}" not found`, `invalid from flag value ${fromFlag}: pull access denied, repository does not exist or may require authorization`);
            }
            source = s!.files;
          } else {
            loadContext();
            source = context;
          }
          const copied: Record<string, string> = {};
          for (const src0 of srcs) {
            const src = fromFlag ? joinPath(st.config.workdir || '/', src0) : normalizePath(src0).slice(1);
            srcBase = src;
            const re = globToRegExp(src);
            const matches = Object.keys(source).filter((p) => {
              const key = fromFlag ? p : p;
              return re.test(key.replace(/\/$/, '')) || (src === '' ? true : key.startsWith(src.replace(/\/$/, '') + '/'));
            });
            if (!matches.length) {
              n = begin(stepLabel);
              const checksumRef = `${engine.ids.hex(25)}::${engine.ids.hex(25)}`;
              fail(ins, n, stepLabel, `failed to calculate checksum of ref ${checksumRef}: "/${src0.replace(/^\.?\//, '')}": not found`, `failed to compute cache key: failed to calculate checksum of ref ${checksumRef}: "/${src0.replace(/^\.?\//, '')}": not found`);
            }
            const destIsDir = dest.endsWith('/') || dest === '.' || srcs.length > 1 || matches.length > 1 || matches.some((p) => p.startsWith(src.replace(/\/$/, '') + '/'));
            const destAbs = joinPath(st.config.workdir || '/', dest);
            for (const p of matches) {
              let rel: string;
              if (src === '' || src === '.') rel = p;
              else if (p.startsWith(src.replace(/\/$/, '') + '/')) rel = p.slice(src.replace(/\/$/, '').length + 1);
              else rel = p.replace(/^.*\//, '');
              const target = destIsDir ? joinPath(destAbs, rel) + (p.endsWith('/') ? '/' : '') : destAbs;
              copied[target] = source[p];
            }
          }
          void srcBase;
          Object.assign(st.files, copied);
          const bytes = Object.entries(copied).reduce((s, [p, v]) => s + v.length + (p.includes('node_modules/') ? Number(v) * 1e6 || 0 : 0), 0);
          const mb = Math.max(0.0123, bytes / 1e6);
          st.layers.push({ createdBy: `${ins.cmd} ${args} # buildkit`, size: mb });
          cacheKey = hash(cacheKey + ins.raw + JSON.stringify(copied));
          break;
        }
        case 'RUN': {
          const res = simulateRun(st, ins.args);
          if (res.code !== 0) {
            n = begin(stepLabel);
            res.out.forEach((l) => line(`#${n} 0.215 ${l}`));
            fail(ins, n, stepLabel, `process "/bin/sh -c ${ins.args}" did not complete successfully: exit code: ${res.code}`, `process "/bin/sh -c ${ins.args}" did not complete successfully: exit code: ${res.code}`);
          }
          st.layers.push({ createdBy: `RUN /bin/sh -c ${ins.args} # buildkit`, size: Math.max(0.0123, res.size) });
          (ins as Instruction & { _out?: string[] })._out = res.out;
          break;
        }
      }
      if (isStep) {
        if (ins.cmd !== 'COPY' && ins.cmd !== 'ADD') cacheKey = hash(cacheKey + ins.raw);
        const cached = !broken && engine.state.buildCache.includes(cacheKey);
        if (!cached) broken = true;
        n = begin(stepLabel);
        if (cached) line(`#${n} CACHED`);
        else {
          for (const l of (ins as Instruction & { _out?: string[] })._out ?? []) line(`#${n} 0.215 ${l}`);
          line(`#${n} DONE ${ins.cmd === 'RUN' ? '0.3' : '0.0'}s`);
          engine.state.buildCache.push(cacheKey);
        }
        line('');
      }
    }
    st.size = (st.base?.size ?? 0) + st.layers.slice(st.base?.layers.length ?? 0).reduce((s, l) => s + l.size, 0);
    st.contentSize = (st.base?.contentSize ?? 0) + st.layers.slice(st.base?.layers.length ?? 0).reduce((s, l) => s + l.size * 0.35, 0);
  }

  const final = stages[lastIdx];
  const ne = begin('exporting to image');
  line(`#${ne} exporting layers 0.1s done`);
  const id = engine.ids.hex(64);
  line(`#${ne} exporting manifest sha256:${engine.ids.hex(64)} done`);
  line(`#${ne} exporting config sha256:${engine.ids.hex(64)} done`);
  line(`#${ne} exporting attestation manifest sha256:${engine.ids.hex(64)} done`);
  line(`#${ne} exporting manifest list sha256:${engine.ids.hex(64)} done`);
  const tags = o.tags.length ? o.tags : [];
  const images: Image[] = [];
  if (!tags.length) {
    line(`#${ne} writing image sha256:${id} done`);
    images.push(engine.addImage({ id, repo: '<none>', tags: [], size: final.size, contentSize: final.contentSize, layers: final.layers, config: final.config, files: final.files, created: engine.now(), origin: final.origin, buildKey: cacheKey }));
  }
  for (const t of tags) {
    const { repo, tag } = splitRef(t);
    const lib = repo.includes('/') ? repo : `library/${repo}`;
    line(`#${ne} naming to docker.io/${lib}:${tag} done`);
    line(`#${ne} unpacking to docker.io/${lib}:${tag} 0.0s done`);
    const existing = images[0];
    if (existing) existing.tags.push(tag);
    else images.push(engine.addImage({ id, repo, tags: [tag], size: final.size, contentSize: final.contentSize, layers: final.layers, config: final.config, files: final.files, created: engine.now(), origin: final.origin, buildKey: cacheKey }));
  }
  line(`#${ne} DONE 0.2s`);
  return images[0];
}

/** Simulate a RUN instruction at build time. */
function simulateRun(st: Stage, script: string): { out: string[]; code: number; size: number } {
  const out: string[] = [];
  let size = 0;
  let listsThisRun = false;
  const shErr = (prog: string) => ({ out: [...out, `/bin/sh: ${prog}: not found`], code: 127, size });
  for (const seg of splitShell(script)) {
    const w = shellWords(seg.text);
    if (!w.length) continue;
    const [prog, ...a] = w;
    const flags = a.filter((x) => x.startsWith('-'));
    const pos = a.filter((x) => !x.startsWith('-'));
    // After USER, RUN steps run as that user: system changes need root.
    const root = !st.config.user || st.config.user === 'root' || st.config.user.split(':')[0] === '0';
    if (!root) {
      if (prog === 'apk' && ['add', 'del', 'update', 'upgrade'].includes(pos[0])) return { out: [...out, 'ERROR: Unable to lock database: Permission denied', 'ERROR: Failed to open apk database: Permission denied'], code: 99, size };
      if ((prog === 'apt-get' || prog === 'apt') && ['update', 'install', 'upgrade', 'remove'].includes(pos[0])) return { out: [...out, pos[0] === 'update' ? 'E: Could not open lock file /var/lib/apt/lists/lock - open (13: Permission denied)' : 'E: Could not open lock file /var/lib/dpkg/lock-frontend - open (13: Permission denied)'], code: 100, size };
      if (['adduser', 'useradd', 'addgroup', 'groupadd'].includes(prog)) return { out: [...out, prog === 'adduser' || prog === 'addgroup' ? `${prog}: permission denied (are you root?)` : `${prog}: Permission denied.`], code: 1, size };
    }
    switch (prog) {
      case 'apt-get':
      case 'apt': {
        if (st.family !== 'debian') return shErr(prog);
        if (pos[0] === 'update') {
          st.aptLists = true;
          listsThisRun = true;
          size += 20;
          out.push('Get:1 http://deb.debian.org/debian bookworm InRelease [151 kB]', 'Reading package lists...');
        } else if (pos[0] === 'install') {
          const pkgs = pos.slice(1);
          if (!st.aptLists) return { out: [...out, 'Reading package lists...', 'Building dependency tree...', 'Reading state information...', `E: Unable to locate package ${pkgs[0] ?? ''}`], code: 100, size };
          if (!flags.some((x) => /^-[a-z]*y$|^--yes$|^--assume-yes$/.test(x))) return { out: [...out, 'Do you want to continue? [Y/n] Abort.'], code: 1, size };
          const lean = flags.includes('--no-install-recommends');
          size += pkgs.length * (lean ? 4 : 12);
          for (const p of pkgs) st.files[`/usr/bin/${p}`] = '';
          out.push(`Setting up ${pkgs.join(', ')} ...`);
        } else if (pos[0] === 'clean') {
          // no-op
        }
        break;
      }
      case 'apk': {
        if (st.family !== 'alpine') return shErr(prog);
        if (pos[0] === 'add') {
          const pkgs = pos.slice(1);
          size += pkgs.length * 3 + (flags.includes('--no-cache') ? 0 : 2);
          for (const p of pkgs) st.files[`/usr/bin/${p}`] = '';
          out.push(`(1/${pkgs.length}) Installing ${pkgs[0]}`, 'OK');
        } else if (pos[0] === 'update') size += 2;
        break;
      }
      case 'rm': {
        const target = pos.join(' ');
        if (/\/var\/lib\/apt\/lists/.test(target) && listsThisRun) size = Math.max(0, size - 20);
        for (const p of pos) {
          const abs = joinPath(st.config.workdir || '/', p).replace(/\*$/, '');
          for (const k of Object.keys(st.files)) if (k === abs || k.startsWith(abs.replace(/\/$/, '') + '/')) delete st.files[k];
        }
        break;
      }
      case 'npm': {
        const wd = st.config.workdir || '/';
        const pkg = st.files[joinPath(wd, 'package.json')];
        if (pos[0] === 'install' || pos[0] === 'i' || pos[0] === 'ci') {
          if (st.files['/usr/local/bin/npm'] === undefined) return shErr('npm');
          if (pkg === undefined) return { out: [...out, 'npm error code ENOENT', `npm error path ${joinPath(wd, 'package.json')}`, 'npm error enoent Could not read package.json'], code: 254, size };
          if (pos[0] === 'ci' && st.files[joinPath(wd, 'package-lock.json')] === undefined)
            return { out: [...out, 'npm error code EUSAGE', 'npm error', 'npm error The `npm ci` command can only install with an existing package-lock.json or', 'npm error npm-shrinkwrap.json with lockfileVersion >= 1.'], code: 1, size };
          let deps = 0;
          let dev = 0;
          try {
            const j = JSON.parse(pkg);
            deps = Object.keys(j.dependencies ?? {}).length;
            dev = Object.keys(j.devDependencies ?? {}).length;
          } catch {
            return { out: [...out, 'npm error code EJSONPARSE', 'npm error JSON.parse Invalid package.json'], code: 1, size };
          }
          const omitDev = flags.some((x) => x === '--omit=dev' || x === '--production' || x === '--only=production');
          size += deps * 6 + (omitDev ? 0 : dev * 12) + 2;
          st.files[joinPath(wd, 'node_modules/')] = '';
          out.push(`added ${deps * 20 + (omitDev ? 0 : dev * 40)} packages in 3s`);
        } else if (pos[0] === 'run') {
          const script = pos[1];
          let has = false;
          try {
            has = !!JSON.parse(pkg ?? '{}').scripts?.[script];
          } catch {
            /* ignore */
          }
          if (!has) return { out: [...out, `npm error Missing script: "${script}"`], code: 1, size };
          if (script === 'build') {
            st.files[joinPath(wd, 'dist/index.html')] = '<!doctype html><title>App</title><h1>Hello from the built app</h1>\n';
            size += 1;
            out.push('> build', 'built in 1.2s');
          }
        }
        break;
      }
      case 'pip':
      case 'pip3': {
        if (pos[0] === 'install') {
          const ri = a.indexOf('-r');
          const wd = st.config.workdir || '/';
          if (ri >= 0) {
            const f = st.files[joinPath(wd, a[ri + 1])];
            if (f === undefined) return { out: [...out, `ERROR: Could not open requirements file: [Errno 2] No such file or directory: '${a[ri + 1]}'`], code: 1, size };
            size += f.split('\n').filter((l) => l.trim()).length * 8;
          } else size += Math.max(1, pos.length - 1) * 8;
          if (!flags.includes('--no-cache-dir')) size += 10;
          out.push('Successfully installed packages');
        }
        break;
      }
      case 'echo': {
        const gt = a.findIndex((x) => x === '>' || x === '>>');
        if (gt >= 0) {
          const p = joinPath(st.config.workdir || '/', a[gt + 1] ?? '');
          st.files[p] = (a[gt] === '>>' ? st.files[p] ?? '' : '') + a.slice(0, gt).join(' ') + '\n';
        } else out.push(a.join(' '));
        break;
      }
      case 'mkdir':
        for (const p of pos) st.files[joinPath(st.config.workdir || '/', p).replace(/\/?$/, '/')] = '';
        break;
      case 'touch':
        for (const p of pos) st.files[joinPath(st.config.workdir || '/', p)] ??= '';
        break;
      case 'adduser':
      case 'useradd': {
        // Options that take a value; the user name is the first remaining word.
        const takes = new Set(['-u', '-g', '-G', '-h', '-s', '-d', '-c', '-k', '--uid', '--gid', '--home', '--shell', '--ingroup']);
        let name = '';
        let uid: number | null = null;
        for (let i = 0; i < a.length; i++) {
          if (takes.has(a[i])) {
            if (a[i] === '-u' || a[i] === '--uid') uid = Number(a[i + 1]);
            i++;
          } else if (!a[i].startsWith('-') && !name) name = a[i];
        }
        const passwd = st.files['/etc/passwd'] ?? '';
        const n = passwd.split('\n').filter((l) => /:x:\d+/.test(l)).length;
        uid ??= flags.includes('-S') ? 100 + n : flags.includes('-r') || flags.includes('--system') ? 999 - n : 1000 + n;
        if (name) st.files['/etc/passwd'] = passwd + `${name}:x:${uid}:${uid}::/home/${name}:/bin/sh\n`;
        break;
      }
      case 'addgroup':
      case 'groupadd':
        break;
      case 'exit':
        return { out, code: Number(a[0] ?? 0), size };
      case 'false':
        return { out, code: 1, size };
      default:
        size += 0.5;
    }
  }
  return { out, code: 0, size };
}

// ---------------------------------------------------------------- CLI hook

registerBuild((engine, args, out) => {
  try {
    const p = parseFlags(args, [flag('-t,--tag', true), flag('-f,--file', true), flag('--no-cache'), flag('--progress', true), flag('--target', true), flag('-q,--quiet'), flag('--build-arg', true), flag('--pull')], 'build');
    if (!p.pos[0]) throw new CliError(`ERROR: docker: 'docker buildx build' requires 1 argument\n\nUsage:  docker buildx build [OPTIONS] PATH | URL | -\n\nRun 'docker buildx build --help' for more information`, 1);
    for (const t of p.flags.get('--tag') ?? []) {
      if (/[A-Z]/.test(splitRef(t).repo)) throw new CliError(`ERROR: failed to build: invalid tag "${t}": repository name must be lowercase`, 1);
    }
    build(engine, {
      tags: p.flags.get('--tag') ?? [],
      file: p.flags.get('--file')?.slice(-1)[0] ?? 'Dockerfile',
      context: p.pos[0],
      noCache: p.flags.has('--no-cache'),
      target: p.flags.get('--target')?.slice(-1)[0],
    }, out);
    return 0;
  } catch (e) {
    if (e instanceof CliError) {
      out.err(e.text);
      return e.code;
    }
    throw e;
  }
});

// ---------------------------------------------------------------- linter

export interface LintIssue {
  kind: 'error' | 'warn' | 'tip' | 'ok';
  line?: number;
  message: string;
}

/** Best-practice review of a Dockerfile (used in lessons and the Layer Diet game). */
export function lintDockerfile(text: string): LintIssue[] {
  const { instrs, error } = parseDockerfile(text);
  const issues: LintIssue[] = [];
  if (error) return [{ kind: 'error', line: error.line, message: `Line ${error.line}: ${error.msg}. Check the spelling of the instruction.` }];
  if (!instrs.length || instrs[0].cmd !== 'FROM') issues.push({ kind: 'error', message: 'A Dockerfile must start with FROM (only ARG may come before it).' });
  const froms = instrs.filter((i) => i.cmd === 'FROM');
  for (const fr of froms) {
    const ref = fr.args.replace(/\s+AS\s+\S+$/i, '');
    if (froms.some((x) => /\s+AS\s+(\S+)/i.exec(x.args)?.[1] === ref)) continue;
    if (!ref.includes(':') && ref !== 'scratch') issues.push({ kind: 'warn', line: fr.line, message: `\`${ref}\` has no tag, so it means \`:latest\`, which changes whenever upstream updates. Pin a version, e.g. \`${ref}:<version>\`.` });
    else if (ref.endsWith(':latest')) issues.push({ kind: 'warn', line: fr.line, message: `\`${ref}\` uses \`:latest\`. Pin an explicit version for reproducible builds.` });
  }
  if (!instrs.some((i) => i.cmd === 'WORKDIR') && instrs.some((i) => i.cmd === 'COPY' || i.cmd === 'ADD'))
    issues.push({ kind: 'warn', message: 'No `WORKDIR`: files land in `/`. Add `WORKDIR /app` before copying files.' });
  const runs = instrs.filter((i) => i.cmd === 'RUN');
  runs.forEach((r, idx) => {
    if (/apt-get\s+install/.test(r.args) && !/apt-get\s+update/.test(r.args)) issues.push({ kind: 'warn', line: r.line, message: '`apt-get install` without `apt-get update` in the same RUN: a cached old `update` layer can make installs fail or get stale packages. Use `RUN apt-get update && apt-get install -y …`.' });
    if (/apt-get\s+install/.test(r.args) && !/rm\s+-rf\s+\/var\/lib\/apt\/lists/.test(r.args)) issues.push({ kind: 'tip', line: r.line, message: 'Clean the apt lists **in the same RUN** (`&& rm -rf /var/lib/apt/lists/*`). In a later RUN it doesn\'t shrink the image: the earlier layer still contains them.' });
    if (/apt-get\s+install/.test(r.args) && !/-y\b|--yes|--assume-yes/.test(r.args)) issues.push({ kind: 'error', line: r.line, message: '`apt-get install` needs `-y`: the build can\'t answer the "Do you want to continue?" prompt, so it aborts.' });
    if (/apk\s+add/.test(r.args) && !/--no-cache/.test(r.args)) issues.push({ kind: 'tip', line: r.line, message: 'Use `apk add --no-cache …` to avoid keeping the package index in the image.' });
    if (/pip3?\s+install/.test(r.args) && !/--no-cache-dir/.test(r.args)) issues.push({ kind: 'tip', line: r.line, message: 'Add `--no-cache-dir` to `pip install` to keep pip\'s download cache out of the image.' });
    if (idx > 0 && /^(apt-get|apk)\b/.test(r.args) && /^(apt-get|apk)\b/.test(runs[idx - 1].args)) issues.push({ kind: 'tip', line: r.line, message: 'Consecutive package-manager RUNs: merge them into one RUN with `&&`. Each RUN is a separate layer.' });
  });
  const copyAll = instrs.findIndex((i) => (i.cmd === 'COPY' || i.cmd === 'ADD') && /^\.\s+\S+/.test(i.args.replace(/--\S+\s+/g, '')));
  const install = instrs.findIndex((i) => i.cmd === 'RUN' && /npm\s+(ci|install|i)\b|pip3?\s+install|yarn(\s+install)?\b/.test(i.args));
  const manifest = instrs.findIndex((i) => i.cmd === 'COPY' && /package(\*|-lock)?\.json|requirements\.txt|yarn\.lock/.test(i.args));
  if (copyAll >= 0 && install > copyAll && (manifest < 0 || manifest > copyAll))
    issues.push({ kind: 'warn', line: instrs[copyAll].line, message: '`COPY . .` comes before installing dependencies, so **any code change re-runs the install**. Copy the manifest first (`COPY package*.json ./`), install, then `COPY . .`.' });
  if (!instrs.some((i) => i.cmd === 'USER')) issues.push({ kind: 'tip', message: 'No `USER`: the container runs as root. Add a non-root user (e.g. `USER node` on node images).' });
  const cmd = instrs.filter((i) => i.cmd === 'CMD').pop();
  if (cmd && !execForm(cmd.args)) issues.push({ kind: 'tip', line: cmd.line, message: 'Prefer exec form `CMD ["node", "server.js"]`: shell form runs under `/bin/sh -c`, so your app doesn\'t get signals like `docker stop`\'s SIGTERM.' });
  if (instrs.filter((i) => i.cmd === 'CMD').length > 1) issues.push({ kind: 'warn', message: 'Several `CMD` lines: only the last one counts.' });
  if (froms.length > 1) issues.push({ kind: 'ok', message: `Multi-stage build (${froms.length} stages): only the last stage ends up in the final image.` });
  if (instrs.some((i) => i.cmd === 'ADD' && !/https?:|\.tar/.test(i.args))) issues.push({ kind: 'tip', message: 'Use `COPY` for plain files; `ADD` has extra behaviour (URLs, auto-extracting archives).' });
  if (!issues.some((i) => i.kind === 'error' || i.kind === 'warn')) issues.unshift({ kind: 'ok', message: 'Looking good: no warnings.' });
  return issues;
}

export { Out };

/** The steps of a build's output, and whether each came from the cache. */
export function buildSteps(lines: { text: string }[]): { instr: string; cached: boolean }[] {
  const steps = new Map<string, { instr: string; cached: boolean }>();
  for (const { text } of lines) {
    const s = /^#(\d+) \[(?:\S+ )?\d+\/\d+\] (.*)$/.exec(text);
    if (s) {
      if (!/^FROM /.test(s[2])) steps.set(s[1], { instr: s[2], cached: false });
      continue;
    }
    const c = /^#(\d+) CACHED$/.exec(text);
    if (c && steps.has(c[1])) steps.get(c[1])!.cached = true;
  }
  return [...steps.values()];
}
