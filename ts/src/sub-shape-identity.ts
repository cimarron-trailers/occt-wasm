// SPDX-License-Identifier: MIT OR Apache-2.0
// SPDX-FileCopyrightText: Cimarron Trailers

/**
 * Sub-shape identity by position: the answers of the cimarron-trailers fork's
 * calls on `OcctKernel` (`cutWithPositionHistory`, `meshShapeByPosition`,
 * `adjacencyByPosition`, `subShapePosition`, `transformWithPositions`, …),
 * beside upstream's calls by number.
 *
 * A sub-shape's POSITION is its index in its shape's list of that type: the
 * order `getSubShapes(shape, type)` lists them, OCCT's indexed map
 * (`TopExp::MapShapes`), found by `IsSame`. A position is exact by
 * construction — two sub-shapes never share one. Upstream's calls answer in
 * hash numbers instead (`subShapeHashes`, the `*WithHistory` runs, the mesh's
 * and the wireframe's group ids), and two different sub-shapes with equal
 * numbers are one. None of these calls takes or returns a number.
 *
 * A position belongs to the shape whose list it indexes. Another shape — a
 * rebuilt one among them — has lists of its own, where the same position may
 * name another sub-shape; only an answer here (a history, a move) relates the
 * positions of two shapes.
 */

import type { OcctWasmModule, RawEdgeData } from "./raw-types.js";
import type { EdgeData, ShapeHandle } from "./types.js";

/** What an operation did to one face of one of its inputs. */
export type FaceFate =
    /** It is in the result unchanged: the same face, at this position there. */
    | { readonly kind: "untouched"; readonly at: number }
    /** It became these faces of the result (one or more), by position. */
    | { readonly kind: "modified"; readonly into: readonly number[] }
    /** It is in the result in no form. */
    | { readonly kind: "deleted" };

/** A face of the result that the operation generated from an input face. */
export interface GeneratedFace {
    /** Which input the source face is of: 0 the body, 1 the tool. */
    readonly input: number;
    /** The source face's position in that input. */
    readonly face: number;
    /** The generated face's position in the result. */
    readonly into: number;
}

/** A face-history operation's answer: what became of every face of every input, by position. */
export interface PositionHistory {
    /** The operation's result. */
    readonly result: ShapeHandle;
    /** How many faces the result has: its face positions run from 0 to `resultFaces - 1`. */
    readonly resultFaces: number;
    /**
     * `inputs[i][p]` is what became of face `p` of input `i` — the body (0), then the
     * tool (1) — read from the operation's own history.
     */
    readonly inputs: readonly (readonly FaceFate[])[];
    /** Each face of the result the operation generated from an input face. */
    readonly generated: readonly GeneratedFace[];
}

/**
 * A copy's answer: where it put each of the source's sub-shapes, by position.
 * `faces[p]` is the copy's position of the source's face `p` (`ModifiedShape`);
 * likewise `edges` and `vertices`.
 */
export interface MovedPositions {
    /** The copy. */
    readonly result: ShapeHandle;
    readonly faces: readonly number[];
    readonly edges: readonly number[];
    readonly vertices: readonly number[];
}

/** Which sub-shapes of one shape meet, by position in that shape's lists. */
export interface PositionAdjacency {
    /** `faceEdges[f]`: the edges bounding face `f`, each once (a seam edge too), in the face's own order. */
    readonly faceEdges: readonly (readonly number[])[];
    /** `faceVertices[f]`: the vertices of face `f`, each once, in the face's own order. */
    readonly faceVertices: readonly (readonly number[])[];
    /** `edgeFaces[e]`: the faces edge `e` bounds, in position order — the inverse of `faceEdges`. */
    readonly edgeFaces: readonly (readonly number[])[];
}

// ---------------------------------------------------------------------------
// The raw Embind surface the fork adds to `OcctRawKernel`.
// ---------------------------------------------------------------------------

declare module "./raw-types.js" {
    interface OcctRawKernel {
        cutWithPositionHistory(a: number, b: number): EmbindVectorU32;
        fuseWithPositionHistory(a: number, b: number): EmbindVectorU32;
        intersectWithPositionHistory(a: number, b: number): EmbindVectorU32;
        mirrorWithPositionHistory(
            id: number, px: number, py: number, pz: number, nx: number, ny: number, nz: number,
        ): EmbindVectorU32;
        meshShapeByPosition(id: number, linDefl: number, angDefl: number): RawMeshData;
        wireframeByPosition(id: number, deflection: number, source: number): RawEdgeData;
        adjacencyByPosition(id: number): EmbindVectorU32;
        subShapePosition(shapeId: number, subId: number): number;
        translateWithPositions(id: number, dx: number, dy: number, dz: number): EmbindVectorU32;
        rotateWithPositions(
            id: number, px: number, py: number, pz: number,
            dx: number, dy: number, dz: number, angleRad: number,
        ): EmbindVectorU32;
        mirrorWithPositions(
            id: number, px: number, py: number, pz: number, nx: number, ny: number, nz: number,
        ): EmbindVectorU32;
        transformWithPositions(id: number, matrix: EmbindVectorF64): EmbindVectorU32;
    }
}

// ---------------------------------------------------------------------------
// Decoding the facade's answers (facade/include/sub_shape_identity.h states each layout).
// ---------------------------------------------------------------------------

/** Reads one answer front to back, refusing any that is not the layout it states. */
class AnswerReader {
    readonly #flat: ArrayLike<number>;
    readonly #op: string;
    #at = 0;

    constructor(flat: ArrayLike<number>, op: string) {
        this.#flat = flat;
        this.#op = op;
    }

    next(): number {
        const value = this.#flat[this.#at];
        if (value === undefined) this.malformed("it ends early");
        this.#at++;
        return value;
    }

    /** `n` positions, each into a list of `bound`. */
    positions(n: number, bound: number): number[] {
        const out: number[] = [];
        for (let k = 0; k < n; k++) {
            const at = this.next();
            if (at >= bound) this.malformed(`position ${at} is past its list of ${bound}`);
            out.push(at);
        }
        return out;
    }

    end(): void {
        if (this.#at !== this.#flat.length) this.malformed("it runs on past its stated length");
    }

    malformed(why: string): never {
        throw new Error(`${this.#op}: malformed answer: ${why}`);
    }
}

const DELETED = 0;
const UNTOUCHED = 1;
const MODIFIED = 2;

/** A face-history answer (`faceHistory` in sub_shape_identity.h). */
export function decodePositionHistory(flat: ArrayLike<number>, op: string): PositionHistory {
    const r = new AnswerReader(flat, op);
    const result = r.next() as ShapeHandle;
    const resultFaces = r.next();
    const inputCount = r.next();
    const inputs: FaceFate[][] = [];
    for (let i = 0; i < inputCount; i++) {
        const faceCount = r.next();
        const fates: FaceFate[] = [];
        for (let p = 0; p < faceCount; p++) {
            const kind = r.next();
            const into = r.positions(r.next(), resultFaces);
            const [at] = into;
            if (kind === DELETED && into.length === 0) fates.push({ kind: "deleted" });
            else if (kind === UNTOUCHED && into.length === 1 && at !== undefined) fates.push({ kind: "untouched", at });
            else if (kind === MODIFIED && into.length >= 1) fates.push({ kind: "modified", into });
            else r.malformed(`face ${p} of input ${i} has fate ${kind} with ${into.length} faces`);
        }
        inputs.push(fates);
    }
    const generated: GeneratedFace[] = [];
    const generatedCount = r.next();
    for (let g = 0; g < generatedCount; g++) {
        const input = r.next();
        const face = r.next();
        const into = r.next();
        if (face >= (inputs[input]?.length ?? 0) || into >= resultFaces) {
            r.malformed(`generated face ${g} names no face`);
        }
        generated.push({ input, face, into });
    }
    r.end();
    return { result, resultFaces, inputs, generated };
}

/** A move's answer (`movedPositions` in sub_shape_identity.h). */
export function decodeMovedPositions(flat: ArrayLike<number>, op: string): MovedPositions {
    const r = new AnswerReader(flat, op);
    const result = r.next() as ShapeHandle;
    const images = (): number[] => {
        const n = r.next();
        return r.positions(n, n);
    };
    const faces = images();
    const edges = images();
    const vertices = images();
    r.end();
    return { result, faces, edges, vertices };
}

/** An adjacency answer (`adjacency` in sub_shape_identity.h). */
export function decodeAdjacency(flat: ArrayLike<number>, op: string): PositionAdjacency {
    const r = new AnswerReader(flat, op);
    const faces = r.next();
    const edges = r.next();
    const vertices = r.next();
    const lists = (count: number, bound: number): number[][] =>
        Array.from({ length: count }, () => r.positions(r.next(), bound));
    const faceEdges = lists(faces, edges);
    const faceVertices = lists(faces, vertices);
    const edgeFaces = lists(edges, faces);
    r.end();
    return { faceEdges, faceVertices, edgeFaces };
}

/** A wireframe's points and groups, copied out of the module's heap; `raw` is deleted. */
export function readEdgeData(module: OcctWasmModule, raw: RawEdgeData): EdgeData {
    try {
        const points = new Float32Array(
            module.HEAPF32.buffer.slice(raw.getPointsPtr(), raw.getPointsPtr() + raw.pointCount * 4),
        );
        const edgeGroups = new Int32Array(
            module.HEAP32.buffer.slice(raw.getEdgeGroupsPtr(), raw.getEdgeGroupsPtr() + raw.edgeGroupCount * 4),
        );
        return { points, edgeGroups, pointCount: raw.pointCount, edgeCount: raw.edgeGroupCount / 3 };
    } finally {
        raw.delete();
    }
}
