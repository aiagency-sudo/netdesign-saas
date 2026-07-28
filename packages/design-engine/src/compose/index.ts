import type { Design, DesignParams } from "@netdesign/schema";
import { composeBranchOfficeDesign } from "./branch-office.js";
import { composeCampusDesign } from "./campus.js";

export * from "./branch-office.js";
export * from "./campus.js";

/**
 * Dispatches to the right composer for the design-params pattern. The single
 * entry point the app pipeline should call — new patterns get a composer plus
 * a case here, and nothing upstream changes.
 */
export function composeDesign(params: DesignParams): Design {
  switch (params.designPattern) {
    case "campus-three-tier":
      return composeCampusDesign(params);
    case "branch-office":
    case "smb-flat":
      return composeBranchOfficeDesign(params);
    default: {
      const exhaustive: never = params.designPattern;
      throw new Error(`No composer for designPattern "${String(exhaustive)}".`);
    }
  }
}
