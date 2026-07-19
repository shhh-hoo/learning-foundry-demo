import { getCheckpointSql, getSql } from "@/db/client";

export async function GET() {
  try {
    const [product] = await getSql()<Array<{ product_schema: boolean; operational_schema: boolean }>>`
      SELECT to_regnamespace('foundry_product') IS NOT NULL AS product_schema,
             to_regnamespace('foundry_operational') IS NOT NULL AS operational_schema
    `;
    const [checkpoint] = await getCheckpointSql()<Array<{ checkpoint_schema: boolean }>>`
      SELECT to_regnamespace('langgraph_checkpoint') IS NOT NULL AS checkpoint_schema
    `;
    const database = { ...product, ...checkpoint };
    return Response.json({ status: product.product_schema && product.operational_schema && checkpoint.checkpoint_schema ? "READY" : "DEGRADED", database });
  } catch {
    return Response.json({ status: "UNAVAILABLE", database: false }, { status: 503 });
  }
}
