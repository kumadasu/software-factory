export const UCA_TYPES = ["notProvided", "providedUnsafe", "wrongTiming", "wrongDuration"] as const;
export type UcaType = (typeof UCA_TYPES)[number];

export type Analysis = {
  controllers: { id: string; implemented: boolean }[];
  losses: { id: string; text: string }[];
  hazards: { id: string; text: string; losses: string[] }[];
  controlActions: { id: string; controller: string; name: string; event?: string }[];
  ucas: { id: string; action: string; type: UcaType; context: string; hazards: string[] }[];
  notApplicable: { action: string; type: UcaType; reason: string }[];
  constraints: { id: string; text: string; ucas: string[]; refs: string[] }[];
};
