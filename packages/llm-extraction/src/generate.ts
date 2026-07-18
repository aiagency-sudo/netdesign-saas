import { composeBranchOfficeDesign } from "@netdesign/design-engine";
import type { Design } from "@netdesign/schema";
import { extractDesignParams, type ExtractDesignParamsOptions } from "./extract.js";

/**
 * The full pipeline for the patterns the engine currently supports: user
 * prose -> [LLM extraction] -> design-params -> [design-engine composer,
 * which validates against the schema] -> design JSON.
 */
export async function generateBranchOfficeDesign(prose: string, options: ExtractDesignParamsOptions): Promise<Design> {
  const params = await extractDesignParams(prose, options);
  return composeBranchOfficeDesign(params);
}
