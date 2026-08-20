import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import {
  CustomerHistoryError,
  parseHistoryCursor,
  parseHistoryLimit,
  readCustomerHistory,
} from "@/lib/customers/customerHistory";

export const dynamic = "force-dynamic";

const POSTGRES_INTEGER_MAX = 2_147_483_647;

type RouteContext = {
  params: Promise<{ id: string }>;
};

/** Read-only projection of a customer's history. Never writes Sale/SaleItem. */
export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const customerId = Number(id);

  if (!Number.isInteger(customerId) || customerId < 1 || customerId > POSTGRES_INTEGER_MAX) {
    return NextResponse.json({ error: "Cliente inválido." }, { status: 400 });
  }

  try {
    const url = new URL(request.url);
    const limit = parseHistoryLimit(url.searchParams.get("limit"));
    const cursor = parseHistoryCursor(url.searchParams.get("cursor"));

    const history = await readCustomerHistory(prisma, customerId, { limit, cursor });

    return NextResponse.json(history);
  } catch (error) {
    if (error instanceof CustomerHistoryError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.kind === "not_found" ? 404 : 400 },
      );
    }

    return NextResponse.json(
      { error: "Não foi possível carregar o histórico agora." },
      { status: 503 },
    );
  }
}
