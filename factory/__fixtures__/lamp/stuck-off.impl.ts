import type { Event, Output } from "./interface";

type State = { want: boolean; tripped: boolean };

export const initialState = (): State => ({ want: false, tripped: false });

export function step(s: State, e: Event): { state: State; output: Output } {
  const n = { ...s };
  if (e.type === "user.on") n.want = true;
  if (e.type === "user.off") n.want = false;
  if (e.type === "sensor.overheat" && e.active) n.tripped = true;
  return { state: n, output: { lamp: n.want && !n.tripped ? "on" : "off" } };
}
