/** Docker game missions: unsolved at the start, solved by their solution within par. */
import { describe, expect, it } from 'vitest';
import { BREAK_IT, DATA_RESCUE, ENGINE_MATCH, goalsMet, isLookOnly, LIFECYCLE_RUSH, PORT_CONTROL, prepareMission, SWITCHBOARD, type Mission } from '../src/courses/docker/games/missions';
import { missionScore } from '../src/courses/docker/games/MissionRounds';
import { cook, KITCHEN, ordersMet } from '../src/courses/docker/games/kitchen';
import { dietMet, LAYER_DIET, weigh } from '../src/courses/docker/games/layerdiet';
import { blueprintMet, COMPOSER, deploy } from '../src/courses/docker/games/composer';
import { ACTS, actMet, prepareIncident } from '../src/courses/docker/games/incident';

const all: [string, Mission[]][] = [
  ['Engine Match', ENGINE_MATCH],
  ['Lifecycle Rush', LIFECYCLE_RUSH],
  ['Port Traffic Control', PORT_CONTROL],
  ['Data Rescue', DATA_RESCUE],
  ['Network Switchboard', SWITCHBOARD],
  ['Break It', BREAK_IT],
];

for (const [game, missions] of all) {
  describe(game, () => {
    for (const m of missions) {
      it(m.title, () => {
        const { engine, start } = prepareMission(m);
        for (const c of m.setup) expect(c).toBeTruthy();
        const before = goalsMet(m, engine, start);
        expect(before.every(Boolean) && !m.ask, 'already solved at the start').toBe(false);
        let actions = 0;
        for (const c of m.solution) {
          const r = engine.exec(c);
          expect(r.exitCode, `${c}: ${r.lines.map((l) => l.text).join(' ')}`).toBe(0);
          if (!isLookOnly(c)) actions++;
        }
        expect(goalsMet(m, engine, start)).toEqual(m.goals.map(() => true));
        expect(actions).toBeLessThanOrEqual(m.par);
        if (m.ask) {
          expect(m.solutionAnswer).toBeTruthy();
          expect(m.ask.answer(engine).toLowerCase()).toBe(m.solutionAnswer!.toLowerCase());
          // The answer must actually appear in what the solution's commands print.
          const shown = m.solution.map((c) => engine.exec(c).lines.map((l) => l.text).join('\n')).join('\n');
          expect(shown).toContain(m.solutionAnswer);
        }
      });
    }
  });
}

describe('mission traps', () => {
  const play = (m: Mission, cmds: string[]) => {
    const { engine, start } = prepareMission(m);
    for (const c of cmds) engine.exec(c);
    return goalsMet(m, engine, start);
  };
  it('Data Rescue 4: rm -f kills Redis before it saves, so the count is lost', () => {
    expect(play(DATA_RESCUE[3], ['docker rm -f cache', 'docker run -d --name cache -v cachedata:/data redis:alpine'])).toEqual([true, false]);
  });
  it('Data Rescue 5: a writable bind mount is not enough', () => {
    expect(play(DATA_RESCUE[4], ['docker run -d --name evidence -p 8080:80 -v ./case:/usr/share/nginx/html nginx'])).toEqual([true, false]);
  });
  it('Data Rescue 6: prune without -a leaves old_cache', () => {
    expect(play(DATA_RESCUE[5], ['docker volume prune -f'])[0]).toBe(false);
  });
  it('Switchboard 3: putting web on back joins it with db', () => {
    expect(play(SWITCHBOARD[2], ['docker network connect back web', 'docker network connect back api'])).toEqual([true, true, false]);
  });
  it('Switchboard 2: moving the server breaks the rule', () => {
    expect(play(SWITCHBOARD[1], ['docker network connect net-a server'])).toEqual([true, false]);
  });
  it('Lifecycle Rush 1: a new container named web does not count as bringing it back', () => {
    const m = LIFECYCLE_RUSH[0];
    const { engine, start } = prepareMission(m);
    engine.exec('docker rm web');
    engine.exec('docker run -d --name web nginx');
    expect(goalsMet(m, engine, start)).toEqual([true, false]);
  });
  it('Port Control 4: -p 8080:8080 again stays broken', () => {
    const m = PORT_CONTROL[3];
    const { engine, start } = prepareMission(m);
    engine.exec('docker rm -f broken');
    engine.exec('docker run -d --name fixed -p 8080:8080 nginx');
    expect(goalsMet(m, engine, start)).toEqual([false]);
  });
  it('Port Control 5: one whoami on two ports is not two containers', () => {
    const m = PORT_CONTROL[4];
    const { engine, start } = prepareMission(m);
    engine.exec('docker run -d --name w -p 8001:80 -p 8002:80 traefik/whoami');
    engine.exec('docker run -d --name web -p 8003:80 nginx');
    expect(goalsMet(m, engine, start)).toEqual([true, true, true, false]);
  });
  it('probing a lane leaves no access-log line', () => {
    const { engine } = prepareMission(PORT_CONTROL[0]);
    engine.exec('docker run -d --name web -p 8080:80 nginx');
    const before = engine.findContainer('web')!.logs.length;
    expect(engine.probe(8080).code).toBe(0);
    expect(engine.findContainer('web')!.logs.length).toBe(before);
  });
  it('scores: par is full marks, extra commands and hints cost, never below 30', () => {
    expect(missionScore(1, 1, false)).toBe(100);
    expect(missionScore(3, 1, false)).toBe(70);
    expect(missionScore(1, 1, true)).toBe(75);
    expect(missionScore(20, 1, true)).toBe(30);
  });
});

describe('Dockerfile Kitchen', () => {
  for (const o of KITCHEN) {
    it(o.title, () => {
      const t = cook(o, o.solution);
      expect(t.built, t.transcript.flatMap((x) => x.lines.map((l) => l.text)).join('\n')).toBe(true);
      expect(ordersMet(o, t)).toEqual(o.goals.map(() => true));
      expect(ordersMet(o, cook(o, o.starter)).every(Boolean), 'starter must not pass').toBe(false);
    });
  }
  it('traps: RUN instead of CMD, apk with cache, CMD-only greeter', () => {
    expect(ordersMet(KITCHEN[0], cook(KITCHEN[0], 'FROM alpine\nRUN echo "Order up!"'))).toEqual([true, true, false]);
    expect(ordersMet(KITCHEN[3], cook(KITCHEN[3], 'FROM alpine\nRUN apk add curl\nCMD ["curl", "--version"]'))).toEqual([true, true, true, false]);
    expect(ordersMet(KITCHEN[4], cook(KITCHEN[4], 'FROM alpine\nCMD ["echo", "Hello", "world"]'))).toEqual([true, true, false]);
  });
});

describe('Layer Diet', () => {
  for (const d of LAYER_DIET) {
    it(d.title, () => {
      const w = weigh(d, d.solution, d.solutionIgnore);
      expect(w.built, w.transcript.flatMap((x) => x.lines.map((l) => l.text)).join('\n')).toBe(true);
      expect(dietMet(d, w).map((ok, i) => (ok ? 'ok' : d.goals[i].label))).toEqual(d.goals.map(() => 'ok'));
      expect(dietMet(d, weigh(d, d.starter, d.ignore)).every(Boolean), 'starter must not pass').toBe(false);
    });
  }
  it('traps: cleaning up in a later RUN, a .dockerignore that forgets .env, USER before useradd', () => {
    const apt = LAYER_DIET[3];
    expect(dietMet(apt, weigh(apt, 'FROM debian:12-slim\nRUN apt-get update && apt-get install -y curl\nRUN rm -rf /var/lib/apt/lists/*\nCMD ["curl", "--version"]\n'))).toEqual([true, false]);
    const fridge = LAYER_DIET[2];
    expect(dietMet(fridge, weigh(fridge, fridge.solution, 'node_modules\n.git\n'))).toEqual([true, false, true, true]);
    const full = LAYER_DIET[5];
    const w = weigh(full, full.solution.replace('RUN useradd -r app\nUSER app\n', 'USER app\nRUN useradd -r app\n'));
    expect(w.built).toBe(false);
  });
});

describe('Compose Architect', () => {
  for (const b of COMPOSER) {
    it(b.title, () => {
      const d = deploy(b, b.solution);
      expect(d.ok, d.transcript[0].lines.map((l) => l.text).join('\n')).toBe(true);
      expect(blueprintMet(b, d).map((ok, i) => (ok ? 'ok' : b.goals[i].label))).toEqual(b.goals.map(() => 'ok'));
      expect(blueprintMet(b, deploy(b, b.starter)).every(Boolean), 'starter must not pass').toBe(false);
    });
  }
  it('traps: publishing the cache, a bind path instead of a named volume, no networks', () => {
    expect(blueprintMet(COMPOSER[1], deploy(COMPOSER[1], COMPOSER[1].solution + '    ports:\n      - "6379:6379"\n'))[3]).toBe(false);
    const vault = COMPOSER[2].solution.replace('dbdata:/var', './dbdata:/var');
    expect(blueprintMet(COMPOSER[2], deploy(COMPOSER[2], vault))[1]).toBe(false);
    expect(blueprintMet(COMPOSER[3], deploy(COMPOSER[3], COMPOSER[3].starter))).toEqual([true, true, false, true]);
  });
});

describe('Break It traps', () => {
  const play = (m: Mission, cmds: string[]) => {
    const { engine, start } = prepareMission(m);
    for (const c of cmds) engine.exec(c);
    return goalsMet(m, engine, start);
  };
  it('restarting the crash loop doesn\'t fix it', () => {
    expect(play(BREAK_IT[2], ['docker restart db'])[0]).toBe(false);
  });
  it('a restart policy doesn\'t save an OOM-killed job', () => {
    expect(play(BREAK_IT[3], ['docker run --name report2 --memory 256m --restart on-failure:3 report'])).toEqual([false]);
  });
  it('volume prune would be tempting but the goals forbid losing pgdata', () => {
    const r = play(BREAK_IT[6], ['docker rm -f db', 'docker system prune -af --volumes', 'docker volume prune -af']);
    expect(r[2] && r[3]).toBe(false);
  });
  it('the health check on the host port stays unhealthy', () => {
    expect(play(BREAK_IT[7], ['docker restart web'])[0]).toBe(false);
  });
});

describe('Production Incident', () => {
  it('each act is open when it begins and closed by its reference fix, within par', () => {
    const { engine, start } = prepareIncident();
    for (const a of ACTS) {
      const before = actMet(a, engine, start);
      expect(before.every(Boolean) && !a.ask, `${a.title}: already solved`).toBe(false);
      let actions = 0;
      let shown = '';
      for (const c of a.solution) {
        const r = engine.exec(c);
        expect(r.exitCode, `${a.title}: ${c}`).toBe(a.title.includes('website') && c.startsWith('curl') ? 56 : 0);
        shown += r.lines.map((l) => l.text).join('\n');
        if (!isLookOnly(c)) actions++;
      }
      expect(actMet(a, engine, start), a.title).toEqual(a.goals.map(() => true));
      expect(actions, a.title).toBeLessThanOrEqual(a.par);
      if (a.ask) {
        expect(a.ask.accept.test(a.solutionAnswer!)).toBe(true);
        expect(shown).toContain('Restarting');
      }
    }
  });
  it('pruning volumes in act 5 loses the orders', () => {
    const { engine, start } = prepareIncident();
    for (const a of ACTS.slice(0, 4)) for (const c of a.solution) engine.exec(c);
    engine.exec('docker compose down');
    engine.exec('docker system prune -af --volumes');
    engine.exec('docker volume prune -af');
    engine.exec('docker compose up -d');
    expect(actMet(ACTS[3], engine, start)[2]).toBe(false);
  });
});
