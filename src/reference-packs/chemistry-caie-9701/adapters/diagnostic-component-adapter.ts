import type { ComponentProfile } from "../../../core/domain/component";
import type { PublishedDiagnosticLearningComponent } from "../../../contracts/diagnostic-component";
import { COMPONENT_SCHEMA_VERSION } from "../../../contracts/schema-version";

export function adaptDiagnosticComponent(
  component: PublishedDiagnosticLearningComponent,
): { readonly profile: ComponentProfile; readonly implementation: PublishedDiagnosticLearningComponent } {
  return {
    profile: {
      identity: { id: component.id, version: component.version },
      title: component.presentation.title,
      status: component.status,
      contract: { id: "diagnostic-learning-component", version: COMPONENT_SCHEMA_VERSION },
      capabilityIds: [component.id],
      contentHash: component.publication.contentHash,
    },
    implementation: component,
  };
}

