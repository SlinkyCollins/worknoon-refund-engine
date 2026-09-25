import "dotenv/config";
import express from "express";
import cors from "cors";
import { PrismaClient, RefundReasonCategory } from "@prisma/client";
import { z } from "zod";
import {
  orchestrateRefund,
  OrderNotFoundError,
  type OrchestrateRefundInput,
  type OrchestrateRefundResult,
} from "./services/refundOrchestrator.js";
import {
  persistRefundDecision,
  type PersistRefundDecisionInput,
  type PersistedRefundRecord,
} from "./services/refundPersistence.js";

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

export const evaluateRefundRequestSchema = z
  .object({
    orderId: z.string().uuid("Order id must be a valid UUID"),
    reasonCategory: z.nativeEnum(RefundReasonCategory, {
      message: "Invalid refund reason category",
    }),
    customerStatement: z
      .string()
      .trim()
      .min(1, "Customer statement cannot be empty"),
  })
  .strict();

export type EvaluateRefundRequestBody = z.infer<typeof evaluateRefundRequestSchema>;

export type EvaluateRefundDependencies = {
  orchestrate?: (input: OrchestrateRefundInput) => Promise<OrchestrateRefundResult>;
  persist?: (input: PersistRefundDecisionInput) => Promise<PersistedRefundRecord>;
};

export function createRefundEvaluationHandler(dependencies: EvaluateRefundDependencies = {}) {
  const orchestrate = dependencies.orchestrate ?? orchestrateRefund;
  const persist = dependencies.persist ?? persistRefundDecision;

  return async (req: express.Request, res: express.Response): Promise<void> => {
    const parseResult = evaluateRefundRequestSchema.safeParse(req.body);

    if (!parseResult.success) {
      res.status(400).json({
        error: parseResult.error.issues[0]?.message ?? "Invalid request payload",
        details: parseResult.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      });
      return;
    }

    const { orderId, reasonCategory, customerStatement } = parseResult.data;

    try {
      const decision = await orchestrate({
        orderId,
        reasonCategory,
        customerStatement,
      });

      const persisted = await persist({
        orderId,
        reasonCategory,
        customerStatement,
        decision,
      });

      res.status(200).json({
        refundRequestId: persisted.id,
        status: persisted.status,
        rulesTriggered: persisted.auditLog?.rulesTriggered ?? decision.rulesTriggered,
        aiReasoning: persisted.auditLog?.aiReasoning ?? decision.aiReasoning,
        customerMessage: persisted.auditLog?.customerMessage ?? decision.customerMessage,
      });
    } catch (error) {
      if (error instanceof OrderNotFoundError) {
        res.status(404).json({ error: "Order not found" });
        return;
      }

      console.error("Failed to evaluate refund request", error);
      res.status(500).json({ error: "Unable to process refund request" });
    }
  };
}

export const adminRefundRequestInclude = {
  order: {
    select: {
      id: true,
      orderNumber: true,
    },
  },
  customer: {
    select: {
      id: true,
      name: true,
      email: true,
    },
  },
  auditLog: true,
} as const;

export type AdminRequestsPrismaClient = {
  refundRequest: {
    findMany: (args: {
      orderBy?: { createdAt: "asc" | "desc" };
      include?: typeof adminRefundRequestInclude;
    }) => Promise<any>;
    findUnique: (args: {
      where: { id: string };
      include?: typeof adminRefundRequestInclude;
    }) => Promise<any>;
  };
};

export type AdminRequestsDependencies = {
  prisma?: AdminRequestsPrismaClient | PrismaClient;
};

export function createGetAdminRequestsHandler(dependencies: AdminRequestsDependencies = {}) {
  const db = (dependencies.prisma ?? prisma) as unknown as AdminRequestsPrismaClient;

  return async (_req: express.Request, res: express.Response): Promise<void> => {
    try {
      const requests = await db.refundRequest.findMany({
        orderBy: { createdAt: "desc" },
        include: adminRefundRequestInclude,
      });

      res.json(requests);
    } catch (error) {
      console.error("Failed to fetch refund requests", error);
      res.status(500).json({ error: "Unable to fetch refund requests" });
    }
  };
}

export function createGetAdminRequestByIdHandler(dependencies: AdminRequestsDependencies = {}) {
  const db = (dependencies.prisma ?? prisma) as unknown as AdminRequestsPrismaClient;

  return async (req: express.Request, res: express.Response): Promise<void> => {
    const idResult = z.string().uuid().safeParse(req.params.id);

    if (!idResult.success) {
      res.status(400).json({ error: "Refund request id must be a valid UUID" });
      return;
    }

    try {
      const refundRequest = await db.refundRequest.findUnique({
        where: { id: idResult.data },
        include: adminRefundRequestInclude,
      });

      if (!refundRequest) {
        res.status(404).json({ error: "Refund request not found" });
        return;
      }

      res.json(refundRequest);
    } catch (error) {
      console.error("Failed to fetch refund request", error);
      res.status(500).json({ error: "Unable to fetch refund request" });
    }
  };
}

app.post("/api/refunds/evaluate", createRefundEvaluationHandler());
app.get("/api/admin/requests", createGetAdminRequestsHandler());
app.get("/api/admin/requests/:id", createGetAdminRequestByIdHandler());

export { app };

const isTest =
  process.env.NODE_ENV === "test" ||
  process.env.npm_lifecycle_event === "test" ||
  process.argv.some((arg) => arg.includes("test"));

if (!isTest) {
  app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
  });
}