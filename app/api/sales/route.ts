import { NextResponse } from "next/server";

import {
  SaleConcurrencyError,
  SaleInvariantError,
  registerSale,
} from "@/lib/sales/registerSale";
import { prisma } from "@/lib/prisma";
import { SaleInputError, parseSaleInput, parseSaleRequest } from "./validation";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const sales = await prisma.sale.findMany({
      orderBy: [{ soldAt: "desc" }, { id: "desc" }],
      take: 20,
      include: {
        customer: true,
        items: { include: { product: true }, orderBy: { productId: "asc" } },
      },
    });

    return NextResponse.json({ sales });
  } catch {
    return NextResponse.json(
      { error: "Não foi possível carregar as vendas agora." },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const input = parseSaleInput(await parseSaleRequest(request));
    // registerSale owns the write shape and the retry policy; the route never
    // assembles its own Sale/SaleItem write.
    const sale = await registerSale(input);

    return NextResponse.json({ sale }, { status: 201 });
  } catch (error) {
    if (error instanceof SaleInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    // A domain invariant from TASK-07/08/09. Deterministic, so it is reported
    // as a conflict rather than retried.
    if (error instanceof SaleInvariantError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }

    // Every attempt hit a retryable concurrency failure. Surfaced, not hidden,
    // so the user can retry deliberately.
    if (error instanceof SaleConcurrencyError) {
      return NextResponse.json(
        {
          error:
            "O sistema está com muitas vendas simultâneas neste momento. Tente registrar novamente.",
        },
        { status: 503 },
      );
    }

    return NextResponse.json(
      { error: "Não foi possível registrar a venda agora." },
      { status: 503 },
    );
  }
}
