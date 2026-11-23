// Fixed helper copied into every workspace. Applies impl.step to a sequence of events.
import type { Event, Output } from "./interface";
import { initialState, step } from "./impl";

export function run(events: Event[]): Output[] {
  let state = initialState();
  const outputs: Output[] = [];
  for (const event of events) {
    const result = step(state, event);
    state = result.state;
    outputs.push(result.output);
  }
  return outputs;
}
