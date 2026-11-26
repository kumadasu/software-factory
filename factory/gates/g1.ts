import { UCA_TYPES, type Analysis } from "./analysis";

export type IONames = { inputs: string[]; outputs: string[] };

/** Extract the string arrays of `export const IO = { inputs: [...], outputs: [...] }`. */
export function readIO(src: string): IONames {
  const pick = (key: string) => {
    const m = src.match(new RegExp(`${key}\\s*:\\s*\\[([^\\]]*)\\]`));
    return m ? [...m[1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]) : [];
  };
  return { inputs: pick("inputs"), outputs: pick("outputs") };
}

const ARRAY_FIELDS = ["controllers", "losses", "hazards", "controlActions", "ucas", "notApplicable", "constraints"];

export function checkAnalysis(raw: unknown, io: IONames): string[] {
  if (typeof raw !== "object" || raw === null || ARRAY_FIELDS.some((f) => !Array.isArray((raw as any)[f]))) {
    return ["analysis must be a JSON object with array fields"];
  }
  const a = raw as Analysis;
  const errs: string[] = [];

  const ids = [...a.losses, ...a.hazards, ...a.controlActions, ...a.ucas, ...a.constraints].map((x) => x.id);
  for (const id of new Set(ids)) if (ids.filter((x) => x === id).length > 1) errs.push(`duplicate id ${id}`);

  const lossIds = new Set(a.losses.map((x) => x.id));
  const hazardIds = new Set(a.hazards.map((x) => x.id));
  const ucaIds = new Set(a.ucas.map((x) => x.id));
  const controllers = new Map(a.controllers.map((c) => [c.id, c]));
  const actions = new Map(a.controlActions.map((c) => [c.id, c]));

  for (const h of a.hazards) {
    if (h.losses.length === 0) errs.push(`${h.id} links to no loss`);
    for (const l of h.losses) if (!lossIds.has(l)) errs.push(`${h.id} refers to unknown loss ${l}`);
  }

  for (const ca of a.controlActions) {
    const c = controllers.get(ca.controller);
    if (!c) {
      errs.push(`${ca.id} refers to unknown controller ${ca.controller}`);
      continue;
    }
    if (!c.implemented && (!ca.event || !io.inputs.includes(ca.event))) {
      errs.push(`${ca.id} belongs to an external controller but has no valid input event`);
    }
  }

  for (const u of a.ucas) {
    if (!actions.has(u.action)) errs.push(`${u.id} refers to unknown action ${u.action}`);
    if (!UCA_TYPES.includes(u.type)) errs.push(`${u.id} has invalid type ${u.type}`);
    if (u.hazards.length === 0) errs.push(`${u.id} links to no hazard`);
    for (const h of u.hazards) if (!hazardIds.has(h)) errs.push(`${u.id} refers to unknown hazard ${h}`);
  }

  for (const n of a.notApplicable) {
    if (!n.reason || n.reason.trim() === "") errs.push(`notApplicable ${n.action} x ${n.type} needs a reason`);
  }

  for (const ca of a.controlActions) {
    for (const t of UCA_TYPES) {
      const covered =
        a.ucas.some((u) => u.action === ca.id && u.type === t) ||
        a.notApplicable.some((n) => n.action === ca.id && n.type === t);
      if (!covered) errs.push(`${ca.id} x ${t} has neither a UCA nor a notApplicable entry`);
    }
  }

  const known = new Set([...io.inputs.map((n) => `input.${n}`), ...io.outputs.map((n) => `output.${n}`)]);
  for (const sc of a.constraints) {
    for (const u of sc.ucas) if (!ucaIds.has(u)) errs.push(`${sc.id} refers to unknown UCA ${u}`);
    for (const r of sc.refs) if (!known.has(r)) errs.push(`${sc.id} refs unknown name ${r}`);
    if (!sc.refs.some((r) => r.startsWith("output."))) errs.push(`${sc.id} must reference at least one output`);
  }
  for (const u of a.ucas) {
    if (!a.constraints.some((sc) => sc.ucas.includes(u.id))) errs.push(`${u.id} is not covered by any constraint`);
  }

  const n = a.controlActions.length;
  if (n < 2 || n > 6) errs.push(`controlActions must number 2..6 (got ${n})`);
  const m = a.constraints.length;
  if (m < 1 || m > 16) errs.push(`constraints must number 1..16 (got ${m})`);

  return errs;
}
