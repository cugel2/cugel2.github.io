import type { RawSample } from "./types";

export function rawSampleIdentity(sample: RawSample): string {
  return `${sample.xCss}|${sample.yCss}|${sample.tMs}`;
}

export function deduplicateRawSamples(samples: readonly RawSample[]): RawSample[] {
  const seen = new Set<string>();
  const unique: RawSample[] = [];
  for (const sample of samples) {
    const identity = rawSampleIdentity(sample);
    if (seen.has(identity)) continue;
    seen.add(identity);
    unique.push(sample);
  }
  return unique;
}
