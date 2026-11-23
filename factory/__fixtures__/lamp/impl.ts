import type { Event, Output } from "./interface";

type State = { want: boolean; hot: boolean };

export const initialState = (): State => ({ want: false, hot: false });

export function step(s: State, e: Event): { state: State; output: Output } {
  const n = { ...s };
  if (e.type === "user.on") n.want = true;
  if (e.type === "user.off") n.want = false;
  if (e.type === "sensor.overheat") n.hot = e.active;
  return { state: n, output: { lamp: n.want && !n.hot ? "on" : "off" } };
}
