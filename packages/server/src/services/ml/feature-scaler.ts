/**
 * Min-max feature scaler for logistic regression.
 * Normalizes features to [0, 1] range.
 */

export interface ScalerParams {
  min: number[];
  max: number[];
  median: number[];
}

export class FeatureScaler {
  private params: ScalerParams | null = null;

  /** Fit the scaler on training data and return params. */
  fit(data: number[][]): ScalerParams {
    if (data.length === 0) throw new Error('Cannot fit scaler on empty data');
    const featureCount = data[0]!.length;
    const min = new Array<number>(featureCount).fill(Infinity);
    const max = new Array<number>(featureCount).fill(-Infinity);
    const allValues: number[][] = Array.from({ length: featureCount }, () => []);

    for (const row of data) {
      for (let i = 0; i < featureCount; i++) {
        const v = row[i]!;
        if (v < min[i]!) min[i] = v;
        if (v > max[i]!) max[i] = v;
        allValues[i]!.push(v);
      }
    }

    const median = allValues.map((vals) => {
      const sorted = [...vals].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
    });

    this.params = { min, max, median };
    return this.params;
  }

  /** Load previously fitted params. */
  load(params: ScalerParams): void {
    this.params = params;
  }

  /** Get current params for serialization. */
  getParams(): ScalerParams | null {
    return this.params;
  }

  /** Transform a single feature vector. Imputes nullish values with median. */
  transform(features: number[]): number[] {
    if (!this.params) throw new Error('Scaler not fitted');
    const { min, max, median } = this.params;
    return features.map((v, i) => {
      const val = isNaN(v) || v === null || v === undefined ? median[i]! : v;
      const range = max[i]! - min[i]!;
      if (range === 0) return 0;
      return Math.max(0, Math.min(1, (val - min[i]!) / range));
    });
  }
}
