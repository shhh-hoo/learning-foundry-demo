import { kpDraft } from "./kp-from-equilibrium-moles";
import { massDraft } from "./stoichiometric-product-mass";
import { publishApprovedComponent } from "../governance/publishing";

const publication = { publishedAt: "2026-07-15T09:00:00.000Z", publishedBy: "Learning Foundry demo publisher" };

export const publishedComponents = [
  publishApprovedComponent(kpDraft, publication),
  publishApprovedComponent(massDraft, publication),
] as const;

