# AlphaZero ↔ GoCube V2 compatibility matrix

This matrix is the product-boundary acceptance index for
`gocube-product-boundary-v1`.  `PASS` means the check is covered by the
versioned imported fixture or by the named product regression.  `NOT_APPLICABLE`
is used only where the behavior is not exposed by the product lifecycle.

| Fixture family | V1 fixture ID / product regression | AlphaZero boundary verified | GameEngine replay verified | Endgame applicable | FinalScore verified | Manual fallback verified | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Cube4 PointId mapping | all Cube4 imported fixtures | yes | yes | no | no | no | PASS | 96/96 bijective logical points |
| Cube4 adjacency | all Cube4 imported fixtures | yes | yes | no | no | no | PASS | 384 directed adjacency relations |
| ordinary/setup MAIN | `cube4_vertex_single_group_001`, `cube4_vertex_three_face_group_001`, `cube4_inner_shared_liberty_001`, `cube4_global_cut_group_001` | yes | yes | no | no | no | PASS | setup positions and deterministic placements |
| seam group | `cube4_seam_region_001`, `cube4_seam_local_isomorphism_001` | yes | yes | no | no | no | PASS | topology-only seam crossing |
| seam/vertex capture | `cube4_vertex_capture_001`, `cube4_vertex_capture_before_suicide_001`, `cube4_vertex_multiple_neighbor_capture_001` | yes | yes | no | no | no | PASS | exact captured PointIds |
| vertex connectivity | `cube4_vertex_single_group_001`, `cube4_vertex_three_face_group_001`, `cube4_vertex_near_miss_001` | yes | yes | no | no | no | PASS | no renderer coordinates used |
| true ko negative | `cube4_true_simple_ko_001` | yes | yes | no | no | no | PASS | immediate positional recapture rejected |
| false pseudo-ko negative | `cube4_false_simple_ko_001` | yes | yes | no | no | no | PASS | apparent recapture rejected as suicide |
| suicide/occupied/invalid negative | `cube4_vertex_suicide_control_001` plus product negative tests | yes | yes | no | no | no | PASS | rejected actions leave state unchanged |
| first/second Pass | `cube4_vertex_capture_001`, `cube4_vertex_multiple_neighbor_capture_001`, `cube4_early_termination_boundary_001` | yes | yes | yes | no | yes | PASS | board/captures/player match at boundary; cleanup-phase sources excluded |
| Torus wrap group/capture | `torus9_wrap_group_001`, `torus9_wrap_capture_001` | yes | yes | no | no | no | PASS | product GameEngine uses same logical wrap topology |
| Torus topology invariant | `torus9_no_cube_triangles_001` | yes | yes | no | no | no | PASS | Torus remains renderer-independent |
| manual setup scoring | `cube4_early_termination_boundary_001` | yes | yes | yes | yes | yes | PASS | Japanese komi is exactly 0.5 |
| classifier exception fallback | product regression | NOT_APPLICABLE | yes | yes | no | yes | PASS | accepted second Pass remains endgame; groups unresolved |
| invalid classifier proposal fallback | product regression | NOT_APPLICABLE | yes | yes | no | yes | PASS | invalid proposal is never authoritative |
| endgame group integrity | product restore regressions | NOT_APPLICABLE | yes | yes | no | yes | PASS | partial/non-stone groups fail closed |
| snapshot round-trip | product repository regression | NOT_APPLICABLE | yes | yes | yes | yes | PASS | board, captures, classification and score preserved |
| AlphaZero cleanup lifecycle | `V2-DIFF-001` | yes | yes | yes | product score only | yes | EXPLAINED_PRODUCT_DIFFERENCE | AlphaZero cleanup is not copied into GoCube |
| training NO_RESULT / episode limit | training-only contract | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | not product-exposed |

The required product difference is `V2-DIFF-001`: AlphaZero may enter its
internal cleanup lifecycle after the second MAIN Pass, while GoCube enters
user-facing endgame review.  The invariant tested before this difference is
the same board occupancy, exact MAIN captures, and next-player semantics.
