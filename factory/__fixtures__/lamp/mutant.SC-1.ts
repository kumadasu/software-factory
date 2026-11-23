import type { Event, Output } from "./interface";

type State = { want: boolean };

export const initialState = (): State => ({ want: false });

export function step(s: State, e: Event): { state: State; output: Output } {
  const n = { ...s };
  if (e.type === "user.on") n.want = true;
  if (e.type === "user.off") n.want = false;
  return { state: n, output: { lamp: n.want ? "on" : "off" } };
}
