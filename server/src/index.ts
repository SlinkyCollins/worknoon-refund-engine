import "dotenv/config";
import express from "express";
import cors from "cors";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";

const app = express();
const prisma = new PrismaClient();
const port = Number(process.env.PORT ?? 5000);

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/customers", async (_req, res) => {
  try {
    const customers = await prisma.customer.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        orders: {
          select: {
            id: true,
            orderNumber: true,
            totalAmount: true,
            status: true,
            purchaseDate: true,
            deliveredDate: true,
            isFinalSale: true,
          },
          orderBy: { purchaseDate: "desc" },
        },
      },
      orderBy: { name: "asc" },
    });

    res.json(customers);
  } catch (error) {
    console.error("Failed to fetch customers", error);
    res.status(500).json({ error: "Unable to fetch customers" });
  }
});

app.get("/api/orders/:id", async (req, res) => {
  const idResult = z.string().uuid().safeParse(req.params.id);

  if (!idResult.success) {
    res.status(400).json({ error: "Order id must be a valid UUID" });
    return;
  }

  try {
    const order = await prisma.order.findUnique({
      where: { id: idResult.data },
      select: {
        id: true,
        orderNumber: true,
        totalAmount: true,
        isFinalSale: true,
        status: true,
        purchaseDate: true,
        deliveredDate: true,
        customer: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        items: {
          select: {
            id: true,
            productName: true,
            sku: true,
            unitPrice: true,
            quantity: true,
            isFinalSale: true,
          },
        },
      },
    });

    if (!order) {
      res.status(404).json({ error: "Order not found" });
      return;
    }

    res.json(order);
  } catch (error) {
    console.error("Failed to fetch order", error);
    res.status(500).json({ error: "Unable to fetch order" });
  }
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});