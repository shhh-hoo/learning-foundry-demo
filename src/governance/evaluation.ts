import type { ExpressionAst } from "../contracts/expression-ast";
import type { DiagnosticLearningComponent, RuntimeCapabilityProfile } from "../contracts/diagnostic-component";
import { diagnosticLearningComponentSchema } from "../contracts/published-component";
import type { StandardPack } from "../standards/caie-9701";

export interface FoundryEvaluationCheck {
  readonly id: string;
  readonly status: "PASS" | "FAIL" | "WARNING";
  readonly evidence: readonly string[];
  readonly recommendation?: string;
}

export interface FoundryEvaluationReport {
  readonly componentId: string;
  readonly componentVersion: string;
  readonly evaluatedAt: string;
  readonly checks: readonly FoundryEvaluationCheck[];
  readonly outcome: "PASSED" | "FAILED";
}

const pass = (id: string, evidence: string): FoundryEvaluationCheck => ({ id, status: "PASS", evidence: [evidence] });
const fail = (id: string, evidence: string, recommendation: string): FoundryEvaluationCheck => ({ id, status: "FAIL", evidence: [evidence], recommendation });

function expressionKinds(expression: ExpressionAst): readonly string[] {
  if (expression.kind === "BINARY") return [expression.kind, ...expressionKinds(expression.left), ...expressionKinds(expression.right)];
  if (expression.kind === "FUNCTION") return [`FUNCTION:${expression.name}`, ...expression.arguments.flatMap(expressionKinds)];
  return [expression.kind];
}

function expressionReferences(expression: ExpressionAst): readonly { readonly source: string; readonly id: string }[] {
  if (expression.kind === "VARIABLE") return [{ source: expression.reference.source, id: expression.reference.source === "AUTHORED_FACT" ? expression.reference.factId : expression.reference.reasoningNodeId }];
  if (expression.kind === "BINARY") return [...expressionReferences(expression.left), ...expressionReferences(expression.right)];
  if (expression.kind === "FUNCTION") return expression.arguments.flatMap(expressionReferences);
  return [];
}

function evaluateExpression(expression: ExpressionAst, facts: Map<string, number>, quantities: Map<string, number>): number {
  if (expression.kind === "NUMBER") return expression.value;
  if (expression.kind === "VARIABLE") {
    const value = expression.reference.source === "AUTHORED_FACT" ? facts.get(expression.reference.factId) : quantities.get(expression.reference.reasoningNodeId);
    if (value === undefined) throw new Error(`Unresolved ${expression.reference.source} reference.`);
    return value;
  }
  if (expression.kind === "FUNCTION") return expression.arguments.reduce((sum, item) => sum + evaluateExpression(item, facts, quantities), 0);
  const left = evaluateExpression(expression.left, facts, quantities);
  const right = evaluateExpression(expression.right, facts, quantities);
  if (expression.operator === "ADD") return left + right;
  if (expression.operator === "SUBTRACT") return left - right;
  if (expression.operator === "MULTIPLY") return left * right;
  if (expression.operator === "DIVIDE") return left / right;
  return left ** right;
}

export function recomputeComponent(component: DiagnosticLearningComponent): ReadonlyMap<string, number> {
  const facts = new Map(component.authoredFacts.filter((item): item is typeof item & { value: number } => typeof item.value === "number").map((item) => [item.id, item.value]));
  const quantities = new Map<string, number>();
  component.formulaDefinitions.forEach((formula) => quantities.set(formula.targetReasoningNodeId, evaluateExpression(formula.expression, facts, quantities)));
  return quantities;
}

export function evaluateRuntimeCompatibility(component: DiagnosticLearningComponent, capability: RuntimeCapabilityProfile): FoundryEvaluationCheck {
  const reasons: string[] = [];
  if (!capability.supportedSchemaVersions.includes(component.schemaVersion)) reasons.push(`Schema ${component.schemaVersion} is unsupported.`);
  if (!capability.supportedTargetKinds.includes(component.target.kind)) reasons.push(`Target ${component.target.kind} has no runtime adapter.`);
  const usedKinds = new Set(component.formulaDefinitions.flatMap((formula) => expressionKinds(formula.expression)));
  [...usedKinds].filter((kind) => !capability.supportedExpressionNodes.includes(kind)).forEach((kind) => reasons.push(`Expression node ${kind} is unsupported.`));
  component.diagnosisPolicy.categoryOrder.filter((category) => !capability.supportedDiagnosisCategories.includes(category)).forEach((category) => reasons.push(`Diagnosis category ${category} is unsupported.`));
  component.diagnosisPolicy.supportedFailureCodes.filter((code) => !capability.supportedFailureCodes.includes(code)).forEach((code) => reasons.push(`Failure code ${code} is unsupported.`));
  return reasons.length === 0 ? pass("runtime_capability_compatibility", `${capability.runtimeId}@${capability.runtimeVersion} can execute this component.`) : { id: "runtime_capability_compatibility", status: "FAIL", evidence: reasons, recommendation: "Select a compatible runtime or add and verify a bounded target adapter." };
}

export function evaluateComponent(component: DiagnosticLearningComponent, standardPack: StandardPack, capability: RuntimeCapabilityProfile, evaluatedAt = new Date().toISOString()): FoundryEvaluationReport {
  const checks: FoundryEvaluationCheck[] = [];
  const parsed = diagnosticLearningComponentSchema.safeParse(component);
  checks.push(parsed.success ? pass("schema_validity", "Component conforms to canonical schema 1.0.0.") : fail("schema_validity", parsed.error.issues.map((item) => item.path.join(".") || "$root").join(", "), "Resolve all canonical schema errors."));

  const topic = standardPack.topics.find((item) => item.title === component.curriculum.topic);
  checks.push(topic && component.curriculum.learningObjectiveId.startsWith(topic.id)
    ? pass("curriculum_alignment", `${component.curriculum.learningObjectiveId} is grounded in ${topic.id}.`)
    : fail("curriculum_alignment", `No matching Standard Pack objective for ${component.curriculum.topic}.`, "Select an objective from the governed Standard Pack."));

  checks.push(component.authoredFacts.some((fact) => fact.relevance === "REQUIRED") && component.presentation.prompt.length > 20
    ? pass("required_information_present", `${component.authoredFacts.filter((fact) => fact.relevance === "REQUIRED").length} required facts and a bounded prompt are present.`)
    : fail("required_information_present", "Required facts or bounded prompt are missing.", "Author every value needed for deterministic recomputation."));

  const nodeIds = Object.keys(component.reasoningGraph.nodes);
  const orderMatches = nodeIds.length === component.reasoningGraph.pedagogicalOrder.length && component.reasoningGraph.pedagogicalOrder.every((id) => component.reasoningGraph.nodes[id]?.id === id);
  checks.push(orderMatches ? pass("reasoning_graph_integrity", `${nodeIds.length} nodes are uniquely ordered.`) : fail("reasoning_graph_integrity", "Node IDs and pedagogical order do not form the same set.", "Align node keys, embedded IDs and pedagogical order."));

  const orderIndex = new Map(component.reasoningGraph.pedagogicalOrder.map((id, index) => [id, index]));
  const invalidDependencies = Object.values(component.reasoningGraph.nodes).flatMap((node) => node.dependencies.filter((dependency) => orderIndex.get(dependency) === undefined || (orderIndex.get(dependency) ?? Infinity) >= (orderIndex.get(node.id) ?? -1)).map((dependency) => `${node.id} → ${dependency}`));
  checks.push(invalidDependencies.length === 0 ? pass("graph_dependency_integrity", "Every dependency exists earlier in pedagogical order.") : fail("graph_dependency_integrity", invalidDependencies.join(", "), "Remove cycles and unresolved or forward dependencies."));

  const requiredNodes = new Set(component.reasoningGraph.acceptedStrategies.flatMap((strategy) => strategy.nodeRequirements.filter((item) => item.requirement === "REQUIRED").map((item) => item.nodeId)));
  const missingStrategyNodes = component.reasoningGraph.pedagogicalOrder.filter((id) => !requiredNodes.has(id));
  checks.push(missingStrategyNodes.length === 0 ? pass("accepted_strategy_completeness", "An accepted strategy requires every authored reasoning stage.") : fail("accepted_strategy_completeness", `Missing strategy nodes: ${missingStrategyNodes.join(", ")}`, "Add required or explicitly optional strategy requirements."));

  const factIds = new Set(component.authoredFacts.map((fact) => fact.id));
  const formulaTargets = new Set(component.formulaDefinitions.map((formula) => formula.targetReasoningNodeId));
  const unresolved = component.formulaDefinitions.flatMap((formula) => expressionReferences(formula.expression)).filter((reference) => reference.source === "AUTHORED_FACT" ? !factIds.has(reference.id) : !formulaTargets.has(reference.id));
  checks.push(unresolved.length === 0 ? pass("formula_reference_integrity", "All formula references resolve to authored facts or computed quantities.") : fail("formula_reference_integrity", unresolved.map((item) => item.id).join(", "), "Resolve every AST variable reference."));

  let quantities = new Map<string, number>();
  try {
    quantities = new Map(recomputeComponent(component));
    const finite = [...quantities.values()].every(Number.isFinite);
    checks.push(finite ? pass("deterministic_recomputation", `${quantities.size} authored formula results recomputed deterministically.`) : fail("deterministic_recomputation", "Recomputation produced a non-finite result.", "Check denominators and numeric facts."));
  } catch (error) {
    checks.push(fail("deterministic_recomputation", error instanceof Error ? error.message : "Recomputation failed.", "Order formula definitions by dependency and resolve references."));
  }
  const recomputedTarget = quantities.get(component.target.resultReasoningNodeId);
  checks.push(recomputedTarget !== undefined && Math.abs(recomputedTarget - component.target.expectedValue) <= component.target.absoluteTolerance
    ? pass("target_answer_consistency", `Recomputed target ${recomputedTarget} matches authored answer ${component.target.expectedValue}.`)
    : fail("target_answer_consistency", `Recomputed ${String(recomputedTarget)} does not match ${component.target.expectedValue}.`, "Correct the target answer or authored formula/facts."));

  const authoredCopy = `${component.presentation.prompt} ${component.markScheme.map((point) => point.description).join(" ")}`;
  checks.push(component.target.acceptedUnits.some((unit) => authoredCopy.includes(unit)) ? pass("unit_consistency", `Target unit ${component.target.acceptedUnits.join(" / ")} appears in prompt or mark scheme.`) : fail("unit_consistency", "Target units are inconsistent with presentation and mark scheme.", "Align the target, prompt and mark scheme units."));
  checks.push(authoredCopy.includes(String(component.target.significantFigures)) ? pass("significant_figure_consistency", `${component.target.significantFigures} significant figures is stated in authored content.`) : fail("significant_figure_consistency", "Target precision is not stated consistently.", "State the required significant figures in prompt or mark scheme."));

  const markTotal = component.markScheme.reduce((sum, point) => sum + point.marks, 0);
  const invalidMarkNodes = component.markScheme.filter((point) => !component.reasoningGraph.nodes[point.reasoningNodeId]);
  checks.push(markTotal === component.presentation.marks && invalidMarkNodes.length === 0 ? pass("mark_scheme_alignment", `${markTotal} marks map to valid reasoning nodes.`) : fail("mark_scheme_alignment", `Presentation has ${component.presentation.marks} marks; scheme totals ${markTotal}.`, "Align mark total and reasoning-node references."));

  const invalidHints = component.hintPolicy.hints.flatMap((hint) => hint.revealedReasoningNodeIds.filter((id) => !component.reasoningGraph.nodes[id]));
  checks.push(invalidHints.length === 0 ? pass("hint_policy_integrity", "Every hint reveals only authored reasoning nodes.") : fail("hint_policy_integrity", invalidHints.join(", "), "Resolve hint node references."));
  checks.push(evaluateRuntimeCompatibility(component, capability));
  checks.push({ id: "duplicate_similarity_risk", status: "WARNING", evidence: ["Demo uses title-and-objective metadata only; production similarity screening requires a larger registry."], recommendation: "Compare against the full published registry before production release." });
  return { componentId: component.id, componentVersion: component.version, evaluatedAt, checks, outcome: checks.some((check) => check.status === "FAIL") ? "FAILED" : "PASSED" };
}
