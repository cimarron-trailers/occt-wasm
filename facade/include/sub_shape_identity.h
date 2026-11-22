// SPDX-License-Identifier: MIT OR Apache-2.0
// SPDX-FileCopyrightText: Cimarron Trailers

#pragma once

// Sub-shape identity by position: the helpers behind the cimarron-trailers
// fork's facade methods (xtask/src/codegen/fork.rs).
//
// A sub-shape's POSITION is its 0-based index in its shape's list of that type:
// TopExp::MapShapes' indexed map, the order getSubShapes() lists. FindIndex finds
// it by IsSame -- the same TShape and the same location, orientation aside -- so
// a position is exact by construction: two sub-shapes never share one, whatever
// their hash numbers. Every answer here is in that space; none takes or returns
// a hash number.
//
// The answers are flat vectors of uint32 that ts/src/sub-shape-identity.ts
// decodes; each function documents its layout.

#include <cstdint>
#include <vector>

#include <NCollection_IndexedMap.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <TopTools_ShapeMapHasher.hxx>
#include <TopoDS_Shape.hxx>

class BRepBuilderAPI_MakeShape;
class BRepBuilderAPI_ModifyShape;

namespace sub_shape_identity {

/// A shape's sub-shapes of one type, in position order.
using ShapeList = NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher>;

/// `shape`'s sub-shapes of `type`, in position order (`getSubShapes`' order).
ShapeList listOf(const TopoDS_Shape& shape, TopAbs_ShapeEnum type);

/// `sub`'s position in `list`, or -1 where it is none of them.
int positionIn(const ShapeList& list, const TopoDS_Shape& sub);

/// What an operation did to every face of each of its `inputs` (the body, then
/// the tool), by position, read from the operation's own history:
///
///     [resultId, resultFaceCount, inputCount,
///      for each input: faceCount,
///        for each of its faces, by position: fate, n, n result positions,
///      generatedCount, generatedCount x (input, face, result face)]
///
/// A fate is 0 deleted (n = 0), 1 untouched -- the same face, at its one position in
/// the result (n = 1) -- or 2 modified, into the n result faces it became
/// (n >= 1). A generated face is a face of the result the operation generated
/// from the input face. A face the history names that is not in the result, or
/// a face it neither keeps, modifies nor deletes, is a contradiction, and throws:
/// an answer is never guessed.
std::vector<uint32_t> faceHistory(BRepBuilderAPI_MakeShape& maker, uint32_t resultId,
                                  const TopoDS_Shape& result,
                                  const std::vector<TopoDS_Shape>& inputs, const char* op);

/// Where a copy put each of `source`'s faces, edges and vertices
/// (`ModifiedShape`), by position:
///
///     [resultId, faceCount, faceCount x result position,
///                edgeCount, edgeCount x result position,
///                vertexCount, vertexCount x result position]
///
/// Throws unless every sub-shape's image is in the copy, each one once.
std::vector<uint32_t> movedPositions(const BRepBuilderAPI_ModifyShape& maker, uint32_t resultId,
                                     const TopoDS_Shape& source, const TopoDS_Shape& result,
                                     const char* op);

/// Which of `shape`'s edges and vertices bound each of its faces, and which of
/// its faces each edge bounds, by position in `shape`'s own lists:
///
///     [faceCount, edgeCount, vertexCount,
///      for each face: n, its n edges,
///      for each face: n, its n vertices,
///      for each edge: n, the n faces it bounds, in position order]
///
/// A face's edges and vertices are in its own list's order, each once (a seam
/// edge too). An edge's faces are the inverse of the faces' edges -- what
/// TopExp::MapShapesAndUniqueAncestors(shape, EDGE, FACE) maps -- so the two can
/// never disagree.
std::vector<uint32_t> adjacency(const TopoDS_Shape& shape, const char* op);

} // namespace sub_shape_identity
