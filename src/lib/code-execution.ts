export type SupportedCodeExecutionLanguage =
  | "java"
  | "javascript"
  | "python";

export type CodeExecutionResult = {
  outcome: "completed" | "error" | "timeout";
  stdout: string;
  stderr: string;
  details: string | null;
  compilationTimeMs: number | null;
  executionTimeMs: number | null;
  memoryKb: number | null;
};

type ProviderErrorKind = "auth" | "quota" | "provider";

export class CodeExecutionProviderError extends Error {
  constructor(readonly kind: ProviderErrorKind) {
    super(`OneCompiler ${kind} failure`);
    this.name = "CodeExecutionProviderError";
  }
}

const ONECOMPILER_RUN_URL = "https://api.onecompiler.com/v1/run";

function maskJavaCommentsAndStrings(code: string) {
  let masked = "";
  let state: "code" | "line-comment" | "block-comment" | "string" | "char" =
    "code";

  for (let index = 0; index < code.length; index += 1) {
    const char = code[index];
    const next = code[index + 1];

    if (state === "code") {
      if (char === "/" && next === "/") {
        masked += "  ";
        index += 1;
        state = "line-comment";
      } else if (char === "/" && next === "*") {
        masked += "  ";
        index += 1;
        state = "block-comment";
      } else if (char === '"') {
        masked += " ";
        state = "string";
      } else if (char === "'") {
        masked += " ";
        state = "char";
      } else {
        masked += char;
      }
      continue;
    }

    if (state === "line-comment") {
      masked += char === "\n" ? "\n" : " ";
      if (char === "\n") state = "code";
      continue;
    }

    if (state === "block-comment") {
      if (char === "*" && next === "/") {
        masked += "  ";
        index += 1;
        state = "code";
      } else {
        masked += char === "\n" ? "\n" : " ";
      }
      continue;
    }

    masked += char === "\n" ? "\n" : " ";
    if (char === "\\") {
      if (next !== undefined) {
        masked += next === "\n" ? "\n" : " ";
        index += 1;
      }
    } else if (
      (state === "string" && char === '"') ||
      (state === "char" && char === "'")
    ) {
      state = "code";
    }
  }

  return masked;
}

function getJavaFilename(code: string) {
  const masked = maskJavaCommentsAndStrings(code);
  let depth = 0;
  let topLevelCode = "";

  for (const char of masked) {
    if (char === "{") {
      depth += 1;
      topLevelCode += " ";
    } else if (char === "}") {
      depth = Math.max(0, depth - 1);
      topLevelCode += " ";
    } else {
      topLevelCode += depth === 0 ? char : " ";
    }
  }

  const declarations = topLevelCode.matchAll(
    /(?:^|[;\n])\s*((?:(?:(?:public|abstract|final|sealed|non-sealed|strictfp)\s+)|(?:@(?!interface\b)[A-Za-z_$][\w$.]*(?:\s*\([^;{}]*\))?\s+))*)(?:class|interface|enum|record|@interface)\s+([A-Za-z_$][\w$]*)\b/gm,
  );

  for (const declaration of declarations) {
    if (/\bpublic\b/.test(declaration[1])) {
      return `${declaration[2]}.java`;
    }
  }
  return "Main.java";
}

function getFilename(language: SupportedCodeExecutionLanguage, code: string) {
  if (language === "python") return "main.py";
  if (language === "javascript") return "main.js";
  return getJavaFilename(code);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function asNullableString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNullableNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getProviderErrorKind(
  statusCode: number,
  providerError: string,
): ProviderErrorKind {
  if (statusCode === 429 || /\bE002\b|quota|rate limit/i.test(providerError)) {
    return "quota";
  }
  if (
    statusCode === 401 ||
    statusCode === 403 ||
    /\bE00[34]\b|invalid (?:access_token|api key)|(?:access_token|api key) missing/i.test(
      providerError,
    )
  ) {
    return "auth";
  }
  return "provider";
}

export async function executeCode({
  language,
  code,
  apiKey,
  signal,
}: {
  language: SupportedCodeExecutionLanguage;
  code: string;
  apiKey: string;
  signal?: AbortSignal;
}): Promise<CodeExecutionResult> {
  let response: Response;
  try {
    response = await fetch(ONECOMPILER_RUN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
      },
      body: JSON.stringify({
        language,
        stdin: "",
        files: [{ name: getFilename(language, code), content: code }],
      }),
      cache: "no-store",
      signal,
    });
  } catch {
    throw new CodeExecutionProviderError("provider");
  }

  let rawBody: unknown;
  try {
    rawBody = await response.json();
  } catch {
    if (!response.ok) {
      throw new CodeExecutionProviderError(
        getProviderErrorKind(response.status, ""),
      );
    }
    throw new CodeExecutionProviderError("provider");
  }

  const body = asRecord(rawBody);
  if (!body) {
    if (!response.ok) {
      throw new CodeExecutionProviderError(
        getProviderErrorKind(response.status, ""),
      );
    }
    throw new CodeExecutionProviderError("provider");
  }

  const providerStatus = asString(body.status);
  const providerError = asString(body.error);
  if (!response.ok || providerStatus !== "success") {
    throw new CodeExecutionProviderError(
      getProviderErrorKind(response.status, providerError),
    );
  }

  const stdout = asString(body.stdout);
  const stderr = asString(body.stderr);
  const details = asNullableString(body.exception) ?? asNullableString(body.error);
  const outcome = /\bE001\b|operation\s+timed?\s*out/i.test(providerError)
    ? "timeout"
    : details || stderr
      ? "error"
      : "completed";

  return {
    outcome,
    stdout,
    stderr,
    details,
    compilationTimeMs: asNullableNumber(body.compilationTime),
    executionTimeMs: asNullableNumber(body.executionTime),
    memoryKb: asNullableNumber(body.memoryUsed),
  };
}
