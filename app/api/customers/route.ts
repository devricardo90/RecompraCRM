import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import {
  CustomerInputError,
  parseCustomerRequest,
  parseCustomerInput,
} from "./validation";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const customers = await prisma.customer.findMany({
      orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
    });

    return NextResponse.json({ customers });
  } catch {
    return NextResponse.json(
      { error: "Não foi possível carregar os clientes agora." },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const input = parseCustomerInput(await parseCustomerRequest(request));
    const customer = await prisma.customer.create({ data: input });

    return NextResponse.json({ customer }, { status: 201 });
  } catch (error) {
    if (error instanceof CustomerInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json(
        { error: "Esse telefone já está cadastrado." },
        { status: 409 },
      );
    }

    return NextResponse.json(
      { error: "Não foi possível cadastrar o cliente agora." },
      { status: 503 },
    );
  }
}
