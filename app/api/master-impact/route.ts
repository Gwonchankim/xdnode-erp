import { env } from "cloudflare:workers";
import { authorizeErpRequest } from "../../erp-platform";
import { createMasterImpactAssessment, isMasterImpactAction, isMasterImpactEntityType, MasterImpactError } from "../../master-impact";

type Bindings = { DB: D1Database };
const db = (env as unknown as Bindings).DB;

export async function POST(request: Request) {
  const body = await request.json() as Record<string, unknown>;
  const entityType = String(body.entityType ?? "").toUpperCase();
  const entityId = String(body.entityId ?? "").trim();
  const action = String(body.action ?? "").toUpperCase();
  if (!isMasterImpactEntityType(entityType) || !isMasterImpactAction(action) || !entityId) return Response.json({ error: "영향도 대상과 작업을 확인해 주세요." }, { status: 400 });
  const moduleName = entityType.startsWith("FINANCE_") ? "finance" : entityType === "SALES_ACCOUNT" ? "sales" : "hr";
  const permission = entityType.startsWith("FINANCE_") ? "admin" : "write";
  const authorization = await authorizeErpRequest(db, moduleName, permission);
  if (authorization.response) return authorization.response;
  try {
    return Response.json({ assessment: await createMasterImpactAssessment(db, authorization.principal, entityType, entityId, action) });
  } catch (error) {
    if (error instanceof MasterImpactError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
