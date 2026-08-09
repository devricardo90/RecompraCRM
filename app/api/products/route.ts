import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { ProductInputError, parseProductInput, parseProductRequest } from "./validation";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const products = await prisma.product.findMany({
      orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
    });

    return NextResponse.json({ products });
  } catch {
    return NextResponse.json(
      { error: "Não foi possível carregar os produtos agora." },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const input = parseProductInput(await parseProductRequest(request));
    const product = await prisma.product.create({ data: input });

    return NextResponse.json({ product }, { status: 201 });
  } catch (error) {
    if (error instanceof ProductInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "Esse produto já está cadastrado." }, { status: 409 });
    }

    return NextResponse.json(
      { error: "Não foi possível cadastrar o produto agora." },
      { status: 503 },
    );
  }
}
