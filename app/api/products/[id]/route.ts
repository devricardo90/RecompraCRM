import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import {
  POSTGRES_INTEGER_MAX,
  ProductInputError,
  parseProductInput,
  parseProductRequest,
} from "../validation";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PUT(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const productId = Number(id);

  if (!Number.isInteger(productId) || productId < 1 || productId > POSTGRES_INTEGER_MAX) {
    return NextResponse.json({ error: "Produto inválido." }, { status: 400 });
  }

  try {
    const input = parseProductInput(await parseProductRequest(request));
    const product = await prisma.product.update({
      where: { id: productId },
      data: input,
    });

    return NextResponse.json({ product });
  } catch (error) {
    if (error instanceof ProductInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json({ error: "Produto não encontrado." }, { status: 404 });
    }

    return NextResponse.json(
      { error: "Não foi possível atualizar o produto agora." },
      { status: 503 },
    );
  }
}
