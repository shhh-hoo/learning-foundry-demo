import { SpanStatusCode, trace, type Attributes } from "@opentelemetry/api";

const tracer = trace.getTracer("learning-foundry", "1.0.0");

export async function traced<T>(name: string, attributes: Attributes, run: () => Promise<T>): Promise<T> {
  return tracer.startActiveSpan(name, { attributes: redactAttributes(attributes) }, async (span) => {
    try {
      const result = await run();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(error instanceof Error ? error : new Error(String(error)));
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}

export function redactAttributes(attributes: Attributes): Attributes {
  return Object.fromEntries(Object.entries(attributes).map(([key, value]) => {
    if (/content|password|secret|authorization|private/i.test(key)) return [key, "[REDACTED]"];
    return [key, value];
  }));
}
