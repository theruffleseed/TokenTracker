import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { ZodError, type ZodSchema } from "zod";
import { AppError, sanitizeMessage } from "./errors";

export function json<T>(data: T, status = 200): NextResponse<T> {
  return NextResponse.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}

export function errorResponse(error: AppError): NextResponse {
  const body: Record<string, unknown> = {
    error: { code: error.code, message: error.message },
  };
  if (error.details) body.error = { ...(body.error as object), details: error.details };
  return json(body, error.status);
}

export async function withApi(
  handler: () => Promise<Response> | Response,
): Promise<Response> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof AppError) return errorResponse(error);

    if (error instanceof ZodError) {
      return json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "The request contains invalid fields",
            details: error.issues.map((issue) => ({
              path: issue.path.join("."),
              message: issue.message,
            })),
          },
        },
        422,
      );
    }

    console.error("[api] unhandled error:", sanitizeMessage(error));
    return json(
      { error: { code: "INTERNAL_ERROR", message: "Something went wrong" } },
      500,
    );
  }
}

export async function readJson<T>(
  request: NextRequest,
  schema: ZodSchema<T>,
): Promise<T> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new AppError("BAD_REQUEST", "Expected an application/json body");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new AppError("BAD_REQUEST", "Request body is not valid JSON");
  }

  return schema.parse(body);
}
