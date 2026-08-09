import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import {
  CustomerInputError,
  parseCustomerRequest,
  parseCustomerInput,
} from "../validation";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PUT(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const customerId = Number(id);

  if (!Number.isInteger(customerId) || customerId < 1) {
    return NextResponse.json({ error: "Cliente inválido." }, { status: 400 });
  }

  try {
    const input = parseCustomerInput(await parseCustomerRequest(request));
    const customer = await prisma.customer.update({
      where: { id: customerId },
      data: input,
    });

    return NextResponse.json({ customer });
  } catch (error) {
    if (error instanceof CustomerInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") {
        return NextResponse.json(
          { error: "Esse telefone já está cadastrado." },
          { status: 409 },
        );
      }

      if (error.code === "P2025") {
        return NextResponse.json({ error: "Cliente não encontrado." }, { status: 404 });
      }
    }

    return NextResponse.json(
      { error: "Não foi possível atualizar o cliente agora." },
      { status: 503 },
    );
  }
}
