// SPDX-License-Identifier: MIT OR Apache-2.0
// SPDX-FileCopyrightText: Cimarron Trailers

//! The cimarron-trailers fork's facade methods: a second list beside upstream's
//! [`super::config`], which the generator reads after it (`run.rs`).
//!
//! Every method here answers a sub-shape question by POSITION — the sub-shape's
//! 0-based index in its shape's list of that type: `TopExp::MapShapes`' indexed
//! map, the order `getSubShapes` lists, found by `IsSame` (`FindIndex`). A
//! position is exact by construction. Upstream's calls answer in hash numbers
//! (`subShapeHashes`, the `*WithHistory` runs, the mesh's and the wireframe's
//! group ids), and two sub-shapes with equal numbers are one; no method here
//! takes or returns a number.
//!
//! The list is its own so that upstream's `config.rs` merges untouched on every
//! rebase. Its methods are npm-only: the generator emits them into the Embind
//! build (`facade/generated/kernel.cpp`, `bindings.cpp`) and leaves them out of
//! the WASI C-ABI and the Rust crate, whose committed `occt-wasm.wasm.br` the
//! fork never rebuilds. They share their C++ helpers through
//! `facade/include/sub_shape_identity.h`, and their TypeScript wrappers and
//! answer types through `ts/src/sub-shape-identity.ts`.

use super::types::{FacadeParam, MethodKind, MethodSpec, ReturnType};

/// The fork's methods, in the order the generator emits them.
static FORK_METHODS: &[MethodSpec] = &[
    // ── B1: history by position ─────────────────────────────────────
    MethodSpec {
        name: "cutWithPositionHistory",
        kind: MethodKind::CustomBody,
        params: &[FacadeParam::ShapeId("a"), FacadeParam::ShapeId("b")],
        occt_class: "",
        ctor_args: "",
        // The boolean exactly as `cutWithHistory` builds it; only the answer differs.
        setup_code: "\
const auto& shapeA = get(a);
const auto& shapeB = get(b);
BRepAlgoAPI_Cut op;
buildBoolean(op, shapeA, shapeB);
if (!op.IsDone() || op.HasErrors()) {
    throw std::runtime_error(\"cutWithPositionHistory: boolean operation failed\");
}
BatchScope result(*this, 1);
const uint32_t resultId = result.add(op.Shape());
std::vector<uint32_t> answer = sub_shape_identity::faceHistory(
    op, resultId, op.Shape(), {shapeA, shapeB}, \"cutWithPositionHistory\");
result.take();
return answer;",
        includes: &["BRepAlgoAPI_Cut.hxx", "sub_shape_identity.h"],
        category: "identity",
        return_type: ReturnType::VectorUint32,
    },
    MethodSpec {
        name: "fuseWithPositionHistory",
        kind: MethodKind::CustomBody,
        params: &[FacadeParam::ShapeId("a"), FacadeParam::ShapeId("b")],
        occt_class: "",
        ctor_args: "",
        // The boolean exactly as `fuseWithHistory` builds it; only the answer differs.
        setup_code: "\
const auto& shapeA = get(a);
const auto& shapeB = get(b);
BRepAlgoAPI_Fuse op;
buildBoolean(op, shapeA, shapeB);
if (!op.IsDone() || op.HasErrors()) {
    throw std::runtime_error(\"fuseWithPositionHistory: boolean operation failed\");
}
BatchScope result(*this, 1);
const uint32_t resultId = result.add(op.Shape());
std::vector<uint32_t> answer = sub_shape_identity::faceHistory(
    op, resultId, op.Shape(), {shapeA, shapeB}, \"fuseWithPositionHistory\");
result.take();
return answer;",
        includes: &["BRepAlgoAPI_Fuse.hxx", "sub_shape_identity.h"],
        category: "identity",
        return_type: ReturnType::VectorUint32,
    },
    MethodSpec {
        name: "intersectWithPositionHistory",
        kind: MethodKind::CustomBody,
        params: &[FacadeParam::ShapeId("a"), FacadeParam::ShapeId("b")],
        occt_class: "",
        ctor_args: "",
        // The boolean exactly as `intersectWithHistory` builds it; only the answer differs.
        setup_code: "\
const auto& shapeA = get(a);
const auto& shapeB = get(b);
BRepAlgoAPI_Common op;
buildBoolean(op, shapeA, shapeB);
if (!op.IsDone() || op.HasErrors()) {
    throw std::runtime_error(\"intersectWithPositionHistory: boolean operation failed\");
}
BatchScope result(*this, 1);
const uint32_t resultId = result.add(op.Shape());
std::vector<uint32_t> answer = sub_shape_identity::faceHistory(
    op, resultId, op.Shape(), {shapeA, shapeB}, \"intersectWithPositionHistory\");
result.take();
return answer;",
        includes: &["BRepAlgoAPI_Common.hxx", "sub_shape_identity.h"],
        category: "identity",
        return_type: ReturnType::VectorUint32,
    },
    MethodSpec {
        name: "mirrorWithPositionHistory",
        kind: MethodKind::CustomBody,
        params: &[
            FacadeParam::ShapeId("id"),
            FacadeParam::Double("px"),
            FacadeParam::Double("py"),
            FacadeParam::Double("pz"),
            FacadeParam::Double("nx"),
            FacadeParam::Double("ny"),
            FacadeParam::Double("nz"),
        ],
        occt_class: "",
        ctor_args: "",
        // The reflection exactly as `mirrorWithHistory` builds it; only the answer differs.
        setup_code: "\
const auto& shape = get(id);
gp_Trsf trsf;
trsf.SetMirror(gp_Ax2(gp_Pnt(px, py, pz), gp_Dir(nx, ny, nz)));
BRepBuilderAPI_Transform maker(shape, trsf, true);
BatchScope result(*this, 1);
const uint32_t resultId = result.add(maker.Shape());
std::vector<uint32_t> answer = sub_shape_identity::faceHistory(
    maker, resultId, maker.Shape(), {shape}, \"mirrorWithPositionHistory\");
result.take();
return answer;",
        includes: &[
            "BRepBuilderAPI_Transform.hxx",
            "gp_Ax2.hxx",
            "gp_Dir.hxx",
            "gp_Pnt.hxx",
            "gp_Trsf.hxx",
            "sub_shape_identity.h",
        ],
        category: "identity",
        return_type: ReturnType::VectorUint32,
    },
    // ── B2: groups by position ──────────────────────────────────────
    MethodSpec {
        name: "meshShapeByPosition",
        kind: MethodKind::CustomBody,
        params: &[
            FacadeParam::ShapeId("id"),
            FacadeParam::Double("linearDeflection"),
            FacadeParam::Double("angularDeflection"),
        ],
        occt_class: "",
        ctor_args: "",
        // `meshShape`'s mesher (`buildMeshData`), each face group named by its
        // face's position: a face the explorer walks twice names its one position.
        setup_code: "\
const auto& shape = get(id);
const sub_shape_identity::ShapeList faces = sub_shape_identity::listOf(shape, TopAbs_FACE);
return buildMeshData(shape, linearDeflection, angularDeflection, false,
                     [&faces](const TopoDS_Face& face) {
                         return sub_shape_identity::positionIn(faces, face);
                     });",
        includes: &[
            "TopAbs_ShapeEnum.hxx",
            "TopoDS_Face.hxx",
            "sub_shape_identity.h",
        ],
        category: "identity",
        return_type: ReturnType::MeshData,
    },
    MethodSpec {
        name: "wireframeByPosition",
        kind: MethodKind::CustomBody,
        params: &[
            FacadeParam::ShapeId("id"),
            FacadeParam::Double("deflection"),
            FacadeParam::Int("source"),
        ],
        occt_class: "",
        ctor_args: "",
        // Each edge of the shape's list drawn alone by upstream's `wireframe`, so
        // its polyline is exactly the one `wireframe` draws for it within the
        // shape -- the same sampler, never a copy of it -- and its group then
        // names the edge's position. An edge `wireframe` does not draw (a
        // degenerate one) has no group, so a group's position is never its index.
        setup_code: "\
const auto& shape = get(id);
const sub_shape_identity::ShapeList edges = sub_shape_identity::listOf(shape, TopAbs_EDGE);
std::vector<float> points;
std::vector<int32_t> groups;
for (int i = 1; i <= edges.Extent(); i++) {
    BatchScope held(*this, 1);
    const EdgeData one = wireframe(held.add(edges.FindKey(i)), deflection, source);
    for (int g = 0; g + 2 < one.edgeGroupCount; g += 3) {
        const int start = one.edgeGroups[g];
        const int count = one.edgeGroups[g + 1];
        groups.push_back(static_cast<int32_t>(points.size()));
        groups.push_back(count);
        groups.push_back(i - 1);
        points.insert(points.end(), one.points + start, one.points + start + count);
    }
}
EdgeData result;
result.pointCount = static_cast<int>(points.size());
result.edgeGroupCount = static_cast<int>(groups.size());
result.points = static_cast<float*>(std::malloc(points.size() * sizeof(float)));
result.edgeGroups = static_cast<int32_t*>(std::malloc(groups.size() * sizeof(int32_t)));
if ((!result.points && !points.empty()) || (!result.edgeGroups && !groups.empty())) {
    throw std::runtime_error(\"wireframeByPosition: allocation failed\");
}
std::copy(points.begin(), points.end(), result.points);
std::copy(groups.begin(), groups.end(), result.edgeGroups);
return result;",
        includes: &["TopAbs_ShapeEnum.hxx", "sub_shape_identity.h"],
        category: "identity",
        return_type: ReturnType::EdgeData,
    },
    // ── B3: adjacency by position ───────────────────────────────────
    MethodSpec {
        name: "adjacencyByPosition",
        kind: MethodKind::CustomBody,
        params: &[FacadeParam::ShapeId("id")],
        occt_class: "",
        ctor_args: "",
        setup_code: "return sub_shape_identity::adjacency(get(id), \"adjacencyByPosition\");",
        includes: &["sub_shape_identity.h"],
        category: "identity",
        return_type: ReturnType::VectorUint32,
    },
    // ── B4: where one shape sits in another ─────────────────────────
    MethodSpec {
        name: "subShapePosition",
        kind: MethodKind::CustomBody,
        params: &[
            FacadeParam::ShapeId("shapeId"),
            FacadeParam::ShapeId("subId"),
        ],
        occt_class: "",
        ctor_args: "",
        // `sub`'s position in `shape`'s list of `sub`'s type, or -1 where it is
        // none of them.
        setup_code: "\
const auto& sub = get(subId);
if (sub.IsNull()) {
    throw std::runtime_error(\"subShapePosition: the sub-shape is a null shape\");
}
return sub_shape_identity::positionIn(sub_shape_identity::listOf(get(shapeId), sub.ShapeType()),
                                      sub);",
        includes: &["sub_shape_identity.h"],
        category: "identity",
        return_type: ReturnType::Int,
    },
    // ── B5: moves by position ───────────────────────────────────────
    MethodSpec {
        name: "translateWithPositions",
        kind: MethodKind::CustomBody,
        params: &[
            FacadeParam::ShapeId("id"),
            FacadeParam::Double("dx"),
            FacadeParam::Double("dy"),
            FacadeParam::Double("dz"),
        ],
        occt_class: "",
        ctor_args: "",
        // The copy exactly as `translate` builds it, answering where it put each
        // sub-shape (`ModifiedShape`).
        setup_code: "\
const auto& shape = get(id);
gp_Trsf trsf;
trsf.SetTranslation(gp_Vec(dx, dy, dz));
BRepBuilderAPI_Transform maker(shape, trsf, true);
BatchScope result(*this, 1);
const uint32_t resultId = result.add(maker.Shape());
std::vector<uint32_t> answer = sub_shape_identity::movedPositions(
    maker, resultId, shape, maker.Shape(), \"translateWithPositions\");
result.take();
return answer;",
        includes: &[
            "BRepBuilderAPI_Transform.hxx",
            "gp_Trsf.hxx",
            "gp_Vec.hxx",
            "sub_shape_identity.h",
        ],
        category: "identity",
        return_type: ReturnType::VectorUint32,
    },
    MethodSpec {
        name: "rotateWithPositions",
        kind: MethodKind::CustomBody,
        params: &[
            FacadeParam::ShapeId("id"),
            FacadeParam::Double("px"),
            FacadeParam::Double("py"),
            FacadeParam::Double("pz"),
            FacadeParam::Double("dx"),
            FacadeParam::Double("dy"),
            FacadeParam::Double("dz"),
            FacadeParam::Double("angleRad"),
        ],
        occt_class: "",
        ctor_args: "",
        // The copy exactly as `rotate` builds it, answering where it put each
        // sub-shape (`ModifiedShape`).
        setup_code: "\
const auto& shape = get(id);
gp_Trsf trsf;
trsf.SetRotation(gp_Ax1(gp_Pnt(px, py, pz), gp_Dir(dx, dy, dz)), angleRad);
BRepBuilderAPI_Transform maker(shape, trsf, true);
BatchScope result(*this, 1);
const uint32_t resultId = result.add(maker.Shape());
std::vector<uint32_t> answer = sub_shape_identity::movedPositions(
    maker, resultId, shape, maker.Shape(), \"rotateWithPositions\");
result.take();
return answer;",
        includes: &[
            "BRepBuilderAPI_Transform.hxx",
            "gp_Ax1.hxx",
            "gp_Dir.hxx",
            "gp_Pnt.hxx",
            "gp_Trsf.hxx",
            "sub_shape_identity.h",
        ],
        category: "identity",
        return_type: ReturnType::VectorUint32,
    },
    MethodSpec {
        name: "mirrorWithPositions",
        kind: MethodKind::CustomBody,
        params: &[
            FacadeParam::ShapeId("id"),
            FacadeParam::Double("px"),
            FacadeParam::Double("py"),
            FacadeParam::Double("pz"),
            FacadeParam::Double("nx"),
            FacadeParam::Double("ny"),
            FacadeParam::Double("nz"),
        ],
        occt_class: "",
        ctor_args: "",
        // The copy exactly as `mirror` builds it, answering where it put each
        // sub-shape (`ModifiedShape`).
        setup_code: "\
const auto& shape = get(id);
gp_Trsf trsf;
trsf.SetMirror(gp_Ax2(gp_Pnt(px, py, pz), gp_Dir(nx, ny, nz)));
BRepBuilderAPI_Transform maker(shape, trsf, true);
BatchScope result(*this, 1);
const uint32_t resultId = result.add(maker.Shape());
std::vector<uint32_t> answer = sub_shape_identity::movedPositions(
    maker, resultId, shape, maker.Shape(), \"mirrorWithPositions\");
result.take();
return answer;",
        includes: &[
            "BRepBuilderAPI_Transform.hxx",
            "gp_Ax2.hxx",
            "gp_Dir.hxx",
            "gp_Pnt.hxx",
            "gp_Trsf.hxx",
            "sub_shape_identity.h",
        ],
        category: "identity",
        return_type: ReturnType::VectorUint32,
    },
    MethodSpec {
        name: "transformWithPositions",
        kind: MethodKind::CustomBody,
        params: &[
            FacadeParam::ShapeId("id"),
            FacadeParam::VectorDouble("matrix"),
        ],
        occt_class: "",
        ctor_args: "",
        // The copy exactly as `transform` builds it, answering where it put each
        // sub-shape (`ModifiedShape`).
        setup_code: "\
if (matrix.size() != 12) {
    throw std::runtime_error(\"transformWithPositions: matrix must have 12 elements (3x4)\");
}
const auto& shape = get(id);
gp_Trsf trsf;
trsf.SetValues(matrix[0], matrix[1], matrix[2], matrix[3], matrix[4], matrix[5], matrix[6],
               matrix[7], matrix[8], matrix[9], matrix[10], matrix[11]);
BRepBuilderAPI_Transform maker(shape, trsf, true);
BatchScope result(*this, 1);
const uint32_t resultId = result.add(maker.Shape());
std::vector<uint32_t> answer = sub_shape_identity::movedPositions(
    maker, resultId, shape, maker.Shape(), \"transformWithPositions\");
result.take();
return answer;",
        includes: &[
            "BRepBuilderAPI_Transform.hxx",
            "gp_Trsf.hxx",
            "sub_shape_identity.h",
        ],
        category: "identity",
        return_type: ReturnType::VectorUint32,
    },
];

/// The fork's method specifications, which the generator reads after upstream's
/// [`super::config::target_methods`].
pub fn target_methods() -> &'static [MethodSpec] {
    FORK_METHODS
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::codegen::config;

    #[test]
    fn upstream_and_fork_lists_validate_together() {
        let all: Vec<MethodSpec> = config::target_methods()
            .iter()
            .chain(target_methods())
            .copied()
            .collect();
        assert!(
            config::validate(&all).is_ok(),
            "upstream + fork specs failed validation: {:?}",
            config::validate(&all).err()
        );
    }

    #[test]
    fn no_fork_method_takes_or_returns_a_number() {
        for m in target_methods() {
            for p in m.params {
                let name = p.name().to_ascii_lowercase();
                assert!(
                    !name.contains("hash") && !name.contains("bound"),
                    "{} takes a number: {}",
                    m.name,
                    p.name()
                );
            }
            assert!(
                !m.setup_code.contains("TopTools_ShapeMapHasher{}")
                    && !m.setup_code.contains("hashCode")
                    && !m.setup_code.contains("subShapeHashes"),
                "{} computes a hash number",
                m.name
            );
            assert_ne!(
                m.return_type,
                ReturnType::EvolutionData,
                "{} answers in upstream's hash runs",
                m.name
            );
        }
    }

    #[test]
    fn fork_methods_keep_to_their_own_category() {
        for m in target_methods() {
            assert_eq!(m.category, "identity", "{}", m.name);
            assert_ne!(m.kind, MethodKind::Skip, "{}", m.name);
        }
    }
}
