export type Event =
  | { type: "user.on" }
  | { type: "user.off" }
  | { type: "sensor.overheat"; active: boolean };

export type Output = { lamp: "on" | "off" };

export const IO = {
  inputs: ["user.on", "user.off", "sensor.overheat"],
  outputs: ["lamp"],
} as const;
