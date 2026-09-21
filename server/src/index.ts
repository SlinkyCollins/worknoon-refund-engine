import "dotenv/config";
import express from "express";
import cors from "cors";

const app = express();
const port = Number(process.env.PORT ?? 5000);

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});