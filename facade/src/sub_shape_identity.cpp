// SPDX-License-Identifier: MIT OR Apache-2.0
// SPDX-FileCopyrightText: Cimarron Trailers

#include "sub_shape_identity.h"

#include <BRepBuilderAPI_MakeShape.hxx>
#include <BRepBuilderAPI_ModifyShape.hxx>
#include <NCollection_List.hxx>
#include <TopExp.hxx>

#include <stdexcept>
#include <string>

namespace sub_shape_identity {

namespace {

// A face's fate in faceHistory's answer.
constexpr uint32_t kDeleted = 0;
constexpr uint32_t kUntouched = 1;
constexpr uint32_t kModified = 2;

[[noreturn]] void contradiction(const char* op, const std::string& what) {
    throw std::runtime_error(std::string(op) + ": " + what);
}

uint32_t count(const ShapeList& list) {
    return static_cast<uint32_t>(list.Extent());
}

} // namespace

ShapeList listOf(const TopoDS_Shape& shape, TopAbs_ShapeEnum type) {
    ShapeList list;
    TopExp::MapShapes(shape, type, list);
    return list;
}

int positionIn(const ShapeList& list, const TopoDS_Shape& sub) {
    return list.FindIndex(sub) - 1;
}

std::vector<uint32_t> faceHistory(BRepBuilderAPI_MakeShape& maker, uint32_t resultId,
                                  const TopoDS_Shape& result,
                                  const std::vector<TopoDS_Shape>& inputs, const char* op) {
    const ShapeList resultFaces = listOf(result, TopAbs_FACE);
    auto inResult = [&](const TopoDS_Shape& face, const char* what) -> uint32_t {
        const int at = positionIn(resultFaces, face);
        if (at < 0) {
            contradiction(op, std::string("its history names a ") + what +
                                  " face that is not in the result");
        }
        return static_cast<uint32_t>(at);
    };

    std::vector<uint32_t> out{resultId, count(resultFaces), static_cast<uint32_t>(inputs.size())};
    std::vector<uint32_t> generated; // (input, face, result face) triples
    for (size_t i = 0; i < inputs.size(); i++) {
        const ShapeList faces = listOf(inputs[i], TopAbs_FACE);
        out.push_back(count(faces));
        for (int p = 1; p <= faces.Extent(); p++) {
            const TopoDS_Shape& face = faces.FindKey(p);
            // ⚠ Read in full before the next history call: a builder may answer
            // Modified and Generated in one list of its own that each call refills.
            const NCollection_List<TopoDS_Shape>& images = maker.Modified(face);
            if (!images.IsEmpty()) {
                out.push_back(kModified);
                out.push_back(static_cast<uint32_t>(images.Size()));
                for (const TopoDS_Shape& image : images) {
                    out.push_back(inResult(image, "modified"));
                }
            } else if (maker.IsDeleted(face)) {
                if (positionIn(resultFaces, face) >= 0) {
                    contradiction(op, "its history deletes a face that is in the result");
                }
                out.push_back(kDeleted);
                out.push_back(0);
            } else {
                out.push_back(kUntouched);
                out.push_back(1);
                out.push_back(inResult(face, "untouched"));
            }
            for (const TopoDS_Shape& made : maker.Generated(face)) {
                if (made.ShapeType() != TopAbs_FACE) {
                    continue; // a section edge or vertex: not a face of the result
                }
                generated.push_back(static_cast<uint32_t>(i));
                generated.push_back(static_cast<uint32_t>(p - 1));
                generated.push_back(inResult(made, "generated"));
            }
        }
    }
    out.push_back(static_cast<uint32_t>(generated.size() / 3));
    out.insert(out.end(), generated.begin(), generated.end());
    return out;
}

std::vector<uint32_t> movedPositions(const BRepBuilderAPI_ModifyShape& maker, uint32_t resultId,
                                     const TopoDS_Shape& source, const TopoDS_Shape& result,
                                     const char* op) {
    std::vector<uint32_t> out{resultId};
    for (const TopAbs_ShapeEnum type : {TopAbs_FACE, TopAbs_EDGE, TopAbs_VERTEX}) {
        const ShapeList from = listOf(source, type);
        const ShapeList to = listOf(result, type);
        if (from.Extent() != to.Extent()) {
            contradiction(op, "the copy does not hold each sub-shape once");
        }
        std::vector<bool> taken(static_cast<size_t>(to.Extent()), false);
        out.push_back(count(from));
        for (int p = 1; p <= from.Extent(); p++) {
            const int at = positionIn(to, maker.ModifiedShape(from.FindKey(p)));
            if (at < 0 || taken[static_cast<size_t>(at)]) {
                contradiction(op, "the copy does not hold each sub-shape once");
            }
            taken[static_cast<size_t>(at)] = true;
            out.push_back(static_cast<uint32_t>(at));
        }
    }
    return out;
}

std::vector<uint32_t> adjacency(const TopoDS_Shape& shape, const char* op) {
    const ShapeList faces = listOf(shape, TopAbs_FACE);
    const ShapeList edges = listOf(shape, TopAbs_EDGE);
    const ShapeList vertices = listOf(shape, TopAbs_VERTEX);

    std::vector<uint32_t> out{count(faces), count(edges), count(vertices)};
    std::vector<std::vector<uint32_t>> facesOfEdge(static_cast<size_t>(edges.Extent()));
    auto bounds = [&](const ShapeList& own, const ShapeList& all, uint32_t face, bool isEdge) {
        out.push_back(count(own));
        for (int k = 1; k <= own.Extent(); k++) {
            const int at = positionIn(all, own.FindKey(k));
            if (at < 0) {
                contradiction(op, "a face is bounded by a sub-shape its shape does not hold");
            }
            out.push_back(static_cast<uint32_t>(at));
            if (isEdge) {
                facesOfEdge[static_cast<size_t>(at)].push_back(face);
            }
        }
    };
    for (int f = 1; f <= faces.Extent(); f++) {
        bounds(listOf(faces.FindKey(f), TopAbs_EDGE), edges, static_cast<uint32_t>(f - 1), true);
    }
    for (int f = 1; f <= faces.Extent(); f++) {
        bounds(listOf(faces.FindKey(f), TopAbs_VERTEX), vertices, static_cast<uint32_t>(f - 1),
               false);
    }
    for (const std::vector<uint32_t>& of : facesOfEdge) {
        out.push_back(static_cast<uint32_t>(of.size()));
        out.insert(out.end(), of.begin(), of.end());
    }
    return out;
}

} // namespace sub_shape_identity
