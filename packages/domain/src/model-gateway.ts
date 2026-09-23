/**
 * AFI Agentic Fraud Investigation — Model Gateway Abstraction
 * Provider-agnostic model routing, structured JSON parsing, timeouts, and error handling.
 * Eliminates provider lock-in and prevents storing hidden chain-of-thought.
 */

export interface ModelMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

export interface ModelCompletionRequest<TResponse> {
  readonly model?: string;
  readonly messages: readonly ModelMessage[];
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly timeoutMs?: number;
  readonly responseSchemaValidator: (rawJson: unknown) => TResponse;
}

export interface ModelCompletionResponse<TResponse> {
  readonly parsed: TResponse;
  readonly rawText: string;
  readonly modelUsed: string;
  readonly latencyMs: number;
}

export class ModelGatewayError extends Error {
  public constructor(
    message: string,
    public readonly causeDetails?: unknown,
    public readonly isTimeout = false
  ) {
    super(message);
    this.name = "ModelGatewayError";
  }
}

export interface ModelGateway {
  completeStructured<TResponse>(
    request: ModelCompletionRequest<TResponse>
  ): Promise<ModelCompletionResponse<TResponse>>;
}

/**
 * Deterministic Mock/Local ModelGateway for unit testing and offline execution.
 */
export class DeterministicTestModelGateway implements ModelGateway {
  public constructor(
    private readonly defaultHandler: (messages: readonly ModelMessage[]) => unknown
  ) {}

  public async completeStructured<TResponse>(
    request: ModelCompletionRequest<TResponse>
  ): Promise<ModelCompletionResponse<TResponse>> {
    const start = Date.now();
    try {
      const rawObj = this.defaultHandler(request.messages);
      const parsed = request.responseSchemaValidator(rawObj);
      return {
        parsed,
        rawText: JSON.stringify(rawObj),
        modelUsed: request.model ?? "deterministic-test-model",
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      throw new ModelGatewayError(`Structured model completion failed: ${(err as Error).message}`, err);
    }
  }
}

/**
 * Live Groq Provider Adapter
 * Implements structured JSON completion over Groq REST API (OpenAI-compatible) using GROQ_API_KEY.
 * Falls back deterministically if unconfigured or unreachable.
 */
export class GroqModelGateway implements ModelGateway {
  public constructor(
    private readonly apiKey?: string,
    private readonly defaultModel = "openai/gpt-oss-120b",
    private readonly fallbackGateway?: ModelGateway
  ) {}

  public async completeStructured<TResponse>(
    request: ModelCompletionRequest<TResponse>
  ): Promise<ModelCompletionResponse<TResponse>> {
    const envObj = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process?.env;
    const key = this.apiKey ?? envObj?.["GROQ_API_KEY"];

    if (!key || key.trim() === "" || key.includes("<set-secret>")) {
      if (this.fallbackGateway) {
        return this.fallbackGateway.completeStructured(request);
      }
      throw new ModelGatewayError("GROQ_API_KEY is not configured and no fallback gateway provided");
    }

    const start = Date.now();
    const timeoutMs = request.timeoutMs ?? 15000;
    const model = request.model ?? this.defaultModel;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${key.trim()}`,
          "User-Agent": "AFI-Agent/1.0",
        },
        body: JSON.stringify({
          model,
          messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
          response_format: { type: "json_object" },
          temperature: request.temperature ?? 0.1,
          max_tokens: request.maxTokens ?? 1024,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Groq API returned status ${res.status}: ${errText}`);
      }

      const json = await res.json() as {
        choices: Array<{ message: { content: string } }>;
      };

      const rawText = json.choices[0]?.message?.content ?? "{}";
      const parsedObj = JSON.parse(rawText) as unknown;
      const validated = request.responseSchemaValidator(parsedObj);

      return {
        parsed: validated,
        rawText,
        modelUsed: model,
        latencyMs: Date.now() - start,
      };
    } catch (err: unknown) {
      if (this.fallbackGateway) {
        return this.fallbackGateway.completeStructured(request);
      }
      const isTimeout = (err as Error)?.name === "AbortError";
      throw new ModelGatewayError(
        `Groq completion error: ${(err as Error)?.message}`,
        err,
        isTimeout
      );
    }
  }
}
