/**
 * Docker course content validation: every reference answer passes the checker,
 * every wrong example fails, no starter is already correct, and every worked
 * example and prediction behaves as the lesson says.
 */
import { describe, expect, it } from 'vitest';
import type { Exercise } from '../src/content/types';
import { answerLines, checkDockerProject, evaluateDocker, sandbox } from '../src/courses/docker/check';
import { DOCKER_MODULES } from '../src/courses/docker/content/index';
import { dockerContent } from '../src/courses/docker/content';
import { detectDockerMisconceptions } from '../src/courses/docker/misconceptions';

const conceptIds = new Set(DOCKER_MODULES.flatMap((m) => m.concepts.map((c) => c.id)));

function runLines(code: string, env?: Parameters<typeof sandbox>[0]) {
  const e = sandbox(env);
  return answerLines(code).map((cmd) => ({ cmd, ...e.exec(cmd) }));
}

describe('structure', () => {
  it('ids are unique and concept references exist', () => {
    const ids = new Set<string>();
    for (const m of DOCKER_MODULES) {
      for (const x of [...m.concepts, ...m.practice, ...m.test]) {
        expect(ids.has(x.id), x.id).toBe(false);
        ids.add(x.id);
      }
      for (const e of [...m.practice, ...m.test]) for (const c of e.conceptIds) expect(conceptIds.has(c), `${e.id} → ${c}`).toBe(true);
      for (const g of m.games) expect(dockerContent.games[g], g).toBeTruthy();
    }
  });
  it('every checked exercise has a docker spec; choices are valid', () => {
    for (const m of DOCKER_MODULES)
      for (const e of [...m.practice, ...m.test]) {
        if (e.kind === 'readQuery') expect(e.answer).toBeLessThan(e.choices.length);
        else expect(e.docker, e.id).toBeTruthy();
      }
  });
  it('every concept is practised by at least one practice item', () => {
    for (const m of DOCKER_MODULES) for (const c of m.concepts) expect(m.practice.some((e) => e.conceptIds.includes(c.id)), c.id).toBe(true);
  });
});

describe('worked examples and predictions', () => {
  for (const m of DOCKER_MODULES)
    for (const c of m.concepts) {
      it(c.id, () => {
        const failing = runLines(c.example.sql, c.env).filter((r) => r.exitCode !== 0);
        if (!c.predict?.expectError) expect(failing.map((f) => `${f.cmd} → ${f.lines.map((l) => l.text).join(' ')}`)).toEqual([]);
        if (c.predict) {
          expect(c.predict.answer).toBeLessThan(c.predict.choices.length);
          const p = runLines(c.predict.sql, c.env);
          const bad = p.filter((r) => r.exitCode !== 0);
          if (c.predict.expectError) expect(bad.length, 'expected an error').toBeGreaterThan(0);
          else expect(bad.map((f) => f.cmd)).toEqual([]);
        }
      });
    }
});

const checked = DOCKER_MODULES.flatMap((m) => [...m.practice, ...m.test]).filter((e) => e.kind !== 'readQuery');
const reference = (e: Exercise) => (e.kind === 'parsons' ? e.blocks.join('\n') : 'solution' in e ? e.solution : '');

describe('exercises', () => {
  for (const e of checked) {
    it(e.id, () => {
      const good = evaluateDocker(e, reference(e));
      expect(good.feedback, 'solution should pass').toEqual([]);
      expect(good.status).toBe('correct');
      const wrong = e.kind === 'parsons' ? e.wrongOrder.join('\n') : 'wrongExample' in e ? e.wrongExample : '';
      const w = evaluateDocker(e, wrong);
      expect(w.status, 'wrong example should fail').not.toBe('correct');
      expect(w.feedback.length).toBeGreaterThan(0);
      if ('starterSql' in e && e.starterSql) expect(evaluateDocker(e, e.starterSql).status, 'starter should not pass').not.toBe('correct');
      if (e.kind === 'parsons') for (const d of e.distractors ?? []) expect(e.blocks).not.toContain(d);
    });
  }
});

describe('checker feedback and misconceptions', () => {
  const find = (id: string) => checked.find((e) => e.id === id)!;
  it('reversed -p is explained', () => {
    const e = find('d03-p1');
    const o = evaluateDocker(e, 'docker run -d --name web -p 80:8080 nginx');
    expect(o.feedback.join(' ')).toContain('host port goes first');
    expect(detectDockerMisconceptions({ answer: 'docker run -d --name web -p 80:8080 nginx', spec: e.docker!, outcome: o }).map((m) => m.id)).toContain('port-order');
  });
  it('a missing --name is explained', () => {
    const o = evaluateDocker(find('d01-p7'), 'docker run -d nginx');
    expect(o.feedback.join(' ')).toMatch(/random name.*--name site/);
  });
  it('a missing -d is caught', () => {
    const e = find('d01-p7');
    const o = evaluateDocker(e, 'docker run --name site nginx');
    expect(o.status).toBe('wrong');
    expect(detectDockerMisconceptions({ answer: 'docker run --name site nginx', spec: e.docker!, outcome: o }).map((m) => m.id)).toContain('missing-d');
  });
  it('options after the image are recognised', () => {
    const e = find('d01-p8');
    const o = evaluateDocker(e, 'docker run redis -d --name cache');
    expect(detectDockerMisconceptions({ answer: 'docker run redis -d --name cache', spec: e.docker!, outcome: o }).map((m) => m.id)).toContain('options-after-image');
  });
  it('equivalent answers pass', () => {
    expect(evaluateDocker(find('d01-p7'), 'docker run --name site -d nginx:latest').status).toBe('correct');
    expect(evaluateDocker(find('d01-p4'), 'docker run --rm alpine echo hello docker').status).toBe('correct');
    expect(evaluateDocker(find('d02-p2'), 'docker stop web\ndocker rm web').status).toBe('correct');
    expect(evaluateDocker(find('d02-p10'), 'docker rm old1 old2').status).toBe('correct');
    expect(evaluateDocker(find('d02-p7'), 'docker run -dit --name worker alpine').status).toBe('correct');
    expect(evaluateDocker(find('d03-p9'), 'docker exec web curl -s http://localhost:80/').status).toBe('correct');
  });
  it('Dockerfile mistakes are named', () => {
    const ids = (id: string, answer: string) => {
      const e = find(id);
      return detectDockerMisconceptions({ answer, spec: e.docker!, outcome: evaluateDocker(e, answer) }).map((m) => m.id);
    };
    expect(ids('d06-p1', 'FROM alpine\nRUN echo "Hello, Docker!"')).toContain('run-vs-cmd');
    expect(ids('d06-p7', 'FROM alpine\nENV GREETING=hello\nCMD ["echo", "$GREETING"]')).toContain('exec-form-vars');
    expect(ids('d06-p4', 'FROM alpine\nRUN apt-get update && apt-get install -y curl\nCMD ["curl", "--version"]')).toContain('apt-family');
    expect(ids('d06-t4', 'FROM node:22-alpine\nWORKDIR /app\nCOPY hello.js /\nCMD ["node", "hello.js"]')).toContain('missing-copy');
    expect(ids('d04-p5', 'docker run -d --name web -p 8080:80 -v site:/usr/share/nginx/html nginx')).toContain('bind-vs-volume');
    expect(ids('d05-p3', 'docker run -d --name server alpine sleep 3600\ndocker run -d --name client alpine sleep 3600\ndocker exec client ping -c 1 server')).toContain('default-bridge-dns');
  });
  it('equivalent Dockerfiles and commands pass', () => {
    expect(evaluateDocker(find('d06-p7'), 'FROM alpine\nENV GREETING=hello\nCMD echo $GREETING').status).toBe('correct');
    expect(evaluateDocker(find('d04-p5'), 'docker run -d --name web -p 8080:80 -v $(pwd)/site:/usr/share/nginx/html nginx').status).toBe('correct');
    expect(evaluateDocker(find('d04-p5'), "docker run -d --name web -p 8080:80 --mount type=bind,source=\"$PWD/site\",target=/usr/share/nginx/html nginx").status).toBe('correct');
    expect(evaluateDocker(find('d04-p9'), 'docker rm tmp && docker volume rm scratch').status).toBe('correct');
    expect(evaluateDocker(find('d05-p3'), 'docker network create chat\ndocker run -d --name server --network chat alpine sleep 3600\ndocker run -d --name client --network chat alpine sleep 3600\ndocker exec client ping -c 1 server').status).toBe('correct');
  });
  it('blanks are rejected without running', () => {
    expect(evaluateDocker(find('d01-p6'), 'docker run ___ --name web nginx').feedback[0]).toMatch(/blank/);
  });
});

describe('projects', () => {
  for (const m of DOCKER_MODULES)
    for (const t of m.project?.tasks ?? []) {
      it(`${m.id} ${t.id}`, () => {
        const good = checkDockerProject(t, t.referenceSolution);
        expect(good.requirements.map((r, i) => (r.ok ? 'ok' : `${t.requirements[i].label} → ${r.output}`))).toEqual(t.requirements.map(() => 'ok'));
        expect(checkDockerProject(t, '').requirements.some((r) => !r.ok), 'doing nothing must not pass').toBe(true);
      });
    }
  it('killing Redis instead of stopping it fails the upgrade task', () => {
    const t = DOCKER_MODULES.flatMap((m) => m.project?.tasks ?? []).find((x) => x.id === 'dpa-4')!;
    const r = checkDockerProject(t, 'docker rm -f cache\ndocker run -d --name cache --network shop -v cachedata:/data redis:alpine');
    expect(r.requirements[1].ok).toBe(false);
  });
});
