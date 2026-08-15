export interface Muestra {
  ts: number; // epoch ms
  value: number; // % battery
}

export interface Prevision {
  /** %/hour: negative discharges, positive charges */
  pendiente: number;
  /** hours to 0 % at the current rate · undefined when not discharging */
  horasRestantes?: number;
  /** how much to trust it: 0..1 from the spread of the points around the line */
  ajuste: number;
  muestras: number;
  ultimo: number; // last known %
}

/** Least squares linear regression over the last `horas` hours of battery.
 *
 *  A solar node charges by day and drains by night: fitting over a long window
 *  would give a slope near 0 and a useless forecast. A short window predicts
 *  the current leg, which is the actionable part ("it won't last the night").
 *
 *  Returns undefined when there isn't enough data to say anything honest. */
export function preverBateria(
  muestras: Muestra[],
  horas = 6,
  ahora = Date.now(),
): Prevision | undefined {
  const desde = ahora - horas * 3_600_000;
  // >100 % is external power, not a battery: it would skew the line
  const pts = muestras
    .filter((m) => m.ts >= desde && m.value <= 100)
    .sort((a, b) => a.ts - b.ts);
  if (pts.length < 4) return undefined;

  const t0 = pts[0].ts;
  // x in hours from the first sample: avoids huge numbers in the regression
  const xs = pts.map((p) => (p.ts - t0) / 3_600_000);
  const ys = pts.map((p) => p.value);
  const n = pts.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
  }
  // all samples at the same instant: no line is possible
  if (sxx === 0) return undefined;
  const pendiente = sxy / sxx;
  const interseccion = my - pendiente * mx;

  // R²: if the points don't follow a line, the forecast is worthless
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    ssRes += (ys[i] - (interseccion + pendiente * xs[i])) ** 2;
    ssTot += (ys[i] - my) ** 2;
  }
  // flat battery (ssTot 0): the line is exact, R²=1 by convention
  const ajuste = ssTot === 0 ? 1 : Math.max(0, 1 - ssRes / ssTot);

  const ultimo = ys[n - 1];
  const r: Prevision = { pendiente, ajuste, muestras: n, ultimo };
  // predicting a runout only makes sense when it really drops; a threshold
  // slightly below 0 keeps the noise of a flat battery from becoming a warning
  if (pendiente < -0.05) {
    r.horasRestantes = ultimo / -pendiente;
  }
  return r;
}

/** Short text for the UI. Returns the key and the arguments for t(). */
export function textoPrevision(p: Prevision): [string, ...(string | number)[]] {
  if (p.ajuste < 0.5) return ["BATERÍA IRREGULAR · sin previsión fiable"];
  if (p.pendiente > 0.05) return ["CARGANDO · {0} %/h", p.pendiente.toFixed(1)];
  if (p.horasRestantes === undefined) return ["ESTABLE · sin descarga apreciable"];
  const h = p.horasRestantes;
  if (h < 48) return ["SE AGOTA EN ~{0} h", Math.round(h)];
  return ["SE AGOTA EN ~{0} días", Math.round(h / 24)];
}
