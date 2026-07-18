# Capability Registry

`config/capabilities/registry.json` remains the versioned Legacy capability
snapshot for the current Chemistry CAIE 9701 Reference Pack. The Pack
adapts each record to the domain-neutral Core `CapabilityProfile` and the
Agent Gateway consumes the registered Pack entrypoint. The JSON bytes,
version, ordering and current Agent tool record shape remain unchanged.

MASS is listed first and is learner-facing. Each record declares purpose,
required input, output contract, limitations, readiness and runtime
endpoint.

Kp has `ENGINEERING_ONLY` visibility and is excluded from the Agent's default list. The Trainer may retain its published snapshot for regression and migration history.

Registration clarifies ownership only. It does not grant a new Runtime
authority, change capability resolution, or authorize Legacy deletion.
