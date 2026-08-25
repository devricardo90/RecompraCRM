import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { businessDayEndUtc } from "@/lib/format/businessDate";
import {
  UPCOMING_WINDOW_DAYS,
  buildRepurchaseView,
} from "@/lib/sales/repurchaseForecast";

export const dynamic = "force-dynamic";

/**
 * Read-only projection of the repurchase forecast across customers.
 *
 * Never writes Sale, SaleItem, Product or Customer, and never recomputes
 * `expectedRepurchaseAt` — that value belongs to the TASK-09 triggers under
 * ARCH-01 Option A, and this route only reads and classifies it.
 */
export async function GET() {
  // One instant for the whole response. Reading the clock more than once would
  // let a request that crosses business midnight query against one day and
  // classify against the next, dropping the newly eligible seventh day.
  const generatedAt = new Date();

  try {
    const rows = await prisma.saleItem.findMany({
      where: {
        expectedRepurchaseAt: {
          // Open backwards on purpose: the overdue bucket is precisely what has
          // already passed, so a lower bound would empty it.
          not: null,
          lte: businessDayEndUtc(generatedAt, UPCOMING_WINDOW_DAYS),
        },
      },
      orderBy: [{ expectedRepurchaseAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        quantity: true,
        expectedRepurchaseAt: true,
        sale: {
          select: {
            id: true,
            soldAt: true,
            customer: { select: { id: true, name: true, phone: true } },
          },
        },
        product: { select: { id: true, name: true, unit: true } },
      },
    });

    const { items, counts } = buildRepurchaseView(
      rows.map((row) => ({
        saleItemId: row.id,
        expectedRepurchaseAt: row.expectedRepurchaseAt,
        quantity: row.quantity,
        sale: { id: row.sale.id, soldAt: row.sale.soldAt },
        // `phone` is nullable in the database and stays an explicit `null` here:
        // an omitted key and a null key are different API types, and the route
        // and the UI would then disagree about which one to expect.
        customer: {
          id: row.sale.customer.id,
          name: row.sale.customer.name,
          phone: row.sale.customer.phone ?? null,
        },
        product: { id: row.product.id, name: row.product.name, unit: row.product.unit },
      })),
      generatedAt,
    );

    return NextResponse.json({ generatedAt: generatedAt.toISOString(), counts, items });
  } catch {
    return NextResponse.json(
      { error: "Não foi possível carregar as recompras agora." },
      { status: 503 },
    );
  }
}
