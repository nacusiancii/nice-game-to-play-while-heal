// Small helpers over the shared RunState.
import type { RunState, Unit } from '../../server/src/game/core';

export const cloneUnit = (u: Unit): Unit => ({ ...u });
export function cloneRun(st: RunState): RunState {
  return {
    ...st,
    team: st.team.map(cloneUnit),
    shop: st.shop.map(s => ({ ...s })),
    relics: [...st.relics],
    relicChoices: [...st.relicChoices],
  };
}

// Living units first, empty slots last. Battles ignore empty slots, so this changes nothing in play.
export function compact(st: RunState) {
  const units = st.team.filter(u => u.kind);
  const empties = st.team.filter(u => !u.kind);
  st.team = [...units, ...empties];
}
