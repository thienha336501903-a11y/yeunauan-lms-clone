# V4 routing flag

`LMS_V4_ROUTING_ENABLED=true` enables V4-aware routing for `/learning` when the runtime mode is `v3`.

Default behavior when the variable is absent/false:
- runtime `v3` -> `/v3`
- runtime `v2` -> existing V2 resolver

This keeps Production on V3 by default while allowing a dedicated sandbox project to enable V4 explicitly.
