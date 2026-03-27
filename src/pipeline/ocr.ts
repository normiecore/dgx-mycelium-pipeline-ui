import { logger } from '../config/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OcrRegion {
  text: string;
  bbox: [number, number, number, number]; // x1, y1, x2, y2
  confidence: number;
}

export interface OcrResult {
  text: string;
  confidence: number;
  regions: OcrRegion[];
  processingTimeMs: number;
}

// ---------------------------------------------------------------------------
// PaddleOCR response shape (POST /predict/ocr_system)
// ---------------------------------------------------------------------------

interface PaddleOcrRegion {
  text: string;
  confidence: number;
  text_region: number[][];
}

interface PaddleOcrResponse {
  results?: PaddleOcrRegion[][];
  // Hub Serving format wraps in a "results" array of arrays
}

// ---------------------------------------------------------------------------
// OcrClient — calls PaddleOCR Hub Serving REST API
// ---------------------------------------------------------------------------

export class OcrClient {
  private baseUrl: string;
  private timeoutMs: number;

  constructor(baseUrl?: string, timeoutMs?: number) {
    this.baseUrl = baseUrl ?? process.env.OCR_BASE_URL ?? 'http://paddleocr:8866';
    this.timeoutMs = timeoutMs ?? parseInt(process.env.OCR_TIMEOUT_MS ?? '10000', 10);
  }

  /**
   * Health check — returns true when the PaddleOCR service is reachable.
   */
  async isAvailable(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3_000);
      const res = await fetch(`${this.baseUrl}/ping`, {
        method: 'GET',
        signal: controller.signal,
      });
      clearTimeout(timer);
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Send a base64-encoded image to PaddleOCR and return structured text.
   *
   * Returns `null` when the OCR service is unreachable or returns an error,
   * so the pipeline can gracefully continue without OCR.
   */
  async extractText(base64Image: string): Promise<OcrResult | null> {
    const start = Date.now();

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      const res = await fetch(`${this.baseUrl}/predict/ocr_system`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          images: [base64Image],
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        logger.warn(
          { status: res.status, url: this.baseUrl },
          'PaddleOCR returned non-OK status',
        );
        return null;
      }

      const body = (await res.json()) as PaddleOcrResponse;
      const processingTimeMs = Date.now() - start;

      return this.parseResponse(body, processingTimeMs);
    } catch (err: unknown) {
      const elapsed = Date.now() - start;
      const message = err instanceof Error ? err.message : String(err);

      if (message.includes('abort')) {
        logger.warn({ elapsed, timeoutMs: this.timeoutMs }, 'PaddleOCR request timed out');
      } else {
        logger.warn({ err: message, url: this.baseUrl }, 'PaddleOCR request failed');
      }

      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /**
   * Parse the PaddleOCR Hub Serving response into our OcrResult shape.
   *
   * PaddleOCR returns `results` as an array of arrays (one per image).
   * Each inner element has `text`, `confidence`, and `text_region`
   * (a polygon of 4 [x, y] pairs). We derive a simple bbox from the polygon
   * and sort regions top-to-bottom, left-to-right for natural reading order.
   */
  private parseResponse(body: PaddleOcrResponse, processingTimeMs: number): OcrResult {
    const rawRegions = body.results?.[0] ?? [];

    const regions: OcrRegion[] = rawRegions.map((r) => {
      const xs = r.text_region.map((p) => p[0]);
      const ys = r.text_region.map((p) => p[1]);
      const bbox: [number, number, number, number] = [
        Math.min(...xs),
        Math.min(...ys),
        Math.max(...xs),
        Math.max(...ys),
      ];
      return {
        text: r.text,
        confidence: r.confidence,
        bbox,
      };
    });

    // Sort top-to-bottom (y1), then left-to-right (x1) for reading order
    regions.sort((a, b) => {
      const yDiff = a.bbox[1] - b.bbox[1];
      // Treat regions within 10px vertically as the same line
      if (Math.abs(yDiff) < 10) {
        return a.bbox[0] - b.bbox[0];
      }
      return yDiff;
    });

    const text = regions.map((r) => r.text).join('\n');
    const confidence =
      regions.length > 0
        ? regions.reduce((sum, r) => sum + r.confidence, 0) / regions.length
        : 0;

    return { text, confidence, regions, processingTimeMs };
  }
}
