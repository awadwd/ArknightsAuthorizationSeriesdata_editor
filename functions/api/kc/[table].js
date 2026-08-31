// Dynamic route /api/kc/{table} -> kc-data
import { onRequest as kcDataHandler } from "../kc-data.js";
export async function onRequest(context) {
  return await kcDataHandler(context);
}
