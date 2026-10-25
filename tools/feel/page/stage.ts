// The battle stage: the real client's battle view, fed a battle computed by tools/feel instead of the server.
import '../../../client/src/style.css';
import { playBattle, type BattleMeta } from '../../../client/src/battleView';
import type { Battle } from '../../../client/src/module_bindings/types';

const app = document.getElementById('app')!;
const w = window as unknown as Record<string, unknown>;

w.__feelStage = (battle: Battle, meta: BattleMeta, speed: number) => {
  localStorage.setItem('rabble-below/speed', String(speed));
  localStorage.setItem('rabble-below/muted', '0');
  playBattle(app, battle, meta, () => {
    (w.__feel as (k: string, d?: unknown) => void)?.('stage', 'done');
    app.replaceChildren();
  });
};
w.__feelStageReady = true;
